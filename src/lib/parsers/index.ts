/**
 * Parser dispatch. Native structure first (PDF text layer, spreadsheet cells);
 * raster input is never guessed at — it is handed to a human.
 */
import { parsePdf } from "./pdf";
import { parseSpreadsheet } from "./spreadsheet";
import { NEEDS_MANUAL_DETAIL, type ParseResult } from "./types";

export * from "./types";
export { parsePdf } from "./pdf";
export { parseSpreadsheet } from "./spreadsheet";

export type SourceKind = "pdf" | "image" | "excel" | "csv" | "url" | "manual";

/** Classify by extension first, then MIME — suppliers mislabel both. */
export function classifySource(name: string, mimeType?: string | null): SourceKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls", "xlsm"].includes(ext)) return "excel";
  if (ext === "csv") return "csv";
  if (["png", "jpg", "jpeg", "webp", "gif", "tif", "tiff"].includes(ext)) return "image";
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("spreadsheet") || m.includes("ms-excel")) return "excel";
  if (m.includes("csv")) return "csv";
  if (m.startsWith("image/")) return "image";
  return "manual";
}

export async function parseSource(kind: SourceKind, data: ArrayBuffer, opts?: { text?: string }): Promise<ParseResult> {
  switch (kind) {
    case "pdf":
      return parsePdf(data);
    case "excel":
      return parseSpreadsheet({ data, isCsv: false });
    case "csv":
      return parseSpreadsheet({ data, isCsv: true, text: opts?.text });
    case "image":
      // An image has no text layer at all. One record, one honest issue.
      return {
        records: [
          {
            row_no: 1,
            page_no: 1,
            raw: { note: "image source" },
            normalized: {},
            confidence: 0,
            item_type: "product",
            issues: [{ code: "needs_manual", detail: NEEDS_MANUAL_DETAIL }],
            fields: [],
          },
        ],
        stats: { pages: 1, raster_pages: 1, rows: 0, ocr_pages: 0 },
        parserVersion: "image@1",
        jobType: "ocr",
      };
    default:
      return { records: [], stats: {}, parserVersion: "none@1", jobType: "manual", error: "This source type has no automatic parser; add the records by hand." };
  }
}
