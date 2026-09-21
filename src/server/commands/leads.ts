"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { uuid } from "@/lib/zod";
import { convertLeadSchema, logResponseSchema, newInquirySchema, type NewInquiryInput } from "@/features/inbox/schema";
import { whereIsLead, whereSentence } from "@/features/inbox/lib/whereabouts";
import type { IdentityCandidate } from "@/features/inbox/types";

const INBOX = "/sales/inbox";

function blank(v: string | undefined | null) {
  return v && v.length > 0 ? v : null;
}

export async function createInquiryAction(input: NewInquiryInput, requestId: string): Promise<ActionResult<{ lead_id: string; identity_state: string; suggestions: IdentityCandidate[] }>> {
  const parsed = newInquirySchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  if (!uuid().safeParse(requestId).success) return fail("A valid save request is required. Reopen the inquiry form.");
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("create_manual_inquiry", { p_input: v, p_request_id: requestId });
    if (error) return fail(error);
    const result = data as { lead_id: string; identity_state: string };
    // Suggestions are advisory. A failed search must not turn a committed save
    // into a failure that invites another inquiry to be created.
    let suggestions: IdentityCandidate[] = [];
    try { suggestions = await findCandidates({ phone: v.raw_phone, email: v.raw_email, name: v.raw_name, company: v.raw_company }); } catch { /* Recover from the saved inquiry drawer. */ }

    revalidatePath(INBOX);
    revalidatePath("/");
    return ok({ lead_id: result.lead_id, identity_state: result.identity_state, suggestions },
      result.identity_state === "matched" ? "Inquiry recorded and linked to the uniquely matched customer."
      : result.identity_state === "needs_review" ? "Inquiry recorded. Shared, conflicting or provisional customer details need review; no contact was linked."
      : "Inquiry recorded. Find or create its customer record from the inquiry drawer.");
  } catch (e) {
    return fail(e);
  }
}

async function findCandidates(input: { phone?: string | null; email?: string | null; name?: string | null; company?: string | null }): Promise<IdentityCandidate[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("find_identity_candidates", {
    p_phone: blank(input.phone) ?? undefined,
    p_email: blank(input.email) ?? undefined,
    p_name: blank(input.name) ?? undefined,
    p_company: blank(input.company) ?? undefined,
    p_limit: 10,
  });
  return (data ?? []).map((c) => ({
    entity_type: c.entity_type as IdentityCandidate["entity_type"],
    entity_id: String(c.entity_id),
    display_name: String(c.display_name ?? ""),
    confidence: (c.confidence as IdentityCandidate["confidence"]) ?? "low",
    score: Number(c.score ?? 0),
    reasons: (c.reasons as unknown as IdentityCandidate["reasons"]) ?? [],
    masked_phone: c.masked_phone,
    masked_email: c.masked_email,
    lifecycle_state: c.lifecycle_state,
    last_activity_at: c.last_activity_at,
  }));
}

export async function findLeadMatchesAction(leadId: string): Promise<ActionResult<IdentityCandidate[]>> {
  try {
    await requirePermission("sales.read");
    const supabase = await createServerSupabase();
    const { data: lead } = await supabase.from("leads").select("raw_phone, raw_email, raw_name, raw_company").eq("id", leadId).maybeSingle();
    if (!lead) return fail("Lead not found");
    return ok(await findCandidates({ phone: lead.raw_phone, email: lead.raw_email, name: lead.raw_name, company: lead.raw_company }));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Links an enquiry to a customer record through api.link_lead_contact, which
 * carries the enquiry's phone/email onto the contact, moves activity logged
 * before the link, checks owner scope and audits it.
 */
export async function linkLeadIdentityAction(input: { lead_id: string; contact_id?: string | null; account_id?: string | null }): Promise<ActionResult> {
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("link_lead_contact", {
      p_lead_id: input.lead_id,
      p_contact_id: blank(input.contact_id) ?? undefined,
      p_account_id: blank(input.account_id) ?? undefined,
    });
    if (error) return fail(error);
    revalidatePath(INBOX);
    revalidatePath("/sales/accounts");
    return ok(undefined, "Enquiry linked to the customer record.");
  } catch (e) {
    return fail(e);
  }
}

export async function createContactForLeadAction(input: { lead_id: string; display_name: string; customer_type?: string | null }): Promise<ActionResult<{ contact_id: string }>> {
  const name = z.string().trim().min(2).max(200).safeParse(input.display_name);
  if (!name.success) return fail("Enter a contact name.");
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: lead } = await supabase.from("leads").select("raw_phone, raw_email, source_channel, account_id").eq("id", input.lead_id).maybeSingle();
    if (!lead) return fail("Lead not found");
    const { data: contactId, error } = await supabase.rpc("create_contact", {
      p_display_name: name.data,
      p_phone: lead.raw_phone ?? undefined,
      p_email: lead.raw_email ?? undefined,
      p_customer_type: input.customer_type ?? undefined,
      p_source: lead.source_channel ?? undefined,
      p_account_id: lead.account_id ?? undefined,
      p_is_provisional: false,
    });
    if (error || !contactId) return fail(error ?? "Could not create contact");
    const { error: linkErr } = await supabase.rpc("link_lead_contact", { p_lead_id: input.lead_id, p_contact_id: contactId, p_account_id: lead.account_id ?? undefined });
    if (linkErr) return fail(linkErr);
    await supabase.rpc("suggest_contact_duplicates", { p_contact_id: contactId });
    revalidatePath(INBOX);
    revalidatePath("/sales/accounts");
    return ok({ contact_id: contactId }, "Contact created and linked.");
  } catch (e) {
    return fail(e);
  }
}

