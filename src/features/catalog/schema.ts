import { z } from "zod";
import { uuid } from "@/lib/zod";

const optStr = z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : null));
const optNum = z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? null : Number(v))).refine((v) => v === null || !Number.isNaN(v), "Must be a number");

export const productSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  code: optStr,
  brand_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  supplier_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  category_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  color: optStr,
  finish: optStr,
  material: optStr,
  style: optStr,
  description: z.string().trim().max(4000).optional().or(z.literal("")).transform((v) => v || null),
  keywords: optStr,
  source_ref: optStr,
  sku: optStr,
  selling_unit_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  width_mm: optNum,
  length_mm: optNum,
  thickness_mm: optNum,
  depth_mm: optNum,
  sheet_width_mm: optNum,
  sheet_height_mm: optNum,
  attributes: z.record(z.string(), z.string()).optional(),
});
export type ProductInput = z.input<typeof productSchema>;


export const variantSchema = z.object({
  product_id: uuid(),
  sku: optStr,
  name: optStr,
  selling_unit_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  width_mm: optNum,
  length_mm: optNum,
  thickness_mm: optNum,
  depth_mm: optNum,
  sheet_width_mm: optNum,
  sheet_height_mm: optNum,
});
export type VariantInput = z.input<typeof variantSchema>;

export const packagingSchema = z.object({
  product_id: uuid(),
  variant_id: uuid(),
  pack_label: z.string().trim().min(1),
  pack_unit_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  quantity_per_pack: optNum,
  inner_unit_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  coverage_per_pack: optNum,
  coverage_unit_id: uuid().optional().or(z.literal("")).transform((v) => v || null),
  moq: optNum,
  order_increment: optNum,
});
export type PackagingInput = z.input<typeof packagingSchema>;
