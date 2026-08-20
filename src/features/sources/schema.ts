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

export type CorrectableSource = "units" | "priceLists" | "brands" | "categories" | "taxBasis" | "priceType";

export interface CorrectableField {
  key: string;
  label: string;
  input: "text" | "date" | "select";
  /** Where a select gets its options. */
  options?: CorrectableSource;
  /** Item types this field is shown for; omitted means both. */
  appliesTo?: readonly ("product" | "price")[];
  /** Item types for which approval is refused without a value. */
  required?: readonly ("product" | "price")[];
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

/** Fields for the given item type, in display order. */
export function correctableFor(itemType: string): CorrectableField[] {
  return CORRECTABLE_FIELDS.filter((f) => !f.appliesTo || f.appliesTo.includes(itemType as "product" | "price"));
}

/** Required keys still empty — the reviewer sees these before clicking approve. */
export function unresolvedRequired(itemType: string, values: Record<string, string>): CorrectableField[] {
  return correctableFor(itemType).filter(
    (f) => f.required?.includes(itemType as "product" | "price") && !(values[f.key] ?? "").trim(),
  );
}