export async function assignLeadAction(input: { lead_id: string; owner_id: string; reason?: string }): Promise<ActionResult> {
  try {
    await requirePermission("sales.assign");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("assign_lead", { p_lead_id: input.lead_id, p_owner_id: input.owner_id, p_reason: input.reason || undefined });
    if (error) return fail(error);
    revalidatePath(INBOX);
    revalidatePath("/");
    return ok(undefined, "Lead assigned.");
  } catch (e) {
    return fail(e);
  }
}

export async function bulkAssignLeadsAction(input: { lead_ids: string[]; owner_id: string }): Promise<ActionResult<{ assigned: number }>> {
  if (input.lead_ids.length === 0) return fail("No leads selected.");
  try {
    await requirePermission("sales.assign");
    const supabase = await createServerSupabase();
    let assigned = 0;
    for (const id of input.lead_ids.slice(0, 200)) {
      const { error } = await supabase.rpc("assign_lead", { p_lead_id: id, p_owner_id: input.owner_id, p_reason: "Bulk assignment" });
      if (!error) assigned += 1;
    }
    revalidatePath(INBOX);
    revalidatePath("/");
    return ok({ assigned }, `${assigned} lead${assigned === 1 ? "" : "s"} assigned.`);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Logs a call, message or email. The message that comes back says where the
 * lead now sits in the inbox, because a response moves it out of "New" and
 * an unowned lead becomes the responder's.
 */
export async function logLeadResponseAction(input: z.input<typeof logResponseSchema>): Promise<ActionResult> {
  const parsed = logResponseSchema.safeParse(input);
  if (!parsed.success) return fail("Check the response details.");
  const v = parsed.data;
  try {
    const session = await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data: before } = await supabase.from("leads").select("owner_id").eq("id", v.lead_id).maybeSingle();
    const { error } = await supabase.rpc("log_lead_response", { p_lead_id: v.lead_id, p_kind: v.kind, p_channel: v.channel, p_body: blank(v.body) ?? undefined, p_reached: v.reached });
    if (error) return fail(error);
    const { data: after } = await supabase
      .from("leads")
      .select("status, owner_id, source_channel, first_response_at, first_response_due_at, duplicate_of_lead_id, created_at")
      .eq("id", v.lead_id)
      .maybeSingle();
    revalidatePath(INBOX);
    revalidatePath("/");
    const logged = v.reached ? "Response logged." : "Attempt logged.";
    if (!after) return ok(undefined, logged);
    const where = whereSentence(
      whereIsLead(
        {
          status: after.status ?? "new",
          owner_id: after.owner_id,
          source_channel: after.source_channel ?? "other",
          first_response_at: after.first_response_at,
          first_response_due_at: after.first_response_due_at,
          // Reminders live on tasks; the drawer shows them, the toast only needs the home view.
          next_follow_up_at: null,
          duplicate_of_lead_id: after.duplicate_of_lead_id,
          created_at: after.created_at ?? new Date().toISOString(),
        },
        session.userId,
      ),
    );
    const claimed = !before?.owner_id && after.owner_id === session.userId ? " This lead is now yours." : "";
    return ok(undefined, `${logged} ${where}${claimed}`);
  } catch (e) {
    return fail(e);
  }
}

export async function qualifyLeadAction(leadId: string): Promise<ActionResult> {
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("leads").update({ status: "qualified", qualified_at: new Date().toISOString() }).eq("id", leadId);
    if (error) return fail(error);
    revalidatePath(INBOX);
    return ok(undefined, "Lead qualified.");
  } catch (e) {
    return fail(e);
  }
}

export async function markLeadDuplicateAction(input: { lead_id: string; duplicate_of_lead_id: string }): Promise<ActionResult> {
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.from("leads").update({ status: "duplicate", duplicate_of_lead_id: input.duplicate_of_lead_id }).eq("id", input.lead_id);
    if (error) return fail(error);
    revalidatePath(INBOX);
    return ok(undefined, "Marked as duplicate.");
  } catch (e) {
    return fail(e);
  }
}

export async function convertLeadAction(input: z.input<typeof convertLeadSchema>): Promise<ActionResult<{ opportunity_id: string; project_id: string }>> {
  const parsed = convertLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Check the conversion details.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("convert_lead", {
      p_lead_id: v.lead_id,
      p_contact_id: v.contact_id,
      p_account_id: blank(v.account_id) ?? undefined,
      p_project_name: v.project_name,
      p_opportunity_name: v.opportunity_name,
      p_estimated_value: v.estimated_value ?? undefined,
      p_next_action: v.next_action,
      p_next_action_due_at: new Date(v.next_action_due_at).toISOString(),
    });
    if (error) return fail(error);
    const r = data as { opportunity_id: string; project_id: string };
    revalidatePath(INBOX);
    revalidatePath("/sales/pipeline");
    revalidatePath("/sales/projects");
    revalidatePath("/");
    return ok(r, "Lead converted to opportunity.");
  } catch (e) {
    return fail(e);
  }
}
