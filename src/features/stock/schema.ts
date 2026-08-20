import { z } from "zod";
import { optionalUuid, uuid } from "@/lib/zod";

export const AVAILABILITY_STATES = ["available", "low", "out", "made_to_order", "ask_supplier", "unknown"] as const;
export const SOURCE_CHANNELS = ["call", "whatsapp", "email", "portal", "visit"] as const;

export type AvailabilityStateInput = (typeof AVAILABILITY_STATES)[number];

/** Only these states carry a number; the rest must not be given one. */
export const NUMERIC_STATES: AvailabilityStateInput[] = ["available", "low"];

export const supplierUpdateSchema = z
  .object({
    supplier_id: uuid(),
    availability: z.enum(AVAILABILITY_STATES),
    variant_id: optionalUuid(),
    product_id: optionalUuid(),
    quantity: z.union([z.number(), z.string()]).optional().transform((v) => (v === undefined || v === "" ? null : Number(v))),
    unit_id: optionalUuid(),
    expected_replenishment: z.string().optional().or(z.literal("")),
    source_channel: z.enum(SOURCE_CHANNELS).default("call"),
    evidence_storage_path: z.string().max(500).optional().or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((d) => !!d.variant_id || !!d.product_id, { message: "Choose a product", path: ["variant_id"] })
  .refine((d) => d.quantity === null || !Number.isNaN(d.quantity), { message: "Quantity must be a number", path: ["quantity"] })
  .refine((d) => d.quantity === null || d.quantity >= 0, { message: "Quantity cannot be negative", path: ["quantity"] })
  .refine((d) => d.quantity === null || NUMERIC_STATES.includes(d.availability), {
    message: "A quantity only applies to available or low",
    path: ["quantity"],
  });

export type SupplierUpdateInput = z.input<typeof supplierUpdateSchema>;

export const mapItemSchema = z
  .object({
    mapping_id: uuid(),
    variant_id: optionalUuid(),
    unit_id: optionalUuid(),
    ignore: z.boolean().default(false),
  })
  .refine((d) => d.ignore || !!d.variant_id, { message: "Choose a product variant", path: ["variant_id"] });

export type MapItemInput = z.input<typeof mapItemSchema>;

export const openCaseSchema = z.object({
  variant_id: uuid(),
  source_id: uuid(),
  expected: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => !Number.isNaN(v), "Expected must be a number"),
  observed: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => !Number.isNaN(v), "Observed must be a number"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type OpenCaseInput = z.input<typeof openCaseSchema>;

export const resolveCaseSchema = z.object({
  case_id: uuid(),
  status: z.enum(["investigating", "resolved", "accepted"]),
  notes: z.string().trim().min(3, "Record what was found").max(2000),
});

export type ResolveCaseInput = z.input<typeof resolveCaseSchema>;

/** One line of the paste/CSV bulk entry, before it is matched to a variant. */
export const bulkLineSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
  quantity: z.string().trim().optional().or(z.literal("")),
  unit: z.string().trim().optional().or(z.literal("")),
});

export type BulkLine = z.infer<typeof bulkLineSchema>;
