"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { buildFeedbackWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { requirePermission } from "@/server/session";
import { generateCustomerDraft, REVIEW_PROMPT_VERSION } from "@/features/feedback/draft";
import { FEEDBACK_QUESTIONS, customerDraftSchema, feedbackCaptureSchema, feedbackManageSchema, feedbackPhotoSchema } from "@/features/feedback/schema";
import type { FeedbackCreationResult, FeedbackPurchaseContext } from "@/features/feedback/types";
import { uuid } from "@/lib/zod";
import { hashFeedbackToken } from "@/features/feedback/token";
import { googleDestination } from "@/features/feedback/google-destination";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function configuredReviewUrl(): string | null {
  const raw = process.env.TC_GOOGLE_REVIEW_URL?.trim();
  if (!raw) return null;
  const url = googleDestination(raw);
  if (!url) throw new Error("TC_GOOGLE_REVIEW_URL must be an HTTPS Google review or business-listing link.");
  return url;
}

function handoff(token: string, requestId: string, context: FeedbackPurchaseContext, mode: "llm" | "deterministic" = "deterministic"): FeedbackCreationResult {
  const secureLink = `${publicEnv.appUrl.replace(/\/$/, "")}/review/${token}`;
  const message = buildFeedbackWhatsAppMessage({ firstName: context.customer_name, secureLink });
  const whatsappUrl = buildWhatsAppUrl(context.phone, message);
  if (!whatsappUrl) throw new Error("Add a valid phone number before preparing a link.");
  return { request_id: requestId, secure_link: secureLink, whatsapp_url: whatsappUrl, generation_mode: mode, message };
}

export async function createFeedbackRequestAction(formData: FormData): Promise<ActionResult<FeedbackCreationResult>> {
  const parsed = feedbackCaptureSchema.safeParse({
    purchase_id: String(formData.get("purchase_id") ?? ""), visit_id: String(formData.get("visit_id") ?? ""),
    answers: FEEDBACK_QUESTIONS.map((_, index) => String(formData.get(`answer_${index}`) ?? "")),
    whatsapp_consent: formData.get("whatsapp_consent") === "on", photo_permission: formData.get("photo_permission") === "on",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the feedback details.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: raw, error: contextError } = await supabase.rpc("feedback_workbench", parsed.data.purchase_id ? { p_purchase_id: parsed.data.purchase_id } : { p_visit_id: parsed.data.visit_id || undefined });
    if (contextError || !raw) return fail(contextError ?? "Visit or eligible purchase not found.");
    const context = raw as unknown as FeedbackPurchaseContext;
    if (context.existing_request_id) return fail("Feedback already exists. Open the existing request to prepare a replacement link.");
    if (!buildWhatsAppUrl(context.phone, "")) return fail("Add a valid primary phone number, and use a role that can reveal contact details.");
    const generated = await generateCustomerDraft(parsed.data.answers);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashFeedbackToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const reviewUrl = configuredReviewUrl();
    const answers = FEEDBACK_QUESTIONS.map((question, index) => ({ question_key: question.key, question_text: question.text, answer_text: parsed.data.answers[index], position: index + 1 }));
    let requestId: string;
    if (parsed.data.purchase_id) {
      const { data, error } = await supabase.rpc("create_feedback_request", {
        p_purchase_id: parsed.data.purchase_id, p_answers: answers, p_token_hash: tokenHash, p_expires_at: expiresAt,
        p_generated_text: generated.text, p_generation_mode: generated.mode, p_model_id: generated.modelId ?? "",
        p_prompt_version: REVIEW_PROMPT_VERSION, p_input_hash: generated.inputHash, p_review_url: reviewUrl ?? "",
        p_photo_permission: parsed.data.photo_permission, p_whatsapp_consent: parsed.data.whatsapp_consent,
        p_benefit_status: "not_offered", p_benefit_reference: "",
      });
      if (error || !data || typeof data !== "object" || !("request_id" in data)) return fail(error ?? "Could not create feedback.");
      requestId = String(data.request_id);
    } else {
      const { data, error } = await supabase.rpc("prepare_visit_feedback", { p_input: {
        visit_id: parsed.data.visit_id, answers, token_hash: tokenHash, expires_at: expiresAt, generated_text: generated.text,
        generation_mode: generated.mode, model_id: generated.modelId ?? "", prompt_version: REVIEW_PROMPT_VERSION, input_hash: generated.inputHash,
        review_url: reviewUrl, photo_permission: parsed.data.photo_permission, whatsapp_consent: parsed.data.whatsapp_consent,
      } });
      if (error || !data) return fail(error ?? "Could not create feedback.");
      requestId = data;
    }
    revalidatePath("/sales/feedback"); revalidatePath("/sales/walk-ins");
    return ok(handoff(token, requestId, context, generated.mode), "Feedback handoff prepared.");
  } catch (error) { return fail(error); }
}

