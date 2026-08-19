"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { createAccountSchema, updateAccountSchema } from "@/features/crm/schema";

export async function createAccountAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      workspace_id: session.workspaceId,
      name: v.name,
      account_type: v.account_type ?? null,
      registration_number: v.registration_number ?? null,
      website: v.website ?? null,
      address: { city: v.city ?? "", state: v.state ?? "", country: "MY" },
      owner_id: v.owner_id ?? session.userId,
      original_acquisition_source: v.source ?? null,
      original_acquisition_at: v.source ? new Date().toISOString() : null,
      notes: v.notes ?? null,
      created_by: session.userId,
      updated_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data?.id) return fail(error ?? "Could not create account");
  revalidatePath("/sales/accounts");
  return ok({ id: data.id }, "Account created.");
}

export async function updateAccountAction(input: unknown): Promise<ActionResult> {
  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the form", parsed.error.flatten().fieldErrors);
  const session = await requireSession();
  const v = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("accounts")
    .update({ name: v.name, account_type: v.account_type ?? null, registration_number: v.registration_number ?? null, website: v.website ?? null, address: { city: v.city ?? "", state: v.state ?? "", country: "MY" }, owner_id: v.owner_id ?? null, notes: v.notes ?? null, updated_by: session.userId })
    .eq("id", v.id);
  if (error) return fail(error);
  revalidatePath(`/sales/accounts/${v.id}`);
  revalidatePath("/sales/accounts");
  return ok(undefined, "Account updated.");
}

export async function addAccountAliasAction(accountId: string, alias: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!alias.trim()) return fail("Alias is required");
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("account_aliases").insert({ workspace_id: session.workspaceId, account_id: accountId, alias: alias.trim(), source: "manual" });
  if (error) return fail(error);
  revalidatePath(`/sales/accounts/${accountId}`);
  return ok(undefined, "Alias added.");
}
