import { z } from "zod";
import { uuid } from "@/lib/zod";
import { PRODUCT_INTERESTS, SOURCE_CHANNELS } from "@/features/crm/schema";

const optionalStr = z.string().trim().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalUuid = uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalNumber = z.preprocess((v) => v === "" || (typeof v === "number" && Number.isNaN(v)) ? undefined : v, z.coerce.number().finite().nonnegative().optional());

export const changeStageSchema = z.object({
  opportunity_id: uuid(),
  to_stage_key: z.string().min(1, "Choose a stage"),
  reason: optionalStr,
  next_action: optionalStr,
  next_action_due_at: optionalStr,
  outcome_date: optionalStr,
});

export const OPPORTUNITY_SEGMENTS = ["institutional", "residential", "fnb", "hospitality", "commercial", "other"] as const;

export const updateOpportunitySchema = z.object({
  id: uuid(),
  version: z.coerce.number().int().positive(),
  request_id: uuid(),
  name: z.string().trim().min(2),
  segment: z.enum(OPPORTUNITY_SEGMENTS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  estimated_value: optionalNumber,
  currency: z.string().length(3).default("MYR"),
  probability_band: z.enum(["low", "medium", "high"]).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  expected_close_date: optionalStr,
  next_action: optionalStr,
  next_action_due_at: optionalStr,
  product_interest: z.array(z.enum(PRODUCT_INTERESTS)).default([]),
  competitor: optionalStr,
  notes: optionalStr,
  owner_id: optionalUuid,
  source_channel: z.enum(SOURCE_CHANNELS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const addQuoteVersionSchema = z.object({
  opportunity_id: uuid(),
  quote_id: optionalUuid,
  quote_number: z.string().trim().min(1),
  issued_at: optionalStr,
  valid_until: optionalStr,
  total_amount: optionalNumber,
  currency: z.string().length(3).default("MYR"),
  external_ref: optionalStr,
  notes: optionalStr,
  link_sql_document: z.coerce.boolean().default(false),
});

export const reassignSchema = z.object({ opportunity_id: uuid(), version: z.coerce.number().int().positive(), request_id: uuid(), owner_id: uuid(), reason: optionalStr });

export const createOpportunitySchema = z.object({
  request_id: uuid(),
  name: z.string().trim().min(2, "Opportunity name is required"),
  contact_id: optionalUuid, account_id: optionalUuid, project_id: optionalUuid,
  owner_id: optionalUuid,
  estimated_value: z.preprocess((v) => v === "" ? undefined : v, z.coerce.number().finite().nonnegative().optional()),
  currency: z.string().regex(/^[A-Z]{3}$/).default("MYR"),
  next_action: z.string().trim().min(1, "Enter the next action"),
  next_action_due_at: z.string().min(1, "Enter the next action due date"),
  source_channel: optionalStr, notes: optionalStr,
  product_interest: z.array(z.enum(PRODUCT_INTERESTS)).default([]),
}).refine((v) => v.contact_id || v.account_id, { path: ["contact_id"], message: "Choose a contact or company" });

export const archiveOpportunitySchema = z.object({ id: uuid(), version: z.coerce.number().int().positive(), request_id: uuid(), action: z.enum(["archive", "restore"]), reason: z.string().trim().min(1).max(2000) });
export const opportunityPhotoSchema = z.object({ action: z.enum(["prepare", "finish", "remove"]), opportunity_id: uuid(), photo_id: uuid(), file_name: z.string().max(255).optional(), content_type: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(), file_size: z.number().int().positive().max(5242880).optional(), remark: z.string().trim().max(2000).optional(), reason: z.string().trim().max(2000).optional() });
