/**
 * PDF extraction (PRD §7.8: native text first, OCR only where it is needed).
 *
 * Pages with an embedded text layer are parsed line by line. A page with no
 * usable text is a scan: it is recorded as needing manual entry rather than
 * being silently skipped or filled with invented values. OCR belongs to the
 * background worker (PRD §12.5) and is not run here.
 */
import { extractText } from "unpdf";
import { averageConfidence, proposeFromLine } from "./mapper";
import { NEEDS_MANUAL_DETAIL, type ParseResult, type ParsedRecord } from "./types";

const PARSER_VERSION = "pdf-text@1";
/** Below this many characters a page is treated as a scan, not a text page. */
const RASTER_TEXT_THRESHOLD = 40;

export async function parsePdf(data: ArrayBuffer): Promise<ParseResult> {
  let pages: string[];
  let totalPages = 0;
  try {
    const result = await extractText(new Uint8Array(data), { mergePages: false });
    totalPages = result.totalPages;
    pages = Array.isArray(result.text) ? result.text : [result.text];
  } catch (e) {
    return { records: [], stats: {}, parserVersion: PARSER_VERSION, jobType: "parse_pdf", error: e instanceof Error ? e.message : "The PDF could not be read" };
  }

  const records: ParsedRecord[] = [];
  let rowNo = 0;
  let rasterPages = 0;
  let textPages = 0;

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const text = (pageText ?? "").trim();

    if (text.replace(/\s+/g, "").length < RASTER_TEXT_THRESHOLD) {
      rasterPages += 1;
      rowNo += 1;
      records.push({
        row_no: rowNo,
        page_no: page,
        raw: { page, text_length: text.length },
        normalized: {},
        confidence: 0,
        item_type: "product",
        issues: [{ code: "needs_manual", detail: NEEDS_MANUAL_DETAIL }],
        fields: [],
      });
      return;
    }

    textPages += 1;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, lineIndex) => {
      const region = { page, line: lineIndex };
      const proposal = proposeFromLine(line, region);
      if (!proposal) return;

      const issues: ParsedRecord["issues"] = [];
      const confidence = averageConfidence(proposal.fields);
      if (confidence < 0.8) issues.push({ code: "low_confidence", detail: "This row was read from a text layer without column structure — check every field against the page." });
      if (!proposal.normalized.code) issues.push({ code: "missing_code", detail: "No product code on this line — set one before approving." });

      rowNo += 1;
      records.push({
        row_no: rowNo,
        page_no: page,
        raw: { line, page },
        normalized: proposal.normalized,
        confidence,
        item_type: proposal.normalized.amount ? "price" : "product",
        issues,
        fields: proposal.fields,
      });
    });
  });

  const parsedRows = records.filter((r) => r.issues.every((i) => i.code !== "needs_manual")).length;
  return {
    records,
    stats: { pages: totalPages, text_pages: textPages, raster_pages: rasterPages, rows: parsedRows, ocr_pages: 0 },
    parserVersion: PARSER_VERSION,
    jobType: "parse_pdf",
    error: parsedRows === 0 && rasterPages === 0 ? "No price-list rows were recognised in the text layer" : undefined,
  };
}
