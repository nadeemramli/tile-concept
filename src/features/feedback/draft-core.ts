import { createHash } from "node:crypto";

const clean = (value: string) => value.trim().replace(/\s+/g, " ");

function sentence(value: string, fragmentPrefix: string): string {
  if (!value) return "";
  const alreadySentenceLike = /^(i|we|the|my|our|it|staff|service|showroom|tile concept)\b/i.test(value);
  const fragment = `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
  const text = alreadySentenceLike ? value : `${fragmentPrefix}${fragment}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1).replace(/[.!?]+$/, "")}.`;
}

export function buildDeterministicDraft(answers: string[]): string {
  const value = answers.map(clean);
  const sentences = [
    sentence(value[0], "I visited Tile Concept looking for "),
    sentence(value[1], "The most useful part was "),
    sentence(value[2], "My choice was "),
    sentence(value[3], "Overall, "),
    sentence(value[4], "For a future visit, I would suggest "),
  ].filter(Boolean);
  return sentences.join(" ");
}

export function feedbackInputHash(answers: string[]): string {
  return createHash("sha256").update(JSON.stringify(answers.map(clean))).digest("hex");
}
