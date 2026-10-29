import { z } from "zod";
import { uuid, optionalUuid } from "@/lib/zod";
const money = z.union([z.string().trim().min(1), z.number()]).pipe(z.coerce.number<string | number>().finite().nonnegative().max(999999999999.99))
  .refine(x => Math.abs(x * 100 - Math.round(x * 100)) < 0.0001, "Use at most two decimal places");
export const spendSchema = z.object({
  request_id: uuid(), action: z.enum(["save", "credit", "void", "coverage"]),
  id: optionalUuid(), version: z.coerce.number().int().positive().optional(),
  incurred_on: z.iso.date().optional(), platform: z.enum(["tiktok", "meta", "google_ads", "shared"]).optional(),
  category: z.enum(["platform_ads", "influencer", "content", "creative", "agency", "event", "other"]).optional(),
  entry_mode: z.enum(["daily_total", "campaign", "event", "credit"]).optional(),
  entry_key: z.string().trim().max(160).optional(), vendor: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(), reference: z.string().trim().max(160).optional(),
  before_tax: money.optional(), tax: money.optional(), tax_status: z.enum(["stated", "unreported"]).optional(), currency: z.literal("MYR").optional(),
  original_currency: z.string().trim().max(3).optional(), original_amount: money.optional(), conversion_note: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(2000).optional(), date_from: z.iso.date().optional(), date_to: z.iso.date().optional(), complete: z.boolean().optional(),
});
export const spendTotalsSchema = z.array(z.object({ platform: z.string(), amount: z.number(), before_tax: z.number(), tax_unreported_entries: z.number(), days: z.number(), covered_days: z.number() }));
export const spendBatchListSchema = z.array(z.object({
  id: z.string(), source_name: z.string(), status: z.enum(["imported", "voided"]), entry_count: z.number(), total_before_tax: z.number(),
  report_date_from: z.string(), report_date_to: z.string(), currency_basis: z.string(), imported_at: z.string(), void_reason: z.string().nullable(),
}));
export type SpendBatchList = z.infer<typeof spendBatchListSchema>;
export type SpendTotals = z.infer<typeof spendTotalsSchema>;
