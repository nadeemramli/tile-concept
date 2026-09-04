import "server-only";

import { gateway, generateText } from "ai";
import { FEEDBACK_QUESTIONS } from "@/features/feedback/schema";
import { buildDeterministicDraft, feedbackInputHash } from "@/features/feedback/draft-core";

export const REVIEW_PROMPT_VERSION = "customer-review-v1";
export const DEFAULT_REVIEW_MODEL = "openai/gpt-5.4-mini";

export async function generateCustomerDraft(answers: string[]): Promise<{
  text: string;
  mode: "llm" | "deterministic";
  modelId: string | null;
  inputHash: string;
}> {
  const inputHash = feedbackInputHash(answers);
  const fallback = buildDeterministicDraft(answers);
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return { text: fallback, mode: "deterministic", modelId: null, inputHash };

  const modelId = process.env.TC_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL;
  const source = FEEDBACK_QUESTIONS.map((question, index) => `${index + 1}. ${question.text}\nAnswer: ${answers[index]?.trim() || "[skipped]"}`).join("\n\n");
  try {
    const result = await generateText({
      model: gateway(modelId),
      instructions:
        "Rewrite only the customer's supplied answers into a concise first-person review draft. Preserve criticism, uncertainty, language, and meaning. Do not invent praise, products, results, staff names, comparisons, promotions, star ratings, or facts. Do not mention a discount or incentive. If an answer was skipped, omit it. Return only the draft text.",
      prompt: source,
    });
    const text = result.text.trim();
    if (text.length < 5 || text.length > 2000) throw new Error("Draft length outside accepted bounds");
    return { text, mode: "llm", modelId, inputHash };
  } catch {
    return { text: fallback, mode: "deterministic", modelId, inputHash };
  }
}

export { buildDeterministicDraft, feedbackInputHash } from "@/features/feedback/draft-core";

