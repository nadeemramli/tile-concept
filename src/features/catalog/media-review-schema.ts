import { z } from "zod";
import { uuid } from "@/lib/zod";

const reason = z.string().trim().min(1, "State a reason").max(1000);
const note = z.string().trim().max(1000).optional();

export const confirmAssociationSchema = z.object({ link_id: uuid(), variant_id: uuid(), note });
export const rejectAssociationSchema = z.object({ link_id: uuid(), reason });
export const mediaRightsSchema = z.object({ media_asset_id: uuid(), rights_state: z.enum(["accepted", "restricted", "denied"]), reason });
export const mediaEvidenceSchema = z
  .object({ media_asset_id: uuid(), decision: z.enum(["approved", "needs_correction", "rejected"]), note })
  .refine((v) => v.decision === "approved" || !!v.note, { message: "State a reason", path: ["note"] });
export const publishMediaSchema = z.object({ link_id: uuid(), alt_text: z.string().trim().max(500).optional(), is_primary: z.boolean() });

/** Link states that still need a person; the queue opens on these. */
export const OPEN_LINK_STATES = ["pending_review", "needs_correction"] as const;
export const MEDIA_REVIEW_VIEWS = ["open", "approved", "published", "rejected", "all"] as const;
export type MediaReviewView = (typeof MEDIA_REVIEW_VIEWS)[number];
