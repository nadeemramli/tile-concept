"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { addActivitySchema, addTaskSchema, createContactSchema, linkContactAccountSchema, updateContactSchema } from "@/features/crm/schema";
import { normalizePhone } from "@/lib/identity/normalize";
import { searchAccounts, searchContacts } from "@/server/queries/contacts";

export async function createContactAction(input: unknown): Promise<ActionResult<{ id: string; duplicates: number }>> {
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data: id, error } = await supabase.rpc("create_contact", {
    p_display_name: v.display_name,
    p_phone: v.phone ? normalizePhone(v.phone) ?? v.phone : undefined,
    p_email: v.email,
    p_customer_type: v.customer_type,
    p_source: v.source,
    p_account_id: v.account_id,
    p_is_provisional: false,
    p_notes: v.notes,
  });
  if (error || !id) return fail(error ?? "Could not create contact");
  const { data: dup } = await supabase.rpc("suggest_contact_duplicates", { p_contact_id: id });
  revalidatePath("/sales/accounts");
  revalidatePath("/sales/identity-review");
  return ok({ id, duplicates: dup ?? 0 }, dup ? `Contact created. ${dup} possible duplicate${dup > 1 ? "s" : ""} sent to Identity Review.` : "Contact created.");
}

export async function updateContactAction(input: unknown): Promise<ActionResult> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("contacts")
    .update({ display_name: v.display_name, given_name: v.given_name ?? null, family_name: v.family_name ?? null, customer_type: v.customer_type ?? null, preferred_language: v.preferred_language ?? null, notes: v.notes ?? null, updated_by: session.userId })
    .eq("id", v.id);
  if (error) return fail(error);
  revalidatePath(`/sales/contacts/${v.id}`);
  revalidatePath("/sales/accounts");
  return ok(undefined, "Contact updated.");
}

export async function addContactPointAction(input: { contact_id: string; kind: "phone" | "whatsapp" | "email" | "other"; value: string; label?: string; is_primary?: boolean }): Promise<ActionResult> {
  const session = await requireSession();
  const raw = input.value?.trim();
  if (!raw) return fail("Value is required");
  const normalized = input.kind === "email" ? raw.toLowerCase() : input.kind === "other" ? raw : normalizePhone(raw) ?? raw;
  const supabase = await createServerSupabase();
  if (input.is_primary) await supabase.from("contact_points").update({ is_primary: false }).eq("contact_id", input.contact_id).eq("kind", input.kind);
  const { error } = await supabase.from("contact_points").insert({ workspace_id: session.workspaceId, contact_id: input.contact_id, kind: input.kind, raw_value: raw, normalized_value: normalized, label: input.label ?? null, is_primary: !!input.is_primary, source: "manual" });
  if (error) return fail(error);
  await supabase.rpc("suggest_contact_duplicates", { p_contact_id: input.contact_id });
  revalidatePath(`/sales/contacts/${input.contact_id}`);
  return ok(undefined, "Contact point added.");
}

export async function revealContactPointsAction(contactId: string): Promise<ActionResult<{ id: string; kind: string; raw_value: string; normalized_value: string; is_primary: boolean; label: string | null }[]>> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("reveal_contact_points", { p_contact_id: contactId });
  if (error) return fail(error);
  return ok((data ?? []).map((d) => ({ id: d.id, kind: d.kind, raw_value: d.raw_value, normalized_value: d.normalized_value, is_primary: !!d.is_primary, label: d.label })));
}

export async function addActivityAction(input: unknown): Promise<ActionResult> {
  const parsed = addActivitySchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("activities").insert({
    workspace_id: session.workspaceId,
    kind: v.kind,
    channel: v.channel ?? null,
    subject: v.subject,
    body: v.body ?? null,
    actor_id: session.userId,
    contact_id: v.contact_id ?? null,
    account_id: v.account_id ?? null,
    project_id: v.project_id ?? null,
    opportunity_id: v.opportunity_id ?? null,
  });
  if (error) return fail(error);
  revalidateLinked(v);
  return ok(undefined, "Activity logged.");
}

export async function addTaskAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: session.workspaceId,
      title: v.title,
      due_at: v.due_at ? new Date(v.due_at).toISOString() : null,
      priority: v.priority,
      assignee_id: v.assignee_id ?? session.userId,
      created_by: session.userId,
      contact_id: v.contact_id ?? null,
      account_id: v.account_id ?? null,
      project_id: v.project_id ?? null,
      opportunity_id: v.opportunity_id ?? null,
    })
    .select("id")
    .single();
  if (error || !data?.id) return fail(error ?? "Could not create task");
  revalidateLinked(v);
  revalidatePath("/sales/tasks");
  return ok({ id: data.id }, "Task created.");
}

export async function linkContactAccountAction(input: unknown): Promise<ActionResult> {
  const parsed = linkContactAccountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("account_contact_relationships").insert({ workspace_id: session.workspaceId, contact_id: v.contact_id, account_id: v.account_id, role: v.role ?? null, is_primary: v.is_primary });
  if (error) return fail(error);
  revalidatePath(`/sales/contacts/${v.contact_id}`);
  revalidatePath(`/sales/accounts/${v.account_id}`);
  return ok(undefined, "Linked.");
}

export async function unlinkContactAccountAction(relId: string, contactId: string, accountId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createServerSupabase();
  // No delete permission for non-admins by policy; mark ended instead.
  const { error } = await supabase.from("account_contact_relationships").update({ ended_at: new Date().toISOString().slice(0, 10), is_primary: false }).eq("id", relId);
  if (error) return fail(error);
  void session;
  revalidatePath(`/sales/contacts/${contactId}`);
  revalidatePath(`/sales/accounts/${accountId}`);
  return ok(undefined, "Relationship ended.");
}

export async function addConsentAction(input: { contact_id: string; channel: string; purpose: string; status: "granted" | "declined" | "withdrawn" | "unknown"; evidence?: string }): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("consent_records").insert({ workspace_id: session.workspaceId, contact_id: input.contact_id, channel: input.channel, purpose: input.purpose, status: input.status, evidence: input.evidence ?? null, recorded_by: session.userId });
  if (error) return fail(error);
  revalidatePath(`/sales/contacts/${input.contact_id}`);
  return ok(undefined, "Consent recorded.");
}

export async function searchAccountsAction(q: string) {
  if (q.trim().length < 1) return [];
  return searchAccounts(q.trim());
}

export async function searchContactsAction(q: string) {
  if (q.trim().length < 1) return [];
  return searchContacts(q.trim());
}

function revalidateLinked(v: { contact_id?: string; account_id?: string; project_id?: string; opportunity_id?: string }) {
  if (v.contact_id) revalidatePath(`/sales/contacts/${v.contact_id}`);
  if (v.account_id) revalidatePath(`/sales/accounts/${v.account_id}`);
  if (v.project_id) revalidatePath(`/sales/projects/${v.project_id}`);
  if (v.opportunity_id) revalidatePath("/sales/pipeline");
}
