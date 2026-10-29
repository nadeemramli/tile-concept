import { z } from "zod";
import { uuid } from "@/lib/zod";
import { COMPETITOR_EVIDENCE, COMPETITOR_RELATIONSHIPS, OUTCOME_REASONS, outcomeReason } from "@/lib/domain/outcome-reasons";

/**
 * Client-side shape of api.pursuit_outcome_command. The database repeats every
 * rule (it is the authority); this schema only catches what can be checked
 * before a round trip, with the same wording.
 */
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => (v ? v : undefined));
const allReasonKeys = [...new Set(Object.values(OUTCOME_REASONS).flat().map((r) => r.key))] as [string, ...string[]];

const target = {
  lead_id: uuid().optional(),
  opportunity_id: uuid().optional(),
};

const reasonFields = {
  reason_code: z.enum(allReasonKeys, { message: "Choose a reason. Use Unknown when the reason is not known." }),
  reason_detail: text(2000),
  effective_date: isoDate,
  review_date: optionalDate,
  competitor_name: text(200),
  competitor_relationship: z.enum(COMPETITOR_RELATIONSHIPS.map((r) => r.key) as [string, ...string[]]).optional(),
  competitor_relationship_detail: text(2000),
  competitor_evidence: z.enum(COMPETITOR_EVIDENCE.map((r) => r.key) as [string, ...string[]]).optional(),
  duplicate_of_lead_id: uuid().optional(),
};

const closeSchema = (action: "lose" | "reject" | "defer", type: "lost" | "rejected" | "deferred") =>
  z.object({ action: z.literal(action), ...target, ...reasonFields }).superRefine((v, ctx) => {
    const reason = outcomeReason(type, v.reason_code);
    if (!reason) { ctx.addIssue({ code: "custom", path: ["reason_code"], message: "Choose a listed reason" }); return; }
    if (reason.requiresDetail && (v.reason_detail?.length ?? 0) < 3) ctx.addIssue({ code: "custom", path: ["reason_detail"], message: "Explain the reason (at least 3 characters)" });
    if (type === "deferred" && !v.review_date) ctx.addIssue({ code: "custom", path: ["review_date"], message: "Choose a review date for the deferral" });
    if (type !== "deferred" && v.review_date) ctx.addIssue({ code: "custom", path: ["review_date"], message: "Only a deferral has a review date" });
    if (reason.isCompetitor) {
      if (!v.competitor_relationship) ctx.addIssue({ code: "custom", path: ["competitor_relationship"], message: "State the relationship with the supplier, or choose Unknown" });
      if (v.competitor_relationship === "reported") {
        if ((v.competitor_relationship_detail?.length ?? 0) < 3) ctx.addIssue({ code: "custom", path: ["competitor_relationship_detail"], message: "Describe the reported relationship (at least 3 characters)" });
        if (!v.competitor_evidence) ctx.addIssue({ code: "custom", path: ["competitor_evidence"], message: "State how the relationship is known" });
      }
    }
    if (v.reason_code === "duplicate" && !v.duplicate_of_lead_id && (v.reason_detail?.length ?? 0) < 3) {
      ctx.addIssue({ code: "custom", path: ["reason_detail"], message: "Link the original inquiry or explain which inquiry this duplicates" });
    }
  });

export const pursuitOutcomeSchema = z.object({ request_id: uuid() }).and(
  z.discriminatedUnion("action", [
    closeSchema("lose", "lost"),
    closeSchema("reject", "rejected"),
    closeSchema("defer", "deferred"),
    z.object({
      action: z.literal("reopen"),
      ...target,
      reason_detail: z.string().trim().min(3, "Record why the pursuit is reopened (at least 3 characters)").max(2000),
      next_follow_up_at: z.iso.datetime({ offset: true }),
      next_action: text(200),
      stage_key: text(64),
    }),
    z.object({
      action: z.literal("correct"),
      event_id: uuid(),
      correction_note: z.string().trim().min(3, "Record why the outcome is corrected (at least 3 characters)").max(2000),
      ...reasonFields,
    }),
  ]),
).refine((v) => v.action === "correct" || !!v.lead_id || !!v.opportunity_id, { message: "Choose an inquiry or opportunity" });

export type PursuitOutcomeInput = z.input<typeof pursuitOutcomeSchema>;
export type PursuitOutcomeAction = PursuitOutcomeInput["action"];
