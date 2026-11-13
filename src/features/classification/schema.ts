import { z } from "zod";
import { uuid } from "@/lib/zod";
import { BUYER_ROLES, GLC_INVOLVEMENT, GLC_PARTY_ROLES, PROJECT_USES, WORK_TYPES } from "./taxonomy";

const listed = (keys: readonly string[], what: string) => z.string().refine((v) => keys.includes(v), `Choose a listed ${what}.`);

export const classificationValuesSchema = z
  .object({
    buyer_role: listed(BUYER_ROLES, "buyer role"),
    project_use: listed(PROJECT_USES, "project use"),
    work_type: listed(WORK_TYPES, "work type"),
    glc_involvement: listed(GLC_INVOLVEMENT, "GLC answer"),
    glc_party_role: listed(GLC_PARTY_ROLES, "GLC party role").nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.glc_involvement !== "yes" && v.glc_party_role) ctx.addIssue({ code: "custom", path: ["glc_party_role"], message: "A GLC party role applies only when a GLC is involved." });
  });
export type ClassificationInput = z.infer<typeof classificationValuesSchema>;

export const CLASSIFY_MODES = ["capture", "qualification", "correction"] as const;

export const classifyPursuitSchema = z
  .object({
    request_id: uuid(),
    lead_id: uuid().optional(),
    opportunity_id: uuid().optional(),
    mode: z.enum(CLASSIFY_MODES),
    expected_version: z.number().int().nonnegative(),
    reason: z.string().trim().max(2000).optional(),
    flag_missing: z.boolean().default(false),
    values: classificationValuesSchema,
  })
  .refine((v) => !!v.lead_id !== !!v.opportunity_id, { path: ["lead_id"], message: "Classify either the inquiry or the opportunity." });
export type ClassifyPursuitInput = z.input<typeof classifyPursuitSchema>;

export const ARRIVAL_CORRECTION_BASES = ["backdated", "import", "tracker"] as const;

export const setArrivalSchema = z.object({
  request_id: uuid(),
  lead_id: uuid(),
  arrived_at: z.iso.datetime({ offset: true }),
  basis: z.enum(ARRIVAL_CORRECTION_BASES),
  precision: z.enum(["exact", "date"]),
  reason: z.string().trim().min(5, "Explain where the arrival time comes from (at least 5 characters).").max(1000),
});
export type SetArrivalInput = z.input<typeof setArrivalSchema>;
