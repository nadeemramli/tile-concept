import { z } from "zod";
import { optionalUuid, uuid } from "@/lib/zod";

export const FEEDBACK_QUESTIONS = [
  { key: "visit_goal", text: "What did you come in looking for today?" },
  { key: "useful_help", text: "What part of the service or advice was useful, if any?" },
  { key: "choice_reason", text: "Which product or option did you choose, and what influenced that choice?" },
  { key: "overall_experience", text: "How would you describe the overall experience in your own words?" },
  { key: "improvement", text: "What could we improve for your next visit?" },
] as const;

export const feedbackCaptureSchema = z
  .object({
    purchase_id: optionalUuid(),
    visit_id: optionalUuid(),
    answers: z.array(z.string().trim().max(1000)).length(FEEDBACK_QUESTIONS.length),
    whatsapp_consent: z.boolean(),
    photo_permission: z.boolean(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.purchase_id) === Boolean(value.visit_id)) context.addIssue({ code: "custom", path: ["visit_id"], message: "Choose one visit or purchase." });
    if (value.answers.filter(Boolean).length < 2) {
      context.addIssue({ code: "custom", path: ["answers"], message: "Record at least two useful customer answers." });
    }
    if (!value.whatsapp_consent) {
      context.addIssue({ code: "custom", path: ["whatsapp_consent"], message: "Confirm the customer agreed to receive the private WhatsApp link." });
    }
  });

export const customerDraftSchema = z.object({
  token: z.string().min(32).max(200),
  customer_text: z.string().trim().min(5).max(2000),
});

export const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_FEEDBACK_PHOTO_BYTES = 5 * 1024 * 1024;
export const feedbackPhotoSchema = z.object({ request_id: uuid(), media_id: uuid(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), size_bytes: z.number().int().positive().max(MAX_FEEDBACK_PHOTO_BYTES) });
export const feedbackManageSchema = z.object({ request_id: uuid(), action: z.enum(["whatsapp_sent", "review_customer_reported", "review_staff_verified", "review_declined", "review_reset", "revoke"]), note: z.string().trim().max(2000) }).superRefine((value, context) => {
  if (value.action !== "whatsapp_sent" && value.note.length < 5) context.addIssue({ code: "custom", path: ["note"], message: "Add the reason or evidence, at least 5 characters." });
});
