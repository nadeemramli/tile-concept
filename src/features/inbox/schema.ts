import { z } from "zod";
import { uuid } from "@/lib/zod";

export const SOURCE_CHANNELS = ["tiktok", "meta", "website", "whatsapp", "dm", "call", "email", "referral", "walk_in", "other"] as const;
export const PRODUCT_INTERESTS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;
export const LEAD_VIEWS = ["new", "unassigned", "mine", "no-response", "follow-up", "duplicates", "qualified", "disqualified", "all", "aging"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const newInquirySchema = z.object({
  source_channel: z.enum(SOURCE_CHANNELS),
  source_detail: z.string().trim().max(200).optional().or(z.literal("")),
  raw_name: z.string().trim().max(200).optional().or(z.literal("")),
  raw_phone: z.string().trim().max(40).optional().or(z.literal("")),
  raw_email: z.string().trim().email().max(200).optional().or(z.literal("")),
  raw_company: z.string().trim().max(200).optional().or(z.literal("")),
  interest: z.string().trim().max(2000).optional().or(z.literal("")),
  product_interest: z.array(z.enum(PRODUCT_INTERESTS)),
  location_id: uuid().optional().or(z.literal("")),
  owner_id: uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  raw_text: z.string().max(8000).optional().or(z.literal("")),
}).refine((v) => (v.raw_name && v.raw_name.length > 0) || (v.raw_phone && v.raw_phone.length > 0) || (v.raw_email && v.raw_email.length > 0), {
  message: "Provide at least a name, phone, or email.",
  path: ["raw_name"],
});
export type NewInquiryInput = z.infer<typeof newInquirySchema>;

export const logResponseSchema = z.object({
  lead_id: uuid(),
  kind: z.enum(["call", "message", "email", "meeting"]),
  channel: z.enum(["phone", "whatsapp", "email", "dm", "meeting"]),
  reached: z.boolean(),
  body: z.string().trim().max(4000).optional().or(z.literal("")),
});

export const convertLeadSchema = z.object({
  lead_id: uuid(),
  contact_id: uuid(),
  account_id: uuid().optional().or(z.literal("")),
  project_name: z.string().trim().min(2).max(200),
  opportunity_name: z.string().trim().min(2).max(200),
  estimated_value: z.coerce.number().nonnegative().optional(),
  next_action: z.string().trim().min(2).max(200),
  next_action_due_at: z.string().min(1),
});
