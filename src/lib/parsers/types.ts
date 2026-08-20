/**
 * Extraction contract shared by every parser (PRD §7.8, §12.5).
 *
 * A parser proposes; it never publishes. Each record keeps the raw row exactly
 * as it was read, the normalized proposal, a confidence, and — per field — the
 * source text and the region it came from, so a reviewer can compare the
 * proposal against the document rather than trusting it.
 */

export interface FieldRegion {
  /** 1-based page for paged documents. */
  page?: number;
  /** 0-based line index within the page, for text extraction. */
  line?: number;
  /** Spreadsheet coordinates. */
  sheet?: string;
  ref?: string;
  row?: number;
  col?: number;
  /** Pixel box, when a parser can supply one (OCR does; text extraction does not). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface ParsedField {
  key: string;
  value: string;
  /** 0-1. How sure the parser is that this value belongs to this field. */
  confidence: number;
  /** The exact text the value was taken from. */
  source_text?: string;
  region?: FieldRegion;
}

export interface ParsedIssue {
  code: "needs_manual" | "low_confidence" | "ambiguous_formula" | "missing_code" | "missing_amount" | "unparsed_row";
  detail: string;
}

export interface ParsedRecord {
  row_no: number;
  page_no?: number;
  /** The row as read, unmodified. */
  raw: Record<string, unknown>;
  /** Canonical proposal built from the raw row. */
  normalized: Record<string, unknown>;
  confidence: number;
  item_type: "product" | "price";
  issues: ParsedIssue[];
  fields: ParsedField[];
}

export interface ParseResult {
  records: ParsedRecord[];
  /** Free-form counters surfaced on the job. */
  stats: Record<string, unknown>;
  parserVersion: string;
  jobType: "parse_pdf" | "parse_sheet" | "ocr" | "manual";
  /** Set when the whole pass failed; the job is recorded as failed. */
  error?: string;
}

export const NEEDS_MANUAL_DETAIL =
  "No machine-readable text on this page. OCR runs in the background worker (PRD §12.5); until then, enter the values by hand from the original.";
