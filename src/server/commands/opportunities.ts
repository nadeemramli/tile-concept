"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { addQuoteVersionSchema, changeStageSchema, reassignSchema, updateOpportunitySchema } from "@/features/pipeline/schema";

function revalidateOpp(contactId?: string | null, accountId?: string | null, projectId?: string | null) {
  revalidatePath("/sales/pipeline");
  if (contactId) revalidatePath(`/sales/contacts/${contactId}`);
  if (accountId) revalidatePath(`/sales/accounts/${accountId}`);
  if (projectId) revalidatePath(`/sales/projects/${projectId}`);
}

export async function changeStageAction(input: unknown): Promise<ActionResult> {
  const parsed = changeStageSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("change_opportunity_stage", {
    p_opportunity_id: v.opportunity_id,
    p_to_stage_key: v.to_stage_key,
    p_reason: v.reason,
    p_next_action: v.next_action,
    p_next_action_due_at: v.next_action_due_at ? new Date(v.next_action_due_at).toISOString() : undefined,
    p_outcome_date: v.outcome_date,
  });
  if (error) return fail(error);
  const { data: o } = await supabase.from("opportunities").select("contact_id, account_id, project_id").eq("id", v.opportunity_id).maybeSingle();
  revalidateOpp(o?.contact_id, o?.account_id, o?.project_id);
  revalidatePath("/");
  return ok(undefined, "Stage updated.");
}

export async function updateOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const patch: Database["api"]["Views"]["opportunities"]["Update"] = {
    name: v.name,
    segment: v.segment ?? null,
    estimated_value: v.estimated_value ?? null,
    currency: v.currency,
    probability_band: v.probability_band ?? null,
    expected_close_date: v.expected_close_date ?? null,
    next_action: v.next_action ?? null,
    next_action_due_at: v.next_action_due_at ? new Date(v.next_action_due_at).toISOString() : null,
    product_interest: v.product_interest,
    competitor: v.competitor ?? null,
    notes: v.notes ?? null,
    source_channel: v.source_channel ?? null,
  };
  if (v.owner_id && session.permissions.includes("sales.assign")) patch.owner_id = v.owner_id;
  const { data: o, error } = await supabase.from("opportunities").update(patch).eq("id", v.id).select("contact_id, account_id, project_id").maybeSingle();
  if (error) return fail(error);
  revalidateOpp(o?.contact_id, o?.account_id, o?.project_id);
  return ok(undefined, "Opportunity updated.");
}

export async function reassignOpportunityAction(input: unknown): Promise<ActionResult> {
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form");
  const session = await requireSession();
  if (!session.permissions.includes("sales.assign")) return fail("permission denied: sales.assign");
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data: o, error } = await supabase.from("opportunities").update({ owner_id: v.owner_id }).eq("id", v.opportunity_id).select("contact_id, account_id, project_id").maybeSingle();
  if (error) return fail(error);
  await supabase.from("activities").insert({ workspace_id: session.workspaceId, kind: "system", subject: "Opportunity reassigned", body: v.reason ?? null, actor_id: session.userId, opportunity_id: v.opportunity_id, contact_id: o?.contact_id ?? null, account_id: o?.account_id ?? null });
  revalidateOpp(o?.contact_id, o?.account_id, o?.project_id);
  return ok(undefined, "Owner changed.");
}

export async function addQuoteVersionAction(input: unknown): Promise<ActionResult<{ quote_id: string; version_no: number }>> {
  const parsed = addQuoteVersionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();

  let quoteId = v.quote_id;
  let versionNo = 1;
  if (quoteId) {
    const { data: q } = await supabase.from("quotes").select("current_version_no").eq("id", quoteId).maybeSingle();
    versionNo = (q?.current_version_no ?? 0) + 1;
  } else {
    const { data: q, error } = await supabase.from("quotes").insert({ workspace_id: session.workspaceId, opportunity_id: v.opportunity_id, quote_number: v.quote_number, status: "draft", current_version_no: 0, created_by: session.userId }).select("id").single();
    if (error || !q?.id) return fail(error ?? "Could not create quote");
    quoteId = q.id;
  }
  const { error: vErr } = await supabase.from("quote_versions").insert({
    workspace_id: session.workspaceId,
    quote_id: quoteId,
    version_no: versionNo,
    issued_at: v.issued_at ? new Date(v.issued_at).toISOString() : new Date().toISOString(),
    valid_until: v.valid_until ?? null,
    total_amount: v.total_amount ?? null,
    currency: v.currency,
    external_ref: v.external_ref ?? null,
    notes: v.notes ?? null,
    created_by: session.userId,
  });
  if (vErr) return fail(vErr);
  await supabase.from("quotes").update({ current_version_no: versionNo, status: versionNo > 1 ? "revised" : "issued", quote_number: v.quote_number }).eq("id", quoteId);
  if (v.link_sql_document && v.external_ref) {
    await supabase.from("external_document_links").insert({ workspace_id: session.workspaceId, object_type: "quote", object_id: quoteId, system: "sql_account", document_type: "quotation", document_number: v.external_ref, created_by: session.userId });
  }
  const { data: o } = await supabase.from("opportunities").select("contact_id, account_id, project_id").eq("id", v.opportunity_id).maybeSingle();
  await supabase.from("activities").insert({ workspace_id: session.workspaceId, kind: "note", subject: `Quote ${v.quote_number} v${versionNo} issued`, body: v.total_amount ? `Total ${v.currency} ${v.total_amount}` : null, actor_id: session.userId, opportunity_id: v.opportunity_id, contact_id: o?.contact_id ?? null, account_id: o?.account_id ?? null, project_id: o?.project_id ?? null });
  revalidateOpp(o?.contact_id, o?.account_id, o?.project_id);
  return ok({ quote_id: quoteId, version_no: versionNo }, `Quote version ${versionNo} added.`);
}
