import { z } from "zod";
import { uuid } from "@/lib/zod";

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "ewallet", "cheque", "credit_terms", "other"] as const;
export const VISIT_PURPOSES = ["browse", "consultation", "sample", "purchase", "collection", "follow_up", "other"] as const;
export const CUSTOMER_TYPES = ["homeowner", "contractor", "designer", "developer", "retailer", "architect", "other"] as const;
export const PRODUCT_INTERESTS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.coerce.number().positive(),
  reference: z.string().trim().max(100).optional().or(z.literal("")),
});

export const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().default(1),
  unit: z.string().trim().max(20).optional().or(z.literal("")),
  unit_price: z.coerce.number().nonnegative().optional(),
  product_variant_id: uuid().optional().or(z.literal("")),
});

export const purchaseSchema = z.object({
  amount: z.coerce.number().nonnegative(),
  external_ref: z.string().trim().max(100).optional().or(z.literal("")),
  payments: z.array(paymentSchema).default([]),
  items: z.array(itemSchema).default([]),
  purchase_source: z.string().trim().max(40).default("walk_in"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const walkInSchema = z.object({
  contact_id: uuid(),
  account_id: uuid().optional().or(z.literal("")),
  occurred_at: z.string().min(1),
  location_id: uuid().optional().or(z.literal("")),
  staff_user_id: uuid().optional().or(z.literal("")),
  customer_type: z.enum(CUSTOMER_TYPES).optional().or(z.literal("")),
  origin_area: z.string().trim().max(120).optional().or(z.literal("")),
  inquiry_source: z.string().trim().max(40).optional().or(z.literal("")),
  purpose: z.enum(VISIT_PURPOSES),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  product_interest: z.array(z.enum(PRODUCT_INTERESTS)).default([]),
  opportunity_mode: z.enum(["none", "create", "link"]).default("none"),
  opportunity_id: uuid().optional().or(z.literal("")),
  project_name: z.string().trim().max(200).optional().or(z.literal("")),
  opportunity_name: z.string().trim().max(200).optional().or(z.literal("")),
  purchase: purchaseSchema.nullable().default(null),
});
export type WalkInInput = z.input<typeof walkInSchema>;
export type WalkInParsed = z.output<typeof walkInSchema>;

export const correctPurchaseSchema = z.object({
  purchase_id: uuid(),
  amount: z.coerce.number().nonnegative(),
  reason: z.string().trim().min(5).max(1000),
});

/** A normalized import row after column mapping (client-side). */
export const importRowSchema = z.object({
  row_no: z.number().int(),
  date: z.string().min(1),
  salesperson: z.string().optional().or(z.literal("")),
  customer_name: z.string().min(1),
  phone: z.string().min(1),
  origin_area: z.string().optional().or(z.literal("")),
  new_existing: z.string().optional().or(z.literal("")),
  customer_type: z.string().optional().or(z.literal("")),
  orc_number: z.string().optional().or(z.literal("")),
  amount: z.number().nonnegative().nullable(),
  inquiry_source: z.string().optional().or(z.literal("")),
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: z.number().nonnegative() })).default([]),
});
export type ImportRow = z.infer<typeof importRowSchema>;
