"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireSession } from "@/server/session";

const quantity = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).transform(Number);

const versionNumber = z.string().regex(/^\d+$/).transform(Number).pipe(z.int().max(2147483647));

function preparationError(code: string) {
  if (code === "40001" || code === "P0001" || code === "23505") return "stale";
  if (code === "23514") return "limit";
  if (code === "42501") return "denied";
  if (code === "22023") return "invalid";
  return "failed";
}

export async function recordPreparation(_previous: string, form: FormData): Promise<string> {
  const session = await requireSession();
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !session.permissions.includes("preparation.read")) {
    return "denied";
  }
  const request = z.object({
    line: z.uuid(),
    version: versionNumber,
    request: z.uuid(),
    quantity,
    shortage: quantity,
    allocation: z.uuid().optional(),
  }).safeParse({
    line: form.get("line"),
    version: form.get("version"),
    request: form.get("request"),
    quantity: form.get("quantity"),
    shortage: form.get("shortage") ?? "0",
    allocation: form.get("allocation") ?? undefined,
  });
  if (!request.success) return "invalid";
  const { line, version, request: id, quantity: amount, shortage, allocation } = request.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_preparation", {
    p_line_id: line, p_version: version, p_request_id: id,
    p_quantity: amount, p_shortage: shortage, p_allocation_id: allocation,
  });
  if (error) return preparationError(error.code);
  revalidatePath("/admin/preparation");
  return "";
}


export async function recordWarehouseStage(_previous: string, form: FormData): Promise<string> {
  const session = await requireSession();
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !session.permissions.includes("preparation.read")) {
    return "denied";
  }
  const request = z.object({
    line: z.uuid(),
    allocation: z.uuid(),
    version: versionNumber,
    request: z.uuid(),
    stage: z.enum(["ready", "handed_over"]),
    quantity,
    recipient: z.string().trim().min(1).max(120).optional(),
  }).safeParse({
    line: form.get("line"),
    allocation: form.get("allocation"),
    version: form.get("version"),
    request: form.get("request"),
    stage: form.get("stage"),
    quantity: form.get("quantity"),
    recipient: form.get("recipient") ?? undefined,
  });
  if (!request.success) return "invalid";
  const { line, allocation, version, request: id, stage, quantity: amount, recipient } = request.data;
  if (stage === "handed_over" && !recipient) return "recipient";
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("record_warehouse_stage", {
    p_line_id: line, p_allocation_id: allocation, p_version: version,
    p_request_id: id, p_stage: stage, p_quantity: amount, p_recipient: recipient,
  });
  if (error) return preparationError(error.code);
  revalidatePath("/admin/preparation");
  return "";
}
