import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import type { CustomerFeedbackAnswer, CustomerFeedbackView, FeedbackPurchaseContext, FeedbackRequestRow } from "@/features/feedback/types";
import { hashFeedbackToken } from "@/features/feedback/token";

export async function getFeedbackPurchaseContext(purchaseId: string): Promise<FeedbackPurchaseContext | null> {
  await requirePermission("sales.write");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("feedback_purchase_context", { p_purchase_id: purchaseId }).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    purchase_id: data.purchase_id,
    purchase_ref: data.purchase_ref,
    purchased_at: data.purchased_at,
    amount: Number(data.amount),
    currency: data.currency,
    contact_id: data.contact_id,
    customer_name: data.customer_name,
    phone: data.phone,
    visit_id: data.visit_id,
    location_id: data.location_id,
    location_name: data.location_name,
    salesperson_id: data.salesperson_id,
    salesperson_name: data.salesperson_name,
    existing_request_id: data.existing_request_id,
  };
}

export async function listFeedbackRequests(limit = 300): Promise<FeedbackRequestRow[]> {
  await requirePermission("sales.read");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("feedback_requests").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).filter((row) => row.id && row.purchase_id && row.contact_id).map((row) => ({
    id: row.id!,
    purchase_id: row.purchase_id!,
    visit_id: row.visit_id,
    contact_id: row.contact_id!,
    customer_name: row.customer_name ?? "Customer",
    purchase_ref: row.purchase_ref,
    purchased_at: row.purchased_at ?? row.created_at!,
    purchase_amount: Number(row.purchase_amount ?? 0),
    purchase_currency: row.purchase_currency ?? "MYR",
    location_name: row.location_name,
    salesperson_name: row.salesperson_name,
    status: row.status ?? "awaiting_customer",
    benefit_status: row.benefit_status ?? "not_offered",
    customer_confirmed_at: row.customer_confirmed_at,
    google_handoff_opened_at: row.google_handoff_opened_at,
    has_photo: Boolean(row.has_photo),
    created_at: row.created_at!,
  }));
}

export async function getCustomerFeedback(tokenHash: string): Promise<CustomerFeedbackView | null> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("get_feedback_by_token", { p_token_hash: tokenHash }).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const answers = Array.isArray(data.answers) ? (data.answers as unknown as CustomerFeedbackAnswer[]) : [];
  return {
    request_id: data.request_id,
    status: data.status,
    expires_at: data.expires_at,
    customer_name: data.customer_name,
    purchased_at: data.purchased_at,
    location_name: data.location_name,
    answers,
    draft_text: data.draft_text,
    has_photo: data.has_photo,
    review_url: data.review_url,
    benefit_status: data.benefit_status,
  };
}

export async function loadCustomerFeedbackByToken(token: string): Promise<CustomerFeedbackView | null> {
  const tokenHash = hashFeedbackToken(token);
  const admin = createAdminSupabase();
  const [{ data, error }, event] = await Promise.all([
    admin.rpc("get_feedback_by_token", { p_token_hash: tokenHash }).maybeSingle(),
    admin.rpc("log_feedback_customer_event", { p_token_hash: tokenHash, p_event_type: "customer_link_opened" }),
  ]);
  if (error) throw error;
  if (event.error) throw event.error;
  if (!data) return null;
  return {
    request_id: data.request_id,
    status: data.status,
    expires_at: data.expires_at,
    customer_name: data.customer_name,
    purchased_at: data.purchased_at,
    location_name: data.location_name,
    answers: Array.isArray(data.answers) ? (data.answers as unknown as CustomerFeedbackAnswer[]) : [],
    draft_text: data.draft_text,
    has_photo: data.has_photo,
    review_url: data.review_url,
    benefit_status: data.benefit_status,
  };
}

export async function loadFeedbackMediaByToken(token: string) {
  const tokenHash = hashFeedbackToken(token);
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("get_feedback_media_by_token", { p_token_hash: tokenHash }).maybeSingle();
  if (error) throw error;
  return { admin, media: data, tokenHash };
}
