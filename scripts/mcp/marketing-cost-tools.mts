/**
 * MCP tools for the marketing-cost batch importer.
 *
 * Every tool goes through the shared service, which calls the same `api.*`
 * functions as the app, as the member whose session `db` carries. The
 * database decides permission (marketing.spend.read to preview and verify,
 * marketing.spend.write to import), refuses duplicate files and overlapping
 * TikTok days, and audits every entry. Nothing here writes a table directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  importSpendBatch, previewSpendImport, summarizeParse, verifySpendBatch, verifySpendFile, type ReportFile, type RpcClient,
} from "../../src/features/marketing/spend-import/service.ts";
import { MAX_REPORT_BYTES } from "../../src/features/marketing/spend-import/tiktok-trend.ts";

export interface MarketingCostDb extends RpcClient {
  from(table: "spend_import_batches"): {
    select(columns: string): { order(column: string, options: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
}

const ALLOWED = /\.(csv|tsv|txt|xlsx|xls)$/i;
const uuidLike = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Expected a uuid");

const fileInput = {
  file_path: z.string().optional().describe("Path to the TikTok trend report (.csv/.xlsx) on the machine running this server."),
  file_name: z.string().optional().describe("File name, when sending content_base64 instead of file_path."),
  content_base64: z.string().optional().describe("The report's bytes, base64-encoded, instead of file_path."),
  declared_currency: z.literal("MYR").optional().describe("Only when the report does not state a currency and a person has confirmed its amounts are MYR. Recorded as declared, not stated. Never set this by assumption."),
};
type FileArgs = { file_path?: string; file_name?: string; content_base64?: string; declared_currency?: "MYR" };

export async function loadReport(args: FileArgs): Promise<ReportFile> {
  let bytes: Uint8Array; let fileName: string;
  if (args.file_path) {
    const full = path.resolve(args.file_path);
    fileName = path.basename(full);
    if (!ALLOWED.test(fileName)) throw new Error("Only .csv, .tsv, .txt, .xlsx or .xls reports can be read.");
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error(`${fileName} is not a file.`);
    if (stat.size > MAX_REPORT_BYTES) throw new Error("The report is larger than 5 MB; export a shorter date range.");
    bytes = new Uint8Array(await fs.readFile(full));
  } else if (args.content_base64 && args.file_name) {
    fileName = path.basename(args.file_name);
    if (!ALLOWED.test(fileName)) throw new Error("file_name must end in .csv, .tsv, .txt, .xlsx or .xls.");
    bytes = new Uint8Array(Buffer.from(args.content_base64, "base64"));
  } else {
    throw new Error("Send file_path, or file_name with content_base64.");
  }
  return { fileName, bytes, declaredCurrency: args.declared_currency };
}

const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError });
const failed = (error: unknown) => text({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);

export function createMarketingCostServer(db: MarketingCostDb, member: string) {
  const server = new McpServer({ name: "tile-concept-marketing-cost", version: "1.0.0" }, {
    instructions: [
      `Acting as ${member}. Imports TikTok Ads trend reports into the Tile Concept marketing-cost ledger.`,
      "Always preview first and show the person the dates with spend, the MYR total, excluded zero-spend dates and any blockers.",
      "Import only after the person confirms; pass the previewed date count and total (or the figures they expect) as expected_entry_count and expected_total.",
      "Tax is never in a trend report: it is imported as not reported, never as zero. Never declare a currency the report does not state unless the person confirms it is MYR.",
      "After importing, run the verify tool and report whether the batch reconciles.",
    ].join(" "),
  });

  server.registerTool("marketing_cost_preview_tiktok_report", {
    title: "Preview a TikTok trend report import",
    description: "Read a TikTok Ads trend report, sum campaign Spend per date (zero-spend dates excluded), and check it against the ledger: currency, reconciliation with expected figures, duplicate file, and existing TikTok daily totals or campaign entries on the same dates. Writes nothing.",
    inputSchema: {
      ...fileInput,
      expected_entry_count: z.number().int().positive().optional().describe("Dates with spend the person expects, e.g. 46."),
      expected_total: z.string().optional().describe("MYR total the person expects, e.g. \"3,269.40\"."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const preview = await previewSpendImport(db, await loadReport(args), { entryCount: args.expected_entry_count, total: args.expected_total });
      if (!preview.ok) return text(preview, true);
      return text({
        importable: preview.importable, blockers: preview.blockers, summary: summarizeParse(preview.parse),
        duplicate_batch: preview.server?.duplicate_batch ?? null, conflicts: preview.server?.conflicts ?? [],
        can_import: preview.server?.can_import ?? null,
        next_step: preview.importable
          ? `Confirm with the person, then call marketing_cost_import_tiktok_report with expected_entry_count=${preview.parse.totals.entryCount} and expected_total="${preview.parse.totals.beforeTax.toFixed(2)}".`
          : "Resolve the blockers; nothing can be imported as it stands.",
      });
    } catch (error) { return failed(error); }
  });

  server.registerTool("marketing_cost_import_tiktok_report", {
    title: "Import a TikTok trend report",
    description: "Import a previewed TikTok trend report as one batch: one TikTok / Platform daily total / Platform advertising entry per date with spend, MYR amounts preserved, tax recorded as not reported. All or nothing: a duplicate file, an overlapping TikTok day or any mismatch with the expected figures imports nothing. Returns the batch and its verification.",
    inputSchema: {
      ...fileInput,
      expected_entry_count: z.number().int().positive().describe("The date count shown by the preview and confirmed by the person."),
      expected_total: z.string().describe("The MYR total shown by the preview and confirmed by the person, e.g. \"3269.40\"."),
      request_id: uuidLike.optional().describe("Reuse the same id when retrying after a lost response; the batch is then returned, not imported twice."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const requestId = args.request_id ?? randomUUID();
      const result = await importSpendBatch(db, await loadReport(args), { entryCount: args.expected_entry_count, total: args.expected_total }, requestId);
      if (!result.ok) return text(result, true);
      return text({ ok: true, batch_id: result.batchId, request_id: requestId, verification: result.verification, verification_error: result.verificationError ?? null });
    } catch (error) { return failed(error); }
  });

  server.registerTool("marketing_cost_verify_import", {
    title: "Verify an imported marketing-cost batch",
    description: "Compare an imported batch with the ledger now (matching, edited, corrected or voided per date, overlaps, unreported tax). Pass batch_id, or the report file to find its batch by fingerprint and compare it date by date.",
    inputSchema: { batch_id: uuidLike.optional().describe("The batch to verify."), ...fileInput },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      if (args.batch_id) {
        const result = await verifySpendBatch(db, args.batch_id);
        return result.ok ? text(result.verification) : text(result, true);
      }
      const result = await verifySpendFile(db, await loadReport(args));
      if (!result.ok) return text(result, true);
      if (!result.imported) return text({ imported: false, message: "No active batch holds this file.", summary: summarizeParse(result.parse), blockers: result.blockers });
      return text({ imported: true, reconciled: result.reconciled, comparison: result.comparison, verification: result.verification });
    } catch (error) { return failed(error); }
  });

  server.registerTool("marketing_cost_list_imports", {
    title: "List recent marketing-cost imports",
    description: "The most recent import batches visible to this member, newest first.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try {
      const { data, error } = await db.from("spend_import_batches")
        .select("id,source_name,source_sha256,status,entry_count,total_before_tax,report_date_from,report_date_to,currency_basis,tax_status,imported_at,voided_at,void_reason")
        .order("imported_at", { ascending: false }).limit(args.limit ?? 10);
      if (error) return text({ ok: false, error: error.message }, true);
      return text(data ?? []);
    } catch (error) { return failed(error); }
  });

  return server;
}
