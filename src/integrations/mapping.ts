/**
 * Provider payload → canonical lead fields, through the versioned mapping
 * table (PRD §11.2). A question we have no mapping for is never dropped: it
 * stays in the raw payload and is reported as unmapped so someone can add it.
 */

export type TargetField = "name" | "phone" | "email" | "company" | "interest" | "product_interest" | "area" | "notes" | "ignore";

export interface FieldMapping {
  source_field: string;
  target_field: TargetField;
  form_ref?: string | null;
  version?: number | null;
}

export interface MappedFields {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  interest?: string;
  area?: string;
  notes?: string;
  product_interest?: string[];
  source_detail?: string;
}

export interface MappingResult {
  fields: MappedFields;
  unmapped: Record<string, unknown>;
}

const PRODUCT_INTEREST = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"] as const;

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Guesses used only when no explicit mapping row exists for a question. */
const FALLBACK: Record<string, TargetField> = {
  name: "name",
  full_name: "name",
  nama: "name",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  telefon: "phone",
  whatsapp: "phone",
  email: "email",
  e_mail: "email",
  company: "company",
  company_name: "company",
  syarikat: "company",
  message: "notes",
  notes: "notes",
  enquiry: "interest",
  interest: "interest",
  what_are_you_looking_for: "interest",
  area: "area",
  location: "area",
  city: "area",
};

/**
 * Flattens a provider answer list or object into canonical fields.
 * Accepts either a flat object or Meta's `field_data: [{name, values: []}]`.
 */
export function applyMappings(payload: Record<string, unknown>, mappings: FieldMapping[], formRef?: string | null): MappingResult {
  const flat = flatten(payload);
  const relevant = mappings.filter((m) => !m.form_ref || !formRef || m.form_ref === formRef);
  const byField = new Map<string, TargetField>();
  for (const m of relevant) byField.set(normalizeKey(m.source_field), m.target_field);

  const fields: MappedFields = {};
  const unmapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (value === null || value === undefined || value === "") continue;
    const target = byField.get(key) ?? FALLBACK[key];
    if (!target || target === "ignore") {
      if (!byField.has(key)) unmapped[key] = value;
      continue;
    }
    if (target === "product_interest") {
      const parsed = parseProductInterest(value);
      if (parsed.length) fields.product_interest = [...new Set([...(fields.product_interest ?? []), ...parsed])];
      continue;
    }
    if (!fields[target]) fields[target] = String(value).slice(0, 2000);
  }

  // An interest sentence often names a product family; keep the sentence and
  // derive the tags rather than choosing between them.
  if (!fields.product_interest && fields.interest) {
    const derived = parseProductInterest(fields.interest);
    if (derived.length) fields.product_interest = derived;
  }

  return { fields, unmapped };
}

function parseProductInterest(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String).join(" ") : String(value);
  const text = raw.toLowerCase();
  const out: string[] = [];
  for (const key of PRODUCT_INTEREST) if (text.includes(key.replace("_", " ")) || text.includes(key)) out.push(key);
  if (!out.includes("wall_panel") && /\bpanel/.test(text)) out.push("wall_panel");
  if (!out.includes("tile") && /\btiles?\b/.test(text)) out.push("tile");
  return [...new Set(out)];
}

/** Meta/TikTok style answer lists become plain key/value pairs. */
export function flatten(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const answers = (payload.field_data ?? payload.answers ?? payload.fields) as unknown;
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (!a || typeof a !== "object") continue;
      const entry = a as Record<string, unknown>;
      const key = String(entry.name ?? entry.field_name ?? entry.key ?? "");
      if (!key) continue;
      const values = entry.values ?? entry.value ?? entry.answer;
      out[normalizeKey(key)] = Array.isArray(values) ? values.map(String).join(", ") : values;
    }
  }
  for (const [k, v] of Object.entries(payload)) {
    if (k === "field_data" || k === "answers" || k === "fields") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) continue;
    out[normalizeKey(k)] = v;
  }
  return out;
}
