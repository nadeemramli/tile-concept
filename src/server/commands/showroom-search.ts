"use server";

import { z } from "zod";
import { uuid } from "@/lib/zod";
import { requirePermission } from "@/server/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/server/action-result";
import type { IdentityCandidate } from "@/features/inbox/types";

export async function searchShowroomCustomersAction(query: string, accountId?: string): Promise<ActionResult<IdentityCandidate[]>> {
  const parsed = z.object({ query: z.string().trim().max(200), accountId: uuid().optional() }).safeParse({ query, accountId });
  if (!parsed.success || (!accountId && parsed.data.query.length < 2)) return fail("Enter at least two characters of a company, contact, telephone or email.");
  try {
    await requirePermission("sales.read");
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("showroom_customer_search", { p_query: parsed.data.query, p_account_id: accountId, p_limit: 50 });
    if (error) return fail(error);
    return ok((data ?? []) as unknown as IdentityCandidate[]);
  } catch (e) { return fail(e); }
}
