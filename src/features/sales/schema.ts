import { z } from "zod";
import { uuid } from "@/lib/zod";

export const saleActions = ["save", "confirm", "collection", "refund", "credit", "void", "review_payment", "collection_only", "link", "correct_legacy"] as const;
const money = z.number().finite().min(0).max(999999999999.99).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.0001, "Use at most two decimal places.");
export const saleCommandSchema = z.object({
  action: z.enum(saleActions), request_id: uuid(),
  input: z.object({
    purchase_id: uuid().optional(), lead_id: uuid().optional(), visit_id: uuid().optional(), collection_parent_id: uuid().optional(),
    version: z.number().int().positive().optional(),
    occurred_at: z.iso.datetime({ offset: true }).optional(),
    external_ref: z.string().trim().max(100).optional(),
    document_type: z.enum(["invoice", "receipt", "sales_order"]).optional(),
    gross_before_discount: money.optional(), discount_amount: money.optional(), tax_amount: money.optional(), amount: money.optional(),
    reason: z.string().trim().max(2000).optional(), notes: z.string().trim().max(4000).optional(),
    evidence_id: uuid().optional(), payment_id: uuid().optional(),
    method: z.enum(["cash", "card", "bank_transfer", "ewallet", "cheque", "other"]).optional(), reference: z.string().trim().max(100).optional(),
  }),
});
export type SaleCommand = z.infer<typeof saleCommandSchema>;

export const receiptSchema = z.object({ purchase_id: uuid(), receipt_id: uuid(), name: z.string().min(1).max(200), type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(5 * 1024 * 1024) });
