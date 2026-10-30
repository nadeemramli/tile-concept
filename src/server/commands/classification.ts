"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { uuid } from "@/lib/zod";
import { classifyPursuitSchema, setArrivalSchema, type ClassifyPursuitInput, type SetArrivalInput } from "@/features/classification/schema";
import { getPursuitClassification, type PursuitClassification } from "@/server/queries/classification";

function revalidatePursuit() {
  revalidatePath("/sales/inbox");
  revalidatePath("/sales/pipeline");
  revalidatePath("/sales/classification-review");
}

/** Classification for the inquiry or opportunity drawer, read as the signed-in user. */
export async function loadPursuitClassificationAction(subject: { lead_id?: string; opportunity_id?: string }): Promise<ActionResult<PursuitClassification | null>> {
  try {
    await requirePermission("sales.read");
    if (subject.lead_id) return ok(await getPursuitClassification({ lead_id: uuid().parse(subject.lead_id) }));
    if (subject.opportunity_id) return ok(await getPursuitClassification({ opportunity_id: uuid().parse(subject.opportunity_id) }));
    return fail("Choose an inquiry or an opportunity.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Captures, qualifies or corrects one pursuit's classification through
 * api.classify_pursuit, which validates the values, keeps the inquiry and its
 * opportunity in step and writes the history row.
 */
export async function classifyPursuitAction(input: ClassifyPursuitInput): Promise<ActionResult<{ classification_state: string; classification_version: number }>> {
  const parsed = classifyPursuitSchema.safeParse(input);
  if (!parsed.success) return fail("Check the classification.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc("classify_pursuit", {
      p_request_id: v.request_id,
      p_input: {
        ...(v.lead_id ? { lead_id: v.lead_id } : { opportunity_id: v.opportunity_id }),
        mode: v.mode,
        expected_version: v.expected_version,
        reason: v.reason || null,
        flag_missing: v.flag_missing,
        ...v.values,
        glc_party_role: v.values.glc_involvement === "yes" ? (v.values.glc_party_role ?? "unknown") : null,
      },
    });
    if (error) return fail(error);
    const r = data as { classification_state: string; classification_version: number };
    revalidatePursuit();
    return ok(r, v.mode === "qualification" ? (r.classification_state === "complete" ? "Inquiry qualified and classified." : "Inquiry qualified. The missing classification is flagged for review.") : "Classification saved.");
  } catch (e) {
    return fail(e);
  }
}

/** Corrects an inquiry's arrival time; the database refuses one that would follow a recorded response or visit. */
export async function setInquiryArrivalAction(input: SetArrivalInput): Promise<ActionResult> {
  const parsed = setArrivalSchema.safeParse(input);
  if (!parsed.success) return fail("Check the arrival details.", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("set_inquiry_arrival", {
      p_lead_id: v.lead_id,
      p_arrived_at: v.arrived_at,
      p_basis: v.basis,
      p_precision: v.precision,
      p_reason: v.reason,
      p_request_id: v.request_id,
    });
    if (error) return fail(error);
    revalidatePath("/sales/inbox");
    return ok(undefined, "Arrival time corrected.");
  } catch (e) {
    return fail(e);
  }
}
