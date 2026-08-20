import { z } from "zod";
import { uuid } from "@/lib/zod";
import { PRODUCT_INTERESTS, SOURCE_CHANNELS } from "@/features/crm/schema";

const optionalStr = z.string().trim().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalUuid = uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalNumber = z.union([z.coerce.number(), z.literal(""), z.nan()]).optional().transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : undefined));

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

export const reassignSchema = z.object({ opportunity_id: uuid(), owner_id: uuid(), reason: optionalStr });