export async function reissueFeedbackLinkAction(requestId: string): Promise<ActionResult<FeedbackCreationResult>> {
  if (!uuid().safeParse(requestId).success) return fail("Invalid request.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("feedback_workbench", { p_request_id: requestId });
    if (error || !data) return fail(error ?? "Request not found.");
    const context = data as unknown as FeedbackPurchaseContext;
    if (!buildWhatsAppUrl(context.phone, "")) return fail("Add a valid primary phone number first.");
    const token = randomBytes(32).toString("base64url");
    const result = await supabase.rpc("manage_feedback_request", { p_request_id: requestId, p_action: "reissue", p_token_hash: hashFeedbackToken(token), p_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString() });
    if (result.error) return fail(result.error);
    revalidatePath("/sales/feedback/new");
    return ok(handoff(token, requestId, context), "New private link prepared. The previous link is now invalid.");
  } catch (error) { return fail(error); }
}

export async function manageFeedbackAction(input: unknown): Promise<ActionResult> {
  const parsed = feedbackManageSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the action.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("manage_feedback_request", { p_request_id: parsed.data.request_id, p_action: parsed.data.action, p_note: parsed.data.note });
    if (error) return fail(error);
    revalidatePath("/sales/feedback"); revalidatePath("/sales/feedback/new"); revalidatePath("/sales/walk-ins");
    return ok(undefined, "Feedback tracking updated.");
  } catch (error) { return fail(error); }
}

export async function prepareFeedbackPhotoAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = feedbackPhotoSchema.safeParse(input);
  if (!parsed.success) return fail("Use JPEG, PNG or WebP photos up to 5 MB each.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("prepare_feedback_photo", { p_request_id: parsed.data.request_id, p_media_id: parsed.data.media_id, p_mime_type: parsed.data.mime_type, p_size_bytes: parsed.data.size_bytes });
    if (error || !data) return fail(error ?? "Could not prepare the photo.");
    return ok(data);
  } catch (error) { return fail(error); }
}
export async function logFeedbackWhatsAppOpenedAction(requestId: string): Promise<ActionResult> {
  if (!uuid().safeParse(requestId).success) return fail("Invalid feedback request.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("log_feedback_staff_event", { p_request_id: requestId, p_event_type: "whatsapp_opened" });
    if (error) return fail(error);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function confirmCustomerFeedbackAction(input: { token: string; customer_text: string }): Promise<ActionResult> {
  const parsed = customerDraftSchema.safeParse(input);
  if (!parsed.success) return fail("Check the review draft.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin.rpc("confirm_feedback_by_token", { p_token_hash: hashFeedbackToken(parsed.data.token), p_customer_text: parsed.data.customer_text });
    if (error) return fail(error);
    if (!data) return fail("This private link has expired or been revoked.");
    revalidatePath(`/review/${parsed.data.token}`);
    return ok(undefined, "Your private feedback is confirmed.");
  } catch (error) {
    return fail(error);
  }
}
