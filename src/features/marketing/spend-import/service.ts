/**
 * Preview, import, verify and void marketing-cost batches.
 *
 * Shared by the server actions (cookie session) and the MCP server (a member
 * session minted for the operator), so both reach the same `api.*` functions
 * as a real member: the database decides permission, duplicates, overlaps and
 * every ledger rule. This module only parses, reconciles and reports.
 */
import { z } from "zod";
import {
  formatCents, moneyCents, parseTikTokTrendReport, reconcile, toBatchPayload, TIKTOK_VENDOR,
  type Expectation, type TikTokTrendParse,
} from "./tiktok-trend";

/** The slice of a Supabase client this module needs (any `api`-schema client fits). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface ReportFile {
  fileName: string;
  bytes: Uint8Array;
  declaredCurrency?: "MYR";
  vendor?: string;
}

const money = z.coerce.number();
const conflictSchema = z.object({
  incurred_on: z.string(), entry_id: z.string(), entry_mode: z.string(), entry_key: z.string(), before_tax: money, tax: money.nullable(),
  tax_status: z.string(), import_batch_id: z.string().nullable(), reference: z.string(), report_before_tax: money.nullable(), same_amount: z.boolean().nullable(),
});
export const serverPreviewSchema = z.object({
  importable: z.boolean(), can_import: z.boolean(), issues: z.array(z.string()),
  duplicate_batch: z.object({ id: z.string(), imported_at: z.string(), source_name: z.string(), entry_count: z.number(), total_before_tax: money }).nullable(),
  conflicts: z.array(conflictSchema),
});
const lineSchema = z.object({
  incurred_on: z.string(), imported_before_tax: money, campaign_count: z.number(), source_rows: z.array(z.number()), entry_id: z.string(),
  ledger_status: z.string(), ledger_before_tax: money, ledger_tax: money.nullable(), ledger_tax_status: z.string(), version: z.number(),
  state: z.enum(["matches", "edited", "corrected", "voided"]),
});
export const verificationSchema = z.object({
  batch: z.object({
    id: z.string(), status: z.enum(["imported", "voided"]), source_name: z.string(), source_sha256: z.string(), source_format: z.string(),
    parser_version: z.string(), currency: z.string(), currency_basis: z.string(), tax_status: z.string(), vendor: z.string(),
    report_date_from: z.string(), report_date_to: z.string(), entry_count: z.number(), total_before_tax: money,
    excluded_zero_dates: z.array(z.string()), imported_at: z.string(), imported_by: z.string(),
    voided_at: z.string().nullable(), void_reason: z.string().nullable(),
  }),
  lines: z.array(lineSchema),
  overlaps: z.array(z.object({ incurred_on: z.string(), entry_id: z.string(), entry_mode: z.string(), entry_key: z.string() })),
  issues: z.array(z.string()),
  summary: z.object({
    entries: z.number(), imported_before_tax: money, matching: z.number(), edited: z.number(), corrected: z.number(), voided: z.number(),
    ledger_before_tax: money, tax_unreported: z.number(),
  }),
  reconciled: z.boolean(),
});
export type ServerPreview = z.infer<typeof serverPreviewSchema>;
export type Verification = z.infer<typeof verificationSchema>;

const klDate = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(iso));

export type Failure = { ok: false; error: string; code?: string };
const failure = (error: { message: string; code?: string } | string): Failure =>
  typeof error === "string" ? { ok: false, error } : { ok: false, error: error.message, code: error.code };

/** A parse reduced to what a person (or an agent) needs to review. */
export function summarizeParse(parse: TikTokTrendParse) {
  return {
    source: { name: parse.sourceName, sha256: parse.sha256, sheet: parse.sheet, header_row: parse.headerRow, columns: parse.columns, parser_version: parse.parserVersion },
    mapping: { platform: "TikTok", entry_mode: "Platform daily total", category: "Platform advertising", vendor: TIKTOK_VENDOR },
    currency: parse.currency, currency_basis: parse.currencyBasis, stated_currency: parse.statedCurrency,
    tax: "Not reported in the source: imported as unreported, never as zero",
    report_dates: { from: parse.dateFrom, to: parse.dateTo },
    source_rows: parse.sourceRowCount, campaigns: parse.campaignCount,
    dates_with_spend: parse.totals.entryCount, total_myr: formatCents(parse.totals.cents),
    report_total_row_myr: parse.reportTotal === null ? null : parse.reportTotal.toFixed(2),
    excluded_zero_spend_dates: parse.excludedZeroDates, blank_spend_rows: parse.blankSpendRows.length,
    entries: parse.entries.map((e) => ({ incurred_on: e.incurred_on, before_tax: formatCents(e.cents), campaigns: e.campaigns.length, source_rows: e.source_rows })),
    errors: parse.errors, warnings: parse.warnings,
  };
}

export interface PreviewResult {
  ok: true;
  parse: TikTokTrendParse;
  expectationIssues: string[];
  server: ServerPreview | null;
  importable: boolean;
  /** Every reason the batch cannot be imported as it stands. */
  blockers: string[];
}

