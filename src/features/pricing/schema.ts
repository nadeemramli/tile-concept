import { z } from "zod";
import { uuid } from "@/lib/zod";

const optUuid = uuid().optional().or(z.literal("")).transform((v) => v || null);
const optStr = z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : null));
const num = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => !Number.isNaN(v), "Must be a number");

export const priceListSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  price_type: z.enum(["retail", "member", "project", "contract", "cost", "other"]),
  currency: z.string().trim().length(3).toUpperCase().default("MYR"),
  market: optStr,
  tax_inclusive: z.boolean().default(false),
  supplier_id: optUuid,
  brand_id: optUuid,
  category_id: optUuid,
  status: z.enum(["draft", "active", "archived"]).default("active"),
  source_ref: optStr,
  notes: optStr,
});
export type PriceListInput = z.input<typeof priceListSchema>;

export const priceSchema = z.object({
  price_list_id: z.string().uuid("Choose a price list"),
  variant_id: z.string().uuid("Choose a variant"),
  amount: num.refine((v) => v >= 0, "Amount must be ≥ 0"),
  currency: z.string().trim().length(3).toUpperCase().default("MYR"),
  unit_id: optUuid,
  min_quantity: num.default(1),
  valid_from: z.string().min(1, "Valid from is required"),
  valid_to: optStr,
  source_ref: optStr,
  notes: optStr,
});
export type PriceInput = z.input<typeof priceSchema>;
