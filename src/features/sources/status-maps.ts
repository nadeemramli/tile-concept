import type { StatusMap } from "@/lib/domain/status-maps";

/** Local to the Sources module; the shared maps stay untouched. */

export const ASSET_STATUS: StatusMap = {
  uploaded: { label: "Awaiting parse", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  processed: { label: "Processed", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  archived: { label: "Archived", tone: "neutral" },
};

export const ASSET_KIND: StatusMap = {
  pdf: { label: "PDF", tone: "info" },
  image: { label: "Image", tone: "warning" },
  excel: { label: "Excel", tone: "success" },
  csv: { label: "CSV", tone: "success" },
  url: { label: "Web", tone: "ai" },
  manual: { label: "Manual", tone: "neutral" },
};

export const JOB_STATUS: StatusMap = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  dead_letter: { label: "Dead letter", tone: "destructive" },
};

export const REVIEW_ITEM_STATUS: StatusMap = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  corrected: { label: "Corrected & approved", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
};

export const ITEM_TYPE: StatusMap = {
  product: { label: "Product", tone: "neutral" },
  price: { label: "Price", tone: "ai" },
  stock: { label: "Stock", tone: "info" },
  identity: { label: "Identity", tone: "info" },
  walkin_row: { label: "Walk-in", tone: "info" },

  // Corpus import tasks. Unmapped values still render readably via statusMeta,
  // but these are the ones an operator meets in bulk, so they get real labels.
  certificate_scope_review: { label: "Certificate scope", tone: "warning" },
  duplicate_code_resolution: { label: "Duplicate code", tone: "warning" },
  low_confidence_price_source_review: { label: "Price source", tone: "destructive" },
  representative_shape_review: { label: "Document shape", tone: "info" },
  structured_price_scope_missing: { label: "Price scope missing", tone: "destructive" },
  oversized_source_recovery: { label: "Source recovery", tone: "destructive" },
  class_path_conflict: { label: "Document class", tone: "warning" },
  semantic_visual_review: { label: "Visual review", tone: "ai" },
  dimension_unit_unstated: { label: "Size unit", tone: "warning" },
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

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
