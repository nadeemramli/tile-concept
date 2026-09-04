import { z } from "zod";

export const FEEDBACK_QUESTIONS = [
  { key: "visit_goal", text: "What did you come in looking for today?" },
  { key: "useful_help", text: "What part of the service or advice was useful, if any?" },
  { key: "choice_reason", text: "Which product or option did you choose, and what influenced that choice?" },
  { key: "overall_experience", text: "How would you describe the overall experience in your own words?" },
  { key: "improvement", text: "What could we improve for your next visit?" },
] as const;

export const feedbackCaptureSchema = z
  .object({
    purchase_id: z.uuid(),
    answers: z.array(z.string().trim().max(1000)).length(FEEDBACK_QUESTIONS.length),
    whatsapp_consent: z.boolean(),
    photo_permission: z.boolean(),
    benefit_granted: z.boolean(),
    benefit_reference: z.string().trim().max(200),
  })
  .superRefine((value, context) => {
    if (value.answers.filter(Boolean).length < 2) {
      context.addIssue({ code: "custom", path: ["answers"], message: "Record at least two useful customer answers." });
    }
    if (!value.whatsapp_consent) {
      context.addIssue({ code: "custom", path: ["whatsapp_consent"], message: "Confirm the customer agreed to receive the private WhatsApp link." });
    }
    if (value.benefit_granted && value.benefit_reference.length < 3) {
      context.addIssue({ code: "custom", path: ["benefit_reference"], message: "Record the approved private-feedback benefit reference." });
    }
  });

export const customerDraftSchema = z.object({
  token: z.string().min(32).max(200),
  customer_text: z.string().trim().min(5).max(2000),
});

export const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_FEEDBACK_PHOTO_BYTES = 10 * 1024 * 1024;

