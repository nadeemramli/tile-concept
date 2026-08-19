import { z } from "zod";
import { uuid } from "@/lib/zod";

export const CUSTOMER_TYPES = ["homeowner", "contractor", "designer", "developer", "retailer", "architect", "other"] as const;
export const ACCOUNT_TYPES = ["contractor", "developer", "designer", "retailer", "corporate", "government", "other"] as const;
export const PROJECT_TYPES = ["residential", "commercial", "renovation", "new_build", "hospitality", "other"] as const;
export const PROJECT_STATUSES = ["planning", "active", "completed", "on_hold", "cancelled"] as const;
export const SOURCE_CHANNELS = ["tiktok", "meta", "website", "whatsapp", "dm", "call", "email", "referral", "walk_in", "other"] as const;
export const ACTIVITY_KINDS = ["call", "message", "email", "meeting", "walk_in", "note", "sample", "site_visit"] as const;
export const PRODUCT_INTERESTS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;

const optionalStr = z.string().trim().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalUuid = uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined));

export const createContactSchema = z.object({
  display_name: z.string().trim().min(2, "Name is required"),
  phone: optionalStr,
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  customer_type: z.enum(CUSTOMER_TYPES).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  source: z.enum(SOURCE_CHANNELS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  account_id: optionalUuid,
  notes: optionalStr,
});
export type CreateContactInput = z.input<typeof createContactSchema>;

export const updateContactSchema = z.object({
  id: uuid(),
  display_name: z.string().trim().min(2),
  given_name: optionalStr,
  family_name: optionalStr,
  customer_type: z.enum(CUSTOMER_TYPES).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  preferred_language: optionalStr,
  notes: optionalStr,
});

export const createAccountSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  account_type: z.enum(ACCOUNT_TYPES).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  registration_number: optionalStr,
  website: optionalStr,
  city: optionalStr,
  state: optionalStr,
  owner_id: optionalUuid,
  source: z.enum(SOURCE_CHANNELS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  notes: optionalStr,
});

export const updateAccountSchema = createAccountSchema.extend({ id: uuid() });

export const addActivitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  channel: optionalStr,
  subject: z.string().trim().min(1, "Subject is required"),
  body: optionalStr,
  contact_id: optionalUuid,
  account_id: optionalUuid,
  project_id: optionalUuid,
  opportunity_id: optionalUuid,
});

export const addTaskSchema = z.object({
  title: z.string().trim().min(2),
  due_at: optionalStr,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignee_id: optionalUuid,
  contact_id: optionalUuid,
  account_id: optionalUuid,
  project_id: optionalUuid,
  opportunity_id: optionalUuid,
});

export const createProjectOpportunitySchema = z.object({
  project_name: z.string().trim().min(2, "Project name is required"),
  project_type: z.enum(PROJECT_TYPES).default("other"),
  area: optionalStr,
  contact_id: optionalUuid,
  account_id: optionalUuid,
  owner_id: optionalUuid,
  expected_start: optionalStr,
  expected_completion: optionalStr,
  create_opportunity: z.coerce.boolean().default(true),
  opportunity_name: optionalStr,
  estimated_value: z.coerce.number().nonnegative().optional().or(z.nan().transform(() => undefined)),
  next_action: optionalStr,
  next_action_due_at: optionalStr,
  product_interest: z.array(z.enum(PRODUCT_INTERESTS)).default([]),
  source_channel: z.enum(SOURCE_CHANNELS).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const linkContactAccountSchema = z.object({
  contact_id: uuid(),
  account_id: uuid(),
  role: optionalStr,
  is_primary: z.coerce.boolean().default(false),
});

export const addSiteSchema = z.object({
  project_id: uuid(),
  label: z.string().trim().min(1).default("Site"),
  city: optionalStr,
  state: optionalStr,
  line1: optionalStr,
  access_notes: optionalStr,
});

export const updateProjectSchema = z.object({
  id: uuid(),
  name: z.string().trim().min(2),
  project_type: z.enum(PROJECT_TYPES),
  status: z.enum(PROJECT_STATUSES),
  area: optionalStr,
  owner_id: optionalUuid,
  expected_start: optionalStr,
  expected_completion: optionalStr,
  notes: optionalStr,
});
