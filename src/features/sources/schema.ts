import { z } from "zod";
import { optionalUuid, uuid } from "@/lib/zod";

export const SOURCE_KINDS = ["pdf", "image", "excel", "csv", "url", "manual"] as const;

export const registerAssetSchema = z.object({
  name: z.string().trim().min(1, "A file name is required").max(300),
  kind: z.enum(SOURCE_KINDS),
  checksum: z.string().trim().min(8, "A checksum is required so re-imports can be detected").max(128),
  storage_path: z.string().trim().max(500).optional().or(z.literal("")),
  mime_type: z.string().trim().max(200).optional().or(z.literal("")),
  size_bytes: z.number().int().nonnegative().optional(),
  page_count: z.number().int().nonnegative().optional(),
  supplier_id: optionalUuid(),
  brand_id: optionalUuid(),
  url: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type RegisterAssetInput = z.input<typeof registerAssetSchema>;

export const parseAssetSchema = z.object({ asset_id: uuid() });

export const signedUrlSchema = z.object({
  bucket: z.string().trim().min(1).max(64),
  path: z.string().trim().min(1).max(500),
});

export const approveSchema = z.object({
  review_item_id: uuid(),
  corrections: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ApproveInput = z.input<typeof approveSchema>;

export const rejectSchema = z.object({
  review_item_id: uuid(),
  reason: z.string().trim().min(3, "Say why this row is being rejected").max(1000),
});
export type RejectInput = z.input<typeof rejectSchema>;

export const archiveSchema = z.object({ asset_id: uuid() });

/**
 * Fields the reviewer may correct before approving.
 *
 * `required` is the list of item types for which `api.approve_review_item` will
 * refuse without an explicit value. These are not defaulted anywhere: a price
 * whose source never stated a currency, unit basis, tax basis, programme,
 * market, or validity is a publication blocker, not a row to fill in with
 * convention (Canonical Merchandise Schema rule 4; PRD §7.6).
 */
export const TAX_BASIS_OPTIONS = [
  { value: "exclusive", label: "Tax exclusive" },
  { value: "inclusive", label: "Tax inclusive" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

export const PRICE_TYPE_OPTIONS = [
  { value: "retail", label: "Retail" },
  { value: "member", label: "Member" },
  { value: "project", label: "Project" },
  { value: "contract", label: "Contract" },
  { value: "cost", label: "Cost" },
  { value: "other", label: "Other" },
] as const;

/** Answers a corpus task asks for that are not drawn from a lookup table. */
export const SCOPE_TYPE_OPTIONS = [
  { value: "brand", label: "The whole brand" },
  { value: "product", label: "One product" },
  { value: "variant", label: "One variant" },
  { value: "unresolved", label: "Still cannot tell" },
] as const;

export const DIMENSION_UNIT_OPTIONS = [
  { value: "mm", label: "Millimetres" },
  { value: "cm", label: "Centimetres" },
  { value: "unresolved", label: "Cannot tell from the source" },
] as const;

export const DUPLICATE_RESOLUTION_OPTIONS = [
  { value: "same_product", label: "Same product — collapse them" },
  { value: "different_products", label: "Different products — keep both" },
  { value: "unresolved", label: "Needs the documents side by side" },
] as const;

export const OBSERVATION_VERDICT_OPTIONS = [
  { value: "confirmed", label: "Correct" },
  { value: "rejected", label: "Wrong" },
  { value: "unresolved", label: "Cannot tell from this image" },
] as const;

export type CorrectableSource =
  | "units"
  | "priceLists"
  | "brands"
  | "categories"
  | "taxBasis"
  | "priceType"
  | "scopeType"
  | "dimensionUnit"
  | "duplicateResolution"
  | "observationVerdict";

export interface CorrectableField {
  key: string;
  label: string;
  input: "text" | "date" | "select";
  /** Where a select gets its options. */
  options?: CorrectableSource;
  /** Item types this field is shown for; omitted means both. */
  appliesTo?: readonly string[];
  /** Item types for which approval is refused without a value. */
  required?: readonly string[];
  hint?: string;
}

export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  { key: "code", label: "Product code", input: "text" },
  { key: "name", label: "Name", input: "text", hint: "A name or a code is required." },
  { key: "brand_id", label: "Brand", input: "select", options: "brands", required: ["product", "price"] },
  { key: "category_id", label: "Category", input: "select", options: "categories", appliesTo: ["product"], required: ["product"] },
  { key: "color", label: "Colour", input: "text", appliesTo: ["product"] },
  { key: "finish", label: "Finish", input: "text", appliesTo: ["product"] },
  { key: "material", label: "Material", input: "text", appliesTo: ["product"] },
  { key: "amount", label: "Amount", input: "text", appliesTo: ["price"], required: ["price"] },
  { key: "currency", label: "Currency", input: "text", appliesTo: ["price"], required: ["price"], hint: "ISO code. Never assumed from the market." },
  {
    key: "unit_id",
    label: "Price basis",
    input: "select",
    options: "units",
    required: ["product", "price"],
    hint: "What one unit of this amount buys — piece, sheet, carton, square metre.",
  },
  { key: "quantity_unit_id", label: "Quantity basis", input: "select", options: "units", appliesTo: ["price"] },
  { key: "min_quantity", label: "Minimum quantity", input: "text", appliesTo: ["price"], required: ["price"] },
  { key: "price_list_id", label: "Price list", input: "select", options: "priceLists", appliesTo: ["price"], required: ["price"], hint: "Which programme this price belongs to. Never auto-selected." },
  { key: "price_type", label: "Price type", input: "select", options: "priceType", appliesTo: ["price"], required: ["price"] },
  { key: "tax_basis", label: "Tax basis", input: "select", options: "taxBasis", appliesTo: ["price"], required: ["price"], hint: "“Unknown” is an honest extraction result, not an approvable basis." },
  { key: "market", label: "Market", input: "text", appliesTo: ["price"], required: ["price"] },
  { key: "customer_tier", label: "Customer tier", input: "text", appliesTo: ["price"] },
  { key: "valid_from", label: "Valid from", input: "date", appliesTo: ["price"], required: ["price"] },
  { key: "valid_to", label: "Valid to", input: "date", appliesTo: ["price"] },
  { key: "source_page_or_row", label: "Source page or row", input: "text", appliesTo: ["price"] },
  { key: "source_ref", label: "Source reference", input: "text" },
];

/**
 * What each corpus review task actually asks.
 *
 * The upload flow has one question — "is this extracted product or price right?"
 * — and `CORRECTABLE_FIELDS` above is its answer sheet. A corpus task asks
 * something else entirely, and until this registry existed every one of them
 * rendered the product/price form, because the fields were selected by
 * `item_type` and a corpus task's item_type matches none of the `appliesTo`
 * lists. A reviewer being asked for a currency when the question was "is this
 * 306mm or 306cm?" cannot answer it, so 2,000-odd tasks sat unanswerable.
 *
 * A task type absent from this map falls back to the item-type fields, which is
 * the right default for the upload flow and harmless for anything else: worst
 * case a new task type shows a generic form until it is added here.
 */
export const TASK_TYPE_FIELDS: Record<string, readonly CorrectableField[]> = {
  // A folder label is a provenance hint, never a scope. The reviewer states one.
  certificate_scope_review: [
    { key: "scope_type", label: "What does this certificate cover?", input: "select", options: "scopeType", required: ["certificate_scope_review"], hint: "The folder it was found in does not establish this." },
    { key: "brand_id", label: "Brand", input: "select", options: "brands", hint: "Required when the scope is a brand." },
    { key: "certificate_type", label: "Certificate type", input: "text", hint: "For example: product conformity, factory audit." },
    { key: "issuer", label: "Issuer", input: "text" },
    { key: "issued_on", label: "Issued", input: "date" },
    { key: "expires_on", label: "Expires", input: "date" },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // The same supplier code under one brand in two documents.
  duplicate_code_resolution: [
    { key: "resolution", label: "Are these the same product?", input: "select", options: "duplicateResolution", required: ["duplicate_code_resolution"] },
    { key: "keep_code", label: "Code to keep", input: "text", hint: "Leave blank to keep the code as extracted." },
    { key: "distinguishing_attribute", label: "What tells them apart", input: "text", hint: "Only when they are different products — size, finish, series." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // A size with no unit, or several sizes for one product.
  dimension_unit_unstated: [
    { key: "dimension_unit", label: "What unit is this size in?", input: "select", options: "dimensionUnit", required: ["dimension_unit_unstated"], hint: "The source states a bare number. Nothing is assumed from its magnitude." },
    { key: "chosen_size", label: "Which size is the product", input: "text", hint: "Only when the source offered more than one." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // A machine label on an image, awaiting a person.
  semantic_visual_review: [
    { key: "verdict", label: "Is the label correct?", input: "select", options: "observationVerdict", required: ["semantic_visual_review"] },
    { key: "corrected_value", label: "Correct value", input: "text", hint: "Only when the label is wrong." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // Is this document what the classifier thinks it is?
  class_path_conflict: [
    { key: "asset_class", label: "What kind of document is this?", input: "text", required: ["class_path_conflict"], hint: "For example: catalog, price list, certificate." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],
  representative_shape_review: [
    { key: "asset_class", label: "What kind of document is this?", input: "text", required: ["representative_shape_review"] },
    { key: "applies_to_cluster", label: "Applies to the whole cluster", input: "text", hint: "Yes or no, and why." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // A price table whose scope the document never states.
  structured_price_scope_missing: [
    { key: "price_list_id", label: "Price list", input: "select", options: "priceLists", required: ["structured_price_scope_missing"], hint: "Which programme these prices belong to. Never auto-selected." },
    { key: "market", label: "Market", input: "text", required: ["structured_price_scope_missing"] },
    { key: "tax_basis", label: "Tax basis", input: "select", options: "taxBasis", required: ["structured_price_scope_missing"] },
    { key: "unit_id", label: "Price basis", input: "select", options: "units", required: ["structured_price_scope_missing"] },
    { key: "valid_from", label: "Valid from", input: "date", required: ["structured_price_scope_missing"] },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],

  // A file too large to stage. The decision is how to recover it.
  oversized_source_recovery: [
    { key: "recovery_plan", label: "How will this be recovered?", input: "text", required: ["oversized_source_recovery"], hint: "A local Drive sync, a smaller source PDF, or a decision to leave it out." },
    { key: "source_ref", label: "Source reference", input: "text" },
  ],
};

/**
 * Fields for a review item, in display order.
 *
 * `taskType` wins when it names a corpus task, because that is the more specific
 * description of what is being asked. Everything else falls back to `itemType`.
 */
export function correctableFor(itemType: string, taskType?: string | null): CorrectableField[] {
  const byTask = taskType ? TASK_TYPE_FIELDS[taskType] : undefined;
  if (byTask) return [...byTask];
  return CORRECTABLE_FIELDS.filter((f) => !f.appliesTo || f.appliesTo.includes(itemType));
}

/** Required keys still empty — the reviewer sees these before clicking approve. */
export function unresolvedRequired(
  itemType: string,
  values: Record<string, string>,
  taskType?: string | null,
): CorrectableField[] {
  const key = taskType && TASK_TYPE_FIELDS[taskType] ? taskType : itemType;
  return correctableFor(itemType, taskType).filter(
    (f) => f.required?.includes(key) && !(values[f.key] ?? "").trim(),
  );
}

/** Whether a field is required for this item, so the label can say so. */
export function isRequiredFor(field: CorrectableField, itemType: string, taskType?: string | null): boolean {
  const key = taskType && TASK_TYPE_FIELDS[taskType] ? taskType : itemType;
  return field.required?.includes(key) ?? false;
}
