import { z } from "zod";
import { uuid } from "@/lib/zod";
import { CAPTURE_TYPES, CONTENT_TYPES, OUTCOMES, OUTPUT_KINDS, PARTICIPANT_ROLES, PERMISSION_OPTIONS, PERMITTED_USES, PRODUCT_INTEREST_OPTIONS, READINESS_OPTIONS, SCHEDULABLE_STATUSES } from "@/features/marketing/lib/status";

const optionalStr = z.string().trim().optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date").optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const optionalId = uuid().optional().or(z.literal("")).transform((v) => (v ? v : undefined));

const values = <T extends readonly { value: string }[]>(list: T) => list.map((c) => c.value) as [string, ...string[]];

export const nominateSchema = z.object({
  project_id: uuid(),
  content_types: z.array(z.enum(values(CONTENT_TYPES))).min(1, "Choose at least one content type"),
  story_angle: optionalStr,
  nomination_reason: optionalStr,
  readiness_state: z.enum(READINESS_OPTIONS).default("in_progress"),
  target_window_start: optionalDate,
  target_window_end: optionalDate,
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  products_used: z.array(z.enum(PRODUCT_INTEREST_OPTIONS)).default([]),
  site_notes: optionalStr,
  interview_subjects: optionalStr,
  special_requirements: optionalStr,
  opportunity_id: optionalId,
  purchase_id: optionalId,
});

export const contentStatusSchema = z.object({
  id: uuid(),
  status: z.enum(["nominated", "under_review", "needs_info", "accepted", "deferred", "declined", "scheduled", "completed", "cancelled"]),
  reason: optionalStr,
  marketing_owner_id: optionalId,
});

export const readinessSchema = z.object({
  id: uuid(),
  readiness_state: z.enum(READINESS_OPTIONS),
  note: optionalStr,
});

export const permissionSchema = z
  .object({
    content_opportunity_id: uuid(),
    status: z.enum(PERMISSION_OPTIONS),
    granted_by_name: optionalStr,
    permitted_capture: z.array(z.enum(values(CAPTURE_TYPES))).default([]),
    permitted_uses: z.array(z.enum(values(PERMITTED_USES))).default([]),
    restrictions: optionalStr,
    expires_at: optionalDate,
    evidence_storage_path: optionalStr,
    granted_at: optionalStr,
    revocation_reason: optionalStr,
  })
  // Mirror the database's rules so the operator sees them before submitting.
  .superRefine((v, ctx) => {
    const approving = v.status === "approved" || v.status === "approved_with_restrictions";
    if (approving && !v.granted_by_name) ctx.addIssue({ code: "custom", path: ["granted_by_name"], message: "Record who granted the permission" });
    if (approving && v.permitted_uses.length === 0) ctx.addIssue({ code: "custom", path: ["permitted_uses"], message: "Record at least one permitted use" });
    if (v.status === "approved_with_restrictions" && !v.restrictions) ctx.addIssue({ code: "custom", path: ["restrictions"], message: "Describe the restrictions" });
    if (v.status === "revoked" && !v.revocation_reason) ctx.addIssue({ code: "custom", path: ["revocation_reason"], message: "Revocation reason required" });
  });

export const participantSchema = z.object({
  user_id: optionalId,
  external_name: optionalStr,
  role: z.enum(PARTICIPANT_ROLES).default("crew"),
  status: z.enum(["assigned", "accepted", "declined", "standby"]).default("assigned"),
});

export const siteSchema = z.object({
  project_site_id: optionalId,
  sequence: z.coerce.number().int().min(1).default(1),
  travel_buffer_minutes: z.coerce.number().int().min(0).max(600).default(45),
  notes: optionalStr,
});

export const bookingSchema = z
  .object({
    booking_id: optionalId,
    content_opportunity_id: uuid(),
    title: optionalStr,
    starts_at: z.string().min(1, "Choose a start time"),
    ends_at: z.string().min(1, "Choose an end time"),
    status: z.enum(SCHEDULABLE_STATUSES).default("tentative"),
    all_day: z.coerce.boolean().default(false),
    participants: z.array(participantSchema).default([]),
    sites: z.array(siteSchema).default([]),
    notes: optionalStr,
    reason: optionalStr,
    override: z.coerce.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.ends_at) <= new Date(v.starts_at)) ctx.addIssue({ code: "custom", path: ["ends_at"], message: "The end time must be after the start time" });
    if (v.override && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "An override needs a reason" });
  });

export const conflictSchema = z.object({
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  participant_ids: z.array(uuid()).default([]),
  booking_id: optionalId,
  buffer_minutes: z.coerce.number().int().min(0).max(600).default(45),
});

export const outcomeSchema = z
  .object({
    booking_id: uuid(),
    outcome: z.enum(OUTCOMES),
    reason: optionalStr,
    follow_up: optionalStr,
  })
  .superRefine((v, ctx) => {
    if (v.outcome !== "completed" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Reason required for anything other than a completed shoot" });
  });

export const outputSchema = z.object({
  content_opportunity_id: uuid(),
  shoot_booking_id: optionalId,
  kind: z.enum(OUTPUT_KINDS),
  storage_path: z.string().trim().min(1),
  caption: optionalStr,
  mime_type: optionalStr,
  size_bytes: z.coerce.number().int().nonnegative().optional(),
  captured_at: optionalStr,
});

export const outputReviewSchema = z.object({
  output_id: uuid(),
  decision: z.enum(["usable", "restricted", "rejected"]),
  reason: optionalStr,
});

export const checklistToggleSchema = z.object({ id: uuid(), is_done: z.coerce.boolean() });
export const checklistAddSchema = z.object({ shoot_booking_id: uuid(), item: z.string().trim().min(2, "Describe the check") });
export const signedUrlSchema = z.object({ bucket: z.enum(["permission-evidence", "shoot-outputs"]), path: z.string().trim().min(1) });

export type NominateInput = z.input<typeof nominateSchema>;
export type PermissionInput = z.input<typeof permissionSchema>;
export type BookingInput = z.input<typeof bookingSchema>;
export type OutcomeInput = z.input<typeof outcomeSchema>;
