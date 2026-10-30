import type { StatusMap } from "@/lib/domain/status-maps";

/** Local to the Sources module; the shared maps stay untouched. */

export const ASSET_STATUS: StatusMap = {
  uploaded: { label: "Awaiting parse", tone: "info", hint: "Stored, not yet read. Parsing starts automatically or from Re-parse." },
  processing: { label: "Processing", tone: "info", hint: "Being read now. Candidate rows appear in review when it finishes." },
  processed: { label: "Processed", tone: "success", hint: "Read successfully. Its candidates are in Imports & OCR Review." },
  failed: { label: "Failed", tone: "destructive", hint: "The parser could not read it. Check the job error, then Re-parse or replace the file." },
  archived: { label: "Archived", tone: "neutral", hint: "Kept for provenance but no longer offered for review." },
};

export const ASSET_KIND: StatusMap = {
  pdf: { label: "PDF", tone: "info", hint: "Brochure, price list or certificate. Text is extracted; scanned pages go through OCR." },
  image: { label: "Image", tone: "warning", hint: "A photo or screenshot. Anything read from it is OCR and carries a confidence score." },
  excel: { label: "Excel", tone: "success", hint: "A spreadsheet. Cells are read directly; formulas are flagged for review." },
  csv: { label: "CSV", tone: "success", hint: "Plain tabular data. Read directly." },
  url: { label: "Web", tone: "ai", hint: "A page fetched from the web, with the fetch date recorded." },
  manual: { label: "Manual", tone: "neutral", hint: "Typed in by a person, with no source document." },
};

export const JOB_STATUS: StatusMap = {
  queued: { label: "Queued", tone: "neutral", hint: "Waiting for a worker. OCR runs in the background worker, not in the page; meanwhile you can enter rows by hand." },
  running: { label: "Running", tone: "info", hint: "In progress." },
  succeeded: { label: "Succeeded", tone: "success", hint: "Finished without error." },
  failed: { label: "Failed", tone: "destructive", hint: "Stopped with an error the file itself caused. Each page has a manual-entry row." },
  dead_letter: { label: "Dead letter", tone: "destructive", hint: "Retries are exhausted. Each page has a manual-entry row; fix the cause and retry." },
};

/** Why an OCR job stopped. Input problems are not retried; the rest are. */
export const OCR_FAILURE: StatusMap = {
  transient: { label: "Temporary error", tone: "warning", hint: "The worker hit an error that may not recur. It retries with backoff; you can also retry it now." },
  retries_exhausted: { label: "Retries used up", tone: "destructive", hint: "Every automatic attempt failed. Each page now has a manual-entry row; you can retry once the cause is fixed." },
  engine_unavailable: { label: "OCR engine missing", tone: "destructive", hint: "The worker has no Tesseract installation. Pages became manual-entry rows; retry after the engine is installed." },
  encrypted: { label: "Encrypted PDF", tone: "destructive", hint: "The PDF is password-protected, so its pages cannot be read. Upload an unlocked copy, or enter the rows by hand." },
  unsupported: { label: "Unsupported file", tone: "destructive", hint: "The file could not be decoded as a scanned PDF or image. Enter the rows by hand." },
  oversize: { label: "Too large", tone: "destructive", hint: "The file is larger than OCR accepts (25 MB). Split it, or enter the rows by hand." },
  too_many_pages: { label: "Too many pages", tone: "destructive", hint: "OCR reads at most 20 pages per job. Choose the pages to read." },
  source_missing: { label: "Original missing", tone: "destructive", hint: "The stored original could not be found. Re-upload it, or enter the rows by hand." },
};

/** Per-page result of an OCR job. */
export const OCR_PAGE_OUTCOME: StatusMap = {
  read: { label: "Read", tone: "success", hint: "Text was recognised and proposals were staged for review." },
  unreadable: { label: "Unreadable", tone: "destructive", hint: "The scan was too poor, or no product code was found. The page has a manual-entry row." },
  no_text: { label: "Text layer", tone: "info", hint: "The page already has selectable text, so the text parser read it and OCR skipped it." },
  no_image: { label: "No image", tone: "warning", hint: "The page has neither text nor a scanned image. It has a manual-entry row." },
  failed: { label: "Failed", tone: "destructive", hint: "The engine failed on this page." },
};