export async function previewSpendImport(db: RpcClient, file: ReportFile, expected: Expectation = {}): Promise<PreviewResult | Failure> {
  const parse = await parseTikTokTrendReport(file.bytes, file.fileName, { declaredCurrency: file.declaredCurrency });
  const expectationIssues = reconcile(parse, expected);
  let server: ServerPreview | null = null;
  if (!parse.errors.length) {
    const { data, error } = await db.rpc("preview_marketing_spend_batch", { p_input: toBatchPayload(parse, file.vendor) });
    if (error) return failure(error);
    server = serverPreviewSchema.parse(data);
  }
  const blockers = [...parse.errors, ...expectationIssues, ...(server?.issues ?? [])];
  if (server?.duplicate_batch) blockers.push(`This file was already imported on ${klDate(server.duplicate_batch.imported_at)} as batch ${server.duplicate_batch.id}.`);
  if (server?.conflicts.length) {
    blockers.push(`TikTok costs are already recorded on ${[...new Set(server.conflicts.map((c) => c.incurred_on))].join(", ")}; a day takes one daily total or campaign detail, never both.`);
  }
  if (server && !server.can_import) blockers.push("Your role can preview but not import marketing costs (marketing.spend.write).");
  return { ok: true, parse, expectationIssues, server, importable: !!server?.importable && blockers.length === 0, blockers };
}

export interface ImportResult {
  ok: true;
  batchId: string;
  verification: Verification | null;
  verificationError?: string;
}

/**
 * Import only what was previewed: the caller must restate the expected date
 * count and total, and the file is parsed and checked again here.
 */
export async function importSpendBatch(
  db: RpcClient, file: ReportFile, expected: { entryCount: number; total: number | string }, requestId: string,
): Promise<ImportResult | (Failure & { blockers?: string[] })> {
  if (!Number.isInteger(expected.entryCount) || typeof moneyCents(expected.total) !== "number") {
    return failure("State the expected number of dates and the expected MYR total from the preview before importing.");
  }
  const preview = await previewSpendImport(db, file, expected);
  if (!preview.ok) return preview;
  // A file blocked only by its own earlier batch may be a retry after a lost
  // response: the database returns that batch for the same request id and
  // refuses (23505) any other, so let it decide.
  const earlier = preview.server?.duplicate_batch;
  const onlyItsOwnBatch = !!earlier && !preview.parse.errors.length && !preview.expectationIssues.length && !preview.server?.issues.length
    && !!preview.server?.can_import && preview.server.conflicts.every((c) => c.import_batch_id === earlier.id);
  if (!preview.importable && !onlyItsOwnBatch) return { ...failure(preview.blockers[0] ?? "The batch cannot be imported."), blockers: preview.blockers };
  const { data, error } = await db.rpc("import_marketing_spend_batch", { p_input: toBatchPayload(preview.parse, file.vendor), p_request_id: requestId });
  if (error) return failure(error);
  const batchId = z.string().parse(data);
  const verification = await verifySpendBatch(db, batchId);
  return verification.ok
    ? { ok: true, batchId, verification: verification.verification }
    : { ok: true, batchId, verification: null, verificationError: verification.error };
}

export async function verifySpendBatch(db: RpcClient, batchId: string): Promise<{ ok: true; verification: Verification } | Failure> {
  const { data, error } = await db.rpc("verify_marketing_spend_batch", { p_batch_id: batchId });
  if (error) return failure(error);
  return { ok: true, verification: verificationSchema.parse(data) };
}

export interface FileComparison {
  sameFile: boolean;
  missingInBatch: string[];
  missingInFile: string[];
  amountDiffers: { incurred_on: string; file: string; imported: string; ledger: string | null }[];
  matches: boolean;
}

/** Re-read a report and compare it, date by date, with an imported batch and the current ledger. */
export function compareFileToBatch(parse: TikTokTrendParse, verification: Verification): FileComparison {
  const lines = new Map(verification.lines.map((l) => [l.incurred_on, l]));
  const file = new Map(parse.entries.map((e) => [e.incurred_on, e]));
  const amountDiffers: FileComparison["amountDiffers"] = [];
  for (const [day, e] of file) {
    const l = lines.get(day);
    if (!l) continue;
    const imported = Math.round(l.imported_before_tax * 100);
    const ledger = l.ledger_status === "recorded" ? Math.round(l.ledger_before_tax * 100) : null;
    if (imported !== e.cents || ledger !== e.cents) {
      amountDiffers.push({ incurred_on: day, file: formatCents(e.cents), imported: formatCents(imported), ledger: ledger === null ? null : formatCents(ledger) });
    }
  }
  const missingInBatch = [...file.keys()].filter((d) => !lines.has(d));
  const missingInFile = [...lines.keys()].filter((d) => !file.has(d));
  const sameFile = parse.sha256 === verification.batch.source_sha256;
  return { sameFile, missingInBatch, missingInFile, amountDiffers, matches: !missingInBatch.length && !missingInFile.length && !amountDiffers.length };
}

/**
 * Verify a report file against the ledger: find its active batch (by SHA-256)
 * through the preview, verify the batch, then compare every date.
 */
export async function verifySpendFile(db: RpcClient, file: ReportFile) {
  const preview = await previewSpendImport(db, file);
  if (!preview.ok) return preview;
  const batchId = preview.server?.duplicate_batch?.id;
  if (!batchId) {
    return { ok: true as const, imported: false as const, parse: preview.parse, blockers: preview.blockers };
  }
  const verified = await verifySpendBatch(db, batchId);
  if (!verified.ok) return verified;
  const comparison = compareFileToBatch(preview.parse, verified.verification);
  return {
    ok: true as const, imported: true as const, parse: preview.parse, verification: verified.verification, comparison,
    reconciled: verified.verification.reconciled && comparison.matches,
  };
}

export async function voidSpendBatch(db: RpcClient, batchId: string, reason: string, requestId: string): Promise<{ ok: true; batchId: string } | Failure> {
  const { data, error } = await db.rpc("void_marketing_spend_batch", { p_batch_id: batchId, p_reason: reason, p_request_id: requestId });
  if (error) return failure(error);
  return { ok: true, batchId: z.string().parse(data) };
}
