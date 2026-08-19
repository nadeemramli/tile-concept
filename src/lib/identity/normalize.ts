import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Country-aware E.164 normalization (PRD §6.1). Defaults to Malaysia. */
export function normalizePhone(raw: string | null | undefined, defaultCountry: "MY" = "MY"): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (parsed?.isValid()) return parsed.number;
  // Fallback mirrors core.normalize_phone in SQL so app and DB agree on weird inputs.
  const d = cleaned.replace(/\D/g, "");
  if (!d) return null;
  if (cleaned.startsWith("+")) return `+${d}`;
  if (d.startsWith("60") && d.length >= 10) return `+${d}`;
  if (d.startsWith("0")) return `+6${d}`;
  if (d.length >= 9 && d.length <= 10) return `+60${d}`;
  return `+${d}`;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}

export function normalizeRegistrationNumber(raw: string | null | undefined): string | null {
  const v = raw?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return v ? v : null;
}

export function normalizeName(raw: string | null | undefined): string | null {
  const v = raw?.trim().replace(/\s+/g, " ");
  return v ? v : null;
}

export interface ExtractedFields {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  message?: string;
}

/**
 * Paste-to-extract helper (PRD §7.2): proposes fields from free text. Purely
 * heuristic; the user always reviews before save.
 */
export function extractFromText(text: string): ExtractedFields {
  const out: ExtractedFields = {};
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) out.email = email[0];
  const phone = text.match(/(\+?6?0?1[0-9][\s-]?\d{3,4}[\s-]?\d{4})/);
  if (phone) out.phone = phone[0].trim();
  const name = text.match(/(?:my name is|name is|name|nama|i am|i'm|this is)\s*[:\-]?\s*([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,3})/);
  if (name) out.name = name[1].trim();
  const company = text.match(/(?:company|syarikat|from|firm)\s*[:\-]?\s*([A-Z][A-Za-z0-9&'’.\- ]{2,60}?(?:Sdn\.?\s*Bhd\.?|Bhd|Enterprise|Trading|Design|Studio|Construction|Contractor)?)(?=[.,\n]|$)/i);
  if (company) out.company = company[1].trim();
  out.message = text.trim().slice(0, 2000);
  return out;
}
