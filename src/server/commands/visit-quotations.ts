"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuid } from "@/lib/zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { QUOTATION_BUCKET, quotationContentType, quotationUploadSchema, type QuotationFile } from "@/features/walkins/quotation-files";

export async function prepareVisitQuotationAction(input: unknown): Promise<ActionResult<string>> {
  const parsed = quotationUploadSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the file.");
  try {
    await requirePermission("sales.write");
    const db = await createServerSupabase();
    const v = parsed.data;
    const { data, error } = await db.rpc("visit_quotation_command", {
      p_action: "prepare", p_visit_id: v.visit_id, p_file_id: v.file_id,
      p_input: { file_name: v.file_name, file_size: v.file_size, content_type: quotationContentType(v.file_name)! },
    });
    if (error || !data) return fail(error ?? "Could not prepare file.");
    return ok(data);
  } catch (e) { return fail(e); }
}

export async function finishVisitQuotationAction(visitId: string, fileId: string): Promise<ActionResult> {
  if (!z.object({ visitId: uuid(), fileId: uuid() }).safeParse({ visitId, fileId }).success) return fail("Invalid file.");
  try {
    await requirePermission("sales.write");
    const db = await createServerSupabase();
    const { error } = await db.rpc("visit_quotation_command", { p_action: "finish", p_visit_id: visitId, p_file_id: fileId });
    if (error) return fail(error);
    revalidatePath("/sales/walk-ins");
    return ok(undefined, "Quotation uploaded.");
  } catch (e) { return fail(e); }
}

export async function listVisitQuotationsAction(visitId: string): Promise<ActionResult<QuotationFile[]>> {
  if (!uuid().safeParse(visitId).success) return fail("Invalid visit.");
  try {
    await requirePermission("sales.read");
    const db = await createServerSupabase();
    const { data, error } = await db.from("visit_quotation_files")
      .select("id,visit_id,file_name,file_size,uploaded_at,created_at").eq("visit_id", visitId).order("created_at", { ascending: false });
    if (error) return fail(error);
    const files: QuotationFile[] = [];
    for (const row of data ?? []) {
      if (!row.id || !row.visit_id || !row.file_name || row.file_size === null || !row.created_at) return fail("Quotation metadata is incomplete.");
      files.push({ id: row.id, visit_id: row.visit_id, file_name: row.file_name, file_size: row.file_size, created_at: row.created_at, uploaded_at: row.uploaded_at });
    }
    return ok(files);
  } catch (e) { return fail(e); }
}

export async function downloadVisitQuotationAction(fileId: string): Promise<ActionResult<string>> {
  if (!uuid().safeParse(fileId).success) return fail("Invalid file.");
  try {
    await requirePermission("sales.read");
    const db = await createServerSupabase();
    const { data: file, error } = await db.from("visit_quotation_files").select("object_path,file_name")
      .eq("id", fileId).not("uploaded_at", "is", null).single();
    if (error || !file?.object_path || !file.file_name) return fail("Quotation file not found or unavailable.");
    const signed = await db.storage.from(QUOTATION_BUCKET).createSignedUrl(file.object_path, 60, { download: file.file_name });
    if (signed.error || !signed.data) return fail(signed.error ?? "Could not prepare download.");
    return ok(signed.data.signedUrl);
  } catch (e) { return fail(e); }
}
