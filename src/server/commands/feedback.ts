"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { buildFeedbackWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { requirePermission } from "@/server/session";
import { generateCustomerDraft, REVIEW_PROMPT_VERSION } from "@/features/feedback/draft";
import { ALLOWED_PHOTO_TYPES, FEEDBACK_QUESTIONS, MAX_FEEDBACK_PHOTO_BYTES, customerDraftSchema, feedbackCaptureSchema } from "@/features/feedback/schema";
import type { FeedbackCreationResult } from "@/features/feedback/types";
import { hashFeedbackToken } from "@/features/feedback/token";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function configuredReviewUrl(): string | null {
  const raw = process.env.TC_GOOGLE_REVIEW_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed = host === "g.page" || host === "maps.app.goo.gl" || host === "search.google.com" || host === "google.com" || host.endsWith(".google.com");
  if (url.protocol !== "https:" || !allowed) throw new Error("TC_GOOGLE_REVIEW_URL must be an owner-verified HTTPS Google review link.");
  return url.toString();
}

function photoFrom(formData: FormData): File | null {
  const value = formData.get("photo");
  return value instanceof File && value.size > 0 ? value : null;
}

export async function createFeedbackRequestAction(formData: FormData): Promise<ActionResult<FeedbackCreationResult>> {
  const answers = FEEDBACK_QUESTIONS.map((_, index) => String(formData.get(`answer_${index}`) ?? ""));
  const parsed = feedbackCaptureSchema.safeParse({
    purchase_id: String(formData.get("purchase_id") ?? ""),
    answers,
    whatsapp_consent: formData.get("whatsapp_consent") === "on",
    photo_permission: formData.get("photo_permission") === "on",
    benefit_granted: formData.get("benefit_granted") === "on",
    benefit_reference: String(formData.get("benefit_reference") ?? ""),
  });
  if (!parsed.success) return fail("Check the feedback details.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const photo = photoFrom(formData);
  if (photo && !parsed.data.photo_permission) return fail("Record photo permission before uploading the picture.");
  if (photo && (!ALLOWED_PHOTO_TYPES.has(photo.type) || photo.size > MAX_FEEDBACK_PHOTO_BYTES)) return fail("Use a JPEG, PNG, or WebP image up to 10 MB.");

  try {
    const session = await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: context, error: contextError } = await supabase.rpc("feedback_purchase_context", { p_purchase_id: parsed.data.purchase_id }).maybeSingle();
    if (contextError || !context) return fail(contextError ?? "Eligible purchase not found.");
    if (context.existing_request_id) return fail("A feedback request already exists for this purchase.");
    if (!context.phone) return fail("A revealed primary phone number is required to prepare the WhatsApp handoff.");

    const generated = await generateCustomerDraft(parsed.data.answers);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashFeedbackToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const reviewUrl = configuredReviewUrl();
    const answerRows = FEEDBACK_QUESTIONS.map((question, index) => ({
      question_key: question.key,
      question_text: question.text,
      answer_text: parsed.data.answers[index],
      position: index + 1,
    }));
    const { data, error } = await supabase.rpc("create_feedback_request", {
      p_purchase_id: parsed.data.purchase_id,
      p_answers: answerRows,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_generated_text: generated.text,
      p_generation_mode: generated.mode,
      p_model_id: generated.modelId ?? "",
      p_prompt_version: REVIEW_PROMPT_VERSION,
      p_input_hash: generated.inputHash,
      p_review_url: reviewUrl ?? "",
      p_photo_permission: parsed.data.photo_permission,
      p_whatsapp_consent: parsed.data.whatsapp_consent,
      p_benefit_status: parsed.data.benefit_granted ? "granted_for_private_feedback" : "not_offered",
      p_benefit_reference: parsed.data.benefit_granted ? parsed.data.benefit_reference : "",
    });
    if (error || !data || typeof data !== "object" || !("request_id" in data)) return fail(error ?? "Could not create feedback request.");
    const requestId = String(data.request_id);
    let photoWarning: string | undefined;

    if (photo) {
      const extension = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      const objectPath = `${session.workspaceId}/${requestId}/${randomUUID()}.${extension}`;
      const admin = createAdminSupabase();
      const { error: uploadError } = await admin.storage.from("feedback-media").upload(objectPath, await photo.arrayBuffer(), { contentType: photo.type, upsert: false });
      if (uploadError) {
        photoWarning = "The feedback request was created, but the photo upload failed. You can continue without the photo.";
      } else {
        const { error: attachError } = await supabase.rpc("attach_feedback_media", {
          p_request_id: requestId,
          p_object_path: objectPath,
          p_mime_type: photo.type,
          p_size_bytes: photo.size,
        });
        if (attachError) {
          await admin.storage.from("feedback-media").remove([objectPath]);
          photoWarning = "The feedback request was created, but the photo could not be attached. You can continue without the photo.";
        }
      }
    }

    const secureLink = `${publicEnv.appUrl.replace(/\/$/, "")}/review/${token}`;
    const message = buildFeedbackWhatsAppMessage({ firstName: context.customer_name, secureLink });
    const whatsappUrl = buildWhatsAppUrl(context.phone, message);
    if (!whatsappUrl) return fail("The feedback request was created, but the customer phone number is not valid for WhatsApp.");
    revalidatePath("/sales/feedback");
    revalidatePath("/sales/walk-ins");
    return ok({ request_id: requestId, secure_link: secureLink, whatsapp_url: whatsappUrl, generation_mode: generated.mode, photo_warning: photoWarning }, "Feedback handoff prepared.");
  } catch (error) {
    return fail(error);
  }
}

export async function logFeedbackWhatsAppOpenedAction(requestId: string): Promise<ActionResult> {
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
