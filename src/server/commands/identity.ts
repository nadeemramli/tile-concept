"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { mergeSchema, rejectSchema, unmergeSchema } from "@/features/identity/schema";

function revalidateIdentity(ids: string[]) {
  revalidatePath("/sales/identity-review");
  revalidatePath("/sales/accounts");
  for (const id of ids) revalidatePath(`/sales/contacts/${id}`);
}

export async function mergeContactsAction(input: unknown): Promise<ActionResult<{ event_id: string }>> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("merge_contacts", { p_survivor_id: v.survivor_id, p_merged_id: v.merged_id, p_reason: v.reason, p_candidate_id: v.candidate_id });
  if (error || !data) return fail(error ?? "Merge failed");
  revalidateIdentity([v.survivor_id, v.merged_id]);
  return ok({ event_id: data }, "Contacts merged. This can be reversed from merge history.");
}

export async function rejectCandidateAction(input: unknown): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form");
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("reject_identity_candidate", { p_candidate_id: v.candidate_id, p_note: v.note || undefined });
  if (error) return fail(error);
  revalidateIdentity([]);
  return ok(undefined, "Marked as not a duplicate. This pair will not be suggested again without new evidence.");
}

export async function unmergeContactsAction(input: unknown): Promise<ActionResult> {
  const parsed = unmergeSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("unmerge_contacts", { p_merge_event_id: v.merge_event_id, p_reason: v.reason });
  if (error) return fail(error);
  revalidateIdentity([]);
  return ok(undefined, "Merge reversed. Contact points and relationships restored.");
}

/** Run duplicate suggestion over the most recent contacts (cap 200). */
export async function scanDuplicatesAction(limit = 200): Promise<ActionResult<{ scanned: number; candidates: number }>> {
  await requireSession();
  const supabase = await createServerSupabase();
  const { data: contacts, error } = await supabase.from("contacts").select("id").is("merged_into_contact_id", null).is("archived_at", null).order("created_at", { ascending: false }).limit(Math.min(limit, 200));
  if (error) return fail(error);
  let total = 0;
  for (const c of contacts ?? []) {
    if (!c.id) continue;
    const { data: n } = await supabase.rpc("suggest_contact_duplicates", { p_contact_id: c.id });
    total += n ?? 0;
  }
  revalidateIdentity([]);
  return ok({ scanned: contacts?.length ?? 0, candidates: total }, `Scanned ${contacts?.length ?? 0} contacts; ${total} candidate pair${total === 1 ? "" : "s"} refreshed.`);
}
