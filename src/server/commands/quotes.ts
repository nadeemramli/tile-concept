"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";
import { uuid } from "@/lib/zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { getQuoteContext } from "@/server/queries/quotes";
import { QuoteInputError, quoteCommandSchema, toQuoteRpcInput, type QuoteAction } from "@/features/quotes/schema";
import type { QuoteAnchor, QuoteContext } from "@/features/quotes/types";

const anchorSchema = z.union([
  z.object({ lead_id: uuid() }).strict(),
  z.object({ visit_id: uuid() }).strict(),
  z.object({ opportunity_id: uuid() }).strict(),
]);

/** The quote panel loads on demand so opening a drawer stays a shallow URL update. */
export async function loadQuoteContextAction(anchor: QuoteAnchor): Promise<ActionResult<QuoteContext>> {
  const parsed = anchorSchema.safeParse(anchor);
  if (!parsed.success) return fail("Choose an inquiry, visit or opportunity.");
  try {
    await requirePermission("sales.read");
    return ok(await getQuoteContext(parsed.data));
  } catch (e) {
    return fail(e);
  }
}

const DONE: Record<QuoteAction, string> = {
  prepare: "Quote recorded.",
  revise: "Revision recorded.",
  issue: "Version issued.",
  send: "Send recorded.",
  void_send: "Send record voided.",
  accept: "Quote marked accepted.",
  reject: "Quote marked rejected.",
  expire: "Quote marked expired.",
  reopen: "Quote reopened.",
  resolve_evidence: "Evidence review saved.",
};

/**
 * Every quotation write goes through `api.quote_command`. The caller keeps the
 * same request_id while the form is unchanged, so a retry after a timeout or a
 * double click replays the first result instead of recording a second fact.
 */
export async function quoteCommandAction(input: unknown): Promise<ActionResult<Record<string, unknown>>> {
  const parsed = quoteCommandSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path.filter((p) => p !== "input").join(".") || "form");
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return fail(parsed.error.issues[0]?.message ?? "Check the form", fieldErrors);
  }
  let payload: Record<string, unknown>;
  try {
    payload = toQuoteRpcInput(parsed.data);
  } catch (e) {
    if (e instanceof QuoteInputError) return fail(e.message, { [e.field]: [e.message] });
    return fail(e);
  }
  try {
    await requirePermission("sales.write");
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("quote_command", { p_action: parsed.data.action, p_input: payload as Json, p_request_id: parsed.data.request_id });
    if (error || !data) return fail(error ?? "The quote was not saved");
    const result = data as Record<string, unknown>;
    revalidatePath("/sales/inbox");
    revalidatePath("/sales/walk-ins");
    revalidatePath("/sales/pipeline");
    const message = result.duplicate === true ? "That send was already recorded; nothing new was added." : result.already_issued === true ? "That version was already issued." : DONE[parsed.data.action];
    return ok(result, message);
  } catch (e) {
    return fail(e);
  }
}
