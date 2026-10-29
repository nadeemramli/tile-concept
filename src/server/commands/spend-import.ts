"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { uuid } from "@/lib/zod";
import {
  importSpendBatch, previewSpendImport, summarizeParse, verifySpendBatch, voidSpendBatch, type ReportFile, type ServerPreview, type Verification,
} from "@/features/marketing/spend-import/service";

/** Server actions accept up to 1 MB; a 46-day campaign trend report is a few kilobytes. */
const MAX_UPLOAD = 900 * 1024;

export type SpendImportPreview = {
  summary: ReturnType<typeof summarizeParse>;
  conflicts: ServerPreview["conflicts"];
  duplicateBatch: ServerPreview["duplicate_batch"];
  canImport: boolean;
  importable: boolean;
  blockers: string[];
};

const fields = z.object({
  declared_currency: z.enum(["MYR", ""]).optional(),
  expected_entry_count: z.string().trim().optional(),
  expected_total: z.string().trim().optional(),
  request_id: uuid().optional(),
});

async function readFile(form: FormData): Promise<ReportFile | string> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose the TikTok trend report (CSV or Excel).";
  if (file.size > MAX_UPLOAD) return "The report is larger than 900 KB; export a shorter date range, or import it with the MCP tool.";
  const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  return {
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    declaredCurrency: parsed.success && parsed.data.declared_currency === "MYR" ? "MYR" : undefined,
  };
}

function expectation(form: FormData) {
  const parsed = fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return null;
  const count = parsed.data.expected_entry_count ? Number(parsed.data.expected_entry_count) : undefined;
  return { entryCount: count, total: parsed.data.expected_total || undefined, requestId: parsed.data.request_id };
}

export async function previewSpendImportAction(form: FormData): Promise<ActionResult<SpendImportPreview>> {
  try {
    await requirePermission("marketing.spend.read");
    const file = await readFile(form);
    if (typeof file === "string") return fail(file);
    const expected = expectation(form);
    const db = await createServerSupabase();
    const preview = await previewSpendImport(db, file, { entryCount: expected?.entryCount, total: expected?.total });
    if (!preview.ok) return fail(preview.error);
    return ok({
      summary: summarizeParse(preview.parse), conflicts: preview.server?.conflicts ?? [], duplicateBatch: preview.server?.duplicate_batch ?? null,
      canImport: preview.server?.can_import ?? false, importable: preview.importable, blockers: preview.blockers,
    });
  } catch (error) { return fail(error); }
}

export async function importSpendBatchAction(form: FormData): Promise<ActionResult<{ batchId: string; verification: Verification | null }>> {
  try {
    await requirePermission("marketing.spend.write");
    const file = await readFile(form);
    if (typeof file === "string") return fail(file);
    const expected = expectation(form);
    if (!expected?.requestId || expected.entryCount === undefined || expected.total === undefined) return fail("Preview the report and confirm its date count and total before importing.");
    const db = await createServerSupabase();
    const result = await importSpendBatch(db, file, { entryCount: expected.entryCount, total: expected.total }, expected.requestId);
    if (!result.ok) return fail(result.error);
    revalidatePath("/marketing/spend"); revalidatePath("/insights/reports/funnel");
    return ok({ batchId: result.batchId, verification: result.verification });
  } catch (error) { return fail(error); }
}

export async function verifySpendBatchAction(batchId: unknown): Promise<ActionResult<Verification>> {
  try {
    await requirePermission("marketing.spend.read");
    const id = uuid().safeParse(batchId);
    if (!id.success) return fail("Choose an import batch.");
    const db = await createServerSupabase();
    const result = await verifySpendBatch(db, id.data);
    return result.ok ? ok(result.verification) : fail(result.error);
  } catch (error) { return fail(error); }
}

const voidSchema = z.object({ batch_id: uuid(), reason: z.string().trim().min(5, "Explain why the batch is being voided").max(2000), request_id: uuid() });

export async function voidSpendBatchAction(input: unknown): Promise<ActionResult<string>> {
  try {
    await requirePermission("marketing.spend.review");
    const parsed = voidSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the void details");
    const db = await createServerSupabase();
    const result = await voidSpendBatch(db, parsed.data.batch_id, parsed.data.reason, parsed.data.request_id);
    if (!result.ok) return fail(result.error);
    revalidatePath("/marketing/spend"); revalidatePath("/insights/reports/funnel");
    return ok(result.batchId);
  } catch (error) { return fail(error); }
}
