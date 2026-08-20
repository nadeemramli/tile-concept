"use server";

import { z } from "zod";
import { requirePermission } from "@/server/session";
import { fail, ok, type ActionResult } from "@/server/action-result";
import { reportBySlug } from "@/features/reports/registry";
import { runReport } from "@/server/queries/reports";

const exportSchema = z.object({
  slug: z.string().min(1),
  from: z.string().optional().or(z.literal("")),
  to: z.string().optional().or(z.literal("")),
});

export interface ExportPreview {
  rowCount: number;
  columns: string[];
  piiClass: string;
}

/**
 * Re-runs the report server-side and returns it as CSV. The report functions
 * are aggregate-only by construction (PRD §13.3), so no masking step is
 * needed — but the caller must still confirm the row count and columns first.
 */
export async function exportReportAction(input: z.input<typeof exportSchema>): Promise<ActionResult<{ filename: string; csv: string; rowCount: number; columns: string[] }>> {
  try {
    const session = await requirePermission("report.read");
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) return fail("Check the export parameters");
    const def = reportBySlug(parsed.data.slug);
    if (!def) return fail("Unknown report");

    const { rows, error } = await runReport(def, parsed.data.from || undefined, parsed.data.to || undefined);
    if (error) return fail(error);

    const columns = def.columns.map((c) => c.key);
    const header = def.columns.map((c) => c.label);
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(columns.map((k) => csvCell(serialize(row[k]))).join(","));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const range = parsed.data.from || parsed.data.to ? `_${parsed.data.from || "start"}_${parsed.data.to || "today"}` : "";

    // Recorded for operators reading server logs. There is no export-audit RPC
    // yet, so the UI does not claim this reaches the audit log.
    console.info(
      JSON.stringify({
        event: "report.exported",
        report: def.slug,
        rows: rows.length,
        actor: session.userId,
        workspace: session.workspaceId,
        at: new Date().toISOString(),
      }),
    );

    return ok(
      { filename: `tile-concept_${def.slug}${range}_${stamp}.csv`, csv: lines.join("\r\n"), rowCount: rows.length, columns: header },
      `Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`,
    );
  } catch (e) {
    return fail(e);
  }
}

function serialize(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