export const REVIEW_ITEM_STATUS: StatusMap = {
  pending: { label: "Pending", tone: "warning", hint: "Waiting for a reviewer. Nothing from it has reached the catalog." },
  approved: { label: "Approved", tone: "success", hint: "A reviewer accepted it as parsed. It was written to the catalog." },
  corrected: { label: "Corrected & approved", tone: "success", hint: "A reviewer changed one or more fields before approving. Both versions are kept." },
  rejected: { label: "Rejected", tone: "neutral", hint: "Refused with a reason. The row stays as evidence and parser feedback." },
};

export const ITEM_TYPE: StatusMap = {
  product: { label: "Product", tone: "neutral", hint: "A product or variant parsed from a source." },
  price: { label: "Price", tone: "ai", hint: "A price parsed from a source. Publishing goes through a price list so the overlap rule applies." },
  stock: { label: "Stock", tone: "info", hint: "A stock figure parsed from a source." },
  identity: { label: "Identity", tone: "info", hint: "A possible customer or supplier match." },
  walkin_row: { label: "Walk-in", tone: "info", hint: "A row from the walk-in spreadsheet import." },

  // Corpus import tasks. Unmapped values still render readably via statusMeta,
  // but these are the ones an operator meets in bulk, so they get real labels.
  certificate_scope_review: { label: "Certificate scope", tone: "warning", hint: "A certificate was found but which products it covers is not established." },
  duplicate_code_resolution: { label: "Duplicate code", tone: "warning", hint: "Two sources use the same product code. Decide which is the product and which is a reference." },
  low_confidence_price_source_review: { label: "Price source", tone: "destructive", hint: "The price was read with low confidence. Confirm it against the source page." },
  representative_shape_review: { label: "Document shape", tone: "info", hint: "Confirm how this kind of document is laid out so the rest of the series parses the same way." },
  structured_price_scope_missing: { label: "Price scope missing", tone: "destructive", hint: "A price with no currency, unit, tax basis, market or validity. Each must be stated; none is defaulted." },
  oversized_source_recovery: { label: "Source recovery", tone: "destructive", hint: "The file was too large to parse in one pass. Recover it page by page." },
  class_path_conflict: { label: "Document class", tone: "warning", hint: "The document could be one of two kinds. Say which." },
  semantic_visual_review: { label: "Visual review", tone: "ai", hint: "An image was matched to a product by what it shows. A person must confirm; pixels never become a physical size." },
  dimension_unit_unstated: { label: "Size unit", tone: "warning", hint: "A size was read without a unit. State mm, cm or inches; it is never guessed." },
};

export const CONFLICT_LABEL: Record<string, string> = {
  duplicate_product: "A product with this code already exists",
  needs_manual: "Needs manual entry",
  low_confidence: "Low confidence",
  ambiguous_formula: "Value came from a formula",
  missing_code: "No product code",
  missing_amount: "No price found",
  unparsed_row: "Row could not be parsed",
};

/** Confidence bands used consistently across the module. */
export function confidenceTone(c: number | null | undefined): "success" | "warning" | "destructive" | "neutral" {
  if (c === null || c === undefined) return "neutral";
  if (c >= 0.95) return "success";
  if (c >= 0.8) return "warning";
  return "destructive";
}

export function confidenceLabel(c: number | null | undefined): string {
  if (c === null || c === undefined) return "No score";
  return `${Math.round(c * 100)}%`;
}

/** What a confidence score means, for the pill and the glossary. */
export const CONFIDENCE_HINT = "How sure the parser is that it read the value correctly. 95% and above is normally right; 80–95% deserves a glance; below 80% must be checked against the source. A score never approves anything on its own.";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
