/**
 * Pursuit classification taxonomy: the mirror of `core.classification_values`
 * (the database is the authority and validates every write). Buyer role,
 * project use, work type and GLC involvement are independent dimensions of one
 * buying pursuit, each with an explicit Unknown.
 *
 * Pure, with no path-alias imports: the server, the client and the importers in
 * scripts/import share it. `classificationKey` follows the same rule as
 * `core.classification_key`, so an import maps a source spelling exactly as
 * the database would, and an unmatched spelling stays unmatched.
 */

export const CLASSIFICATION_DIMENSIONS = ["buyer_role", "project_use", "work_type", "glc_involvement", "glc_party_role"] as const;
export type ClassificationDimension = (typeof CLASSIFICATION_DIMENSIONS)[number];
/** The four dimensions every pursuit states, Unknown included. */
export const REQUIRED_DIMENSIONS = ["buyer_role", "project_use", "work_type", "glc_involvement"] as const;

export interface ClassificationOption {
  key: string;
  label: string;
  hint: string;
  /** Offered first when capturing new work. */
  primary: boolean;
  /** Valid on earlier records and in imports; reported as its own group. */
  legacy: boolean;
  /** Source spellings (lower case, single spaces) that mean exactly this value. */
  aliases: readonly string[];
}

const UNKNOWN_HINT = "Not yet established. Counted as unknown in reports, never guessed.";

export const CLASSIFICATION_OPTIONS: Record<ClassificationDimension, readonly ClassificationOption[]> = {
  buyer_role: [
    { key: "end_user", label: "End user", hint: "The person or business that will use the finished space, such as a homeowner or a shop owner.", primary: true, legacy: false, aliases: ["end user", "enduser", "homeowner", "home owner"] },
    { key: "contractor", label: "Contractor", hint: "A contractor buying or specifying for a client's job.", primary: true, legacy: false, aliases: ["main contractor", "sub contractor", "subcontractor"] },
    { key: "interior_designer", label: "Interior designer", hint: "An interior designer specifying for a client's job.", primary: true, legacy: false, aliases: ["interior designer", "designer", "id"] },
    { key: "developer", label: "Developer", hint: "Property developer. Kept from earlier records; reported as its own group.", primary: false, legacy: true, aliases: ["property developer"] },
    { key: "architect", label: "Architect", hint: "Architect. Kept from earlier records; reported as its own group.", primary: false, legacy: true, aliases: [] },
    { key: "retailer", label: "Retailer", hint: "Retailer or dealer. Kept from earlier records; reported as its own group.", primary: false, legacy: true, aliases: ["retail"] },
    { key: "other", label: "Other", hint: "Known, but none of the listed roles. Say who in the note.", primary: true, legacy: false, aliases: [] },
    { key: "unknown", label: "Unknown", hint: UNKNOWN_HINT, primary: true, legacy: false, aliases: ["not sure", "not known"] },
  ],
  project_use: [
    { key: "residential", label: "Residential", hint: "Homes: landed houses, condominiums, apartments.", primary: true, legacy: false, aliases: [] },
    { key: "commercial", label: "Commercial", hint: "Offices, shops, retail and other business premises.", primary: true, legacy: false, aliases: [] },
    { key: "hospitality", label: "Hospitality", hint: "Hotels, resorts and serviced accommodation.", primary: true, legacy: false, aliases: [] },
    { key: "mixed", label: "Mixed use", hint: "One project combining more than one use, such as shops below homes.", primary: true, legacy: false, aliases: ["mixed use", "mixed development"] },
    { key: "other", label: "Other", hint: "Known, but none of the listed uses. Say which in the note.", primary: true, legacy: false, aliases: [] },
    { key: "unknown", label: "Unknown", hint: UNKNOWN_HINT, primary: true, legacy: false, aliases: ["not sure", "not known"] },
  ],
  work_type: [
    { key: "new_build", label: "New build", hint: "A new building or a first fit-out.", primary: true, legacy: false, aliases: ["new build", "new construction"] },
    { key: "renovation", label: "Renovation", hint: "Changing or replacing finishes in an existing space.", primary: true, legacy: false, aliases: ["reno", "refurbishment"] },
    { key: "other", label: "Other", hint: "Known, but neither a new build nor a renovation.", primary: true, legacy: false, aliases: [] },
    { key: "unknown", label: "Unknown", hint: UNKNOWN_HINT, primary: true, legacy: false, aliases: ["not sure", "not known"] },
  ],
  glc_involvement: [
    { key: "yes", label: "GLC involved", hint: "A government-linked company is a party to this project. Independent of project use.", primary: true, legacy: false, aliases: ["glc"] },
    { key: "no", label: "No GLC", hint: "No government-linked company is a party to this project.", primary: true, legacy: false, aliases: ["non glc", "non-glc"] },
    { key: "unknown", label: "Unknown", hint: "Not yet established whether a GLC is involved.", primary: true, legacy: false, aliases: ["not sure", "not known"] },
  ],
  glc_party_role: [
    { key: "end_client", label: "End client", hint: "The GLC owns or will use the finished space.", primary: true, legacy: false, aliases: ["client", "owner"] },
    { key: "developer", label: "Developer", hint: "The GLC is the developer.", primary: true, legacy: false, aliases: [] },
    { key: "main_contractor", label: "Main contractor", hint: "The GLC is the main contractor.", primary: true, legacy: false, aliases: ["contractor"] },
    { key: "consultant", label: "Consultant", hint: "The GLC is a consultant on the project.", primary: true, legacy: false, aliases: [] },
    { key: "other", label: "Other", hint: "Another party role. Say which in the note.", primary: true, legacy: false, aliases: [] },
    { key: "unknown", label: "Unknown", hint: "A GLC is involved but its role is not yet established.", primary: true, legacy: false, aliases: [] },
  ],
};

export const DIMENSION_LABEL: Record<ClassificationDimension, string> = {
  buyer_role: "Buyer role",
  project_use: "Project use",
  work_type: "Work type",
  glc_involvement: "GLC involvement",
  glc_party_role: "GLC party role",
};

export const DIMENSION_HINT: Record<ClassificationDimension, string> = {
  buyer_role: "Who is buying in this pursuit. The same person can hold a different role in another pursuit, so this is never copied from the customer record.",
  project_use: "What the finished space is used for. Independent of whether a GLC is involved.",
  work_type: "Whether the work is a new build or a renovation.",
  glc_involvement: "Whether a government-linked company is a party. A residential job for a GLC is Residential and GLC involved: counted once in each, never twice.",
  glc_party_role: "Which party the GLC is. Only asked when a GLC is involved.",
};

export const BUYER_ROLES = CLASSIFICATION_OPTIONS.buyer_role.map((o) => o.key);
export const PROJECT_USES = CLASSIFICATION_OPTIONS.project_use.map((o) => o.key);
export const WORK_TYPES = CLASSIFICATION_OPTIONS.work_type.map((o) => o.key);
export const GLC_INVOLVEMENT = CLASSIFICATION_OPTIONS.glc_involvement.map((o) => o.key);
export const GLC_PARTY_ROLES = CLASSIFICATION_OPTIONS.glc_party_role.map((o) => o.key);

export function optionsFor(dimension: ClassificationDimension): readonly ClassificationOption[] {
  return CLASSIFICATION_OPTIONS[dimension];
}

export function optionLabel(dimension: ClassificationDimension, key: string | null | undefined): string {
  if (!key) return "—";
  return CLASSIFICATION_OPTIONS[dimension].find((o) => o.key === key)?.label ?? key;
}

/** Lower case, trimmed, with spaces, hyphens and underscores collapsed to one space. */
export function normalizeSourceValue(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * The taxonomy key a source spelling means, or null when it means nothing we
 * know. Same rule as `core.classification_key`: the key itself, an alias, or
 * the key with spaces for underscores. Never a fuzzy guess.
 */
export function classificationKey(dimension: ClassificationDimension, raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const exact = raw.trim().toLowerCase();
  const spaced = normalizeSourceValue(raw);
  return CLASSIFICATION_OPTIONS[dimension].find((o) => o.key === exact || o.aliases.includes(spaced) || o.key.replace(/_/g, " ") === spaced)?.key ?? null;
}

export interface ClassificationValues {
  buyer_role: string;
  project_use: string;
  work_type: string;
  glc_involvement: string;
  glc_party_role: string | null;
}

export const UNKNOWN_CLASSIFICATION: ClassificationValues = { buyer_role: "unknown", project_use: "unknown", work_type: "unknown", glc_involvement: "unknown", glc_party_role: null };

/** The dimensions still Unknown, in display order. The GLC party role counts only when a GLC is involved. */
export function missingDimensions(v: ClassificationValues): ClassificationDimension[] {
  const missing: ClassificationDimension[] = REQUIRED_DIMENSIONS.filter((d) => v[d] === "unknown");
  if (v.glc_involvement === "yes" && (v.glc_party_role ?? "unknown") === "unknown") missing.push("glc_party_role");
  return missing;
}

/** Dimensions that held a known value and would change: a correction that needs a reason. */
export function changedKnownDimensions(current: ClassificationValues, next: ClassificationValues): ClassificationDimension[] {
  return CLASSIFICATION_DIMENSIONS.filter((d) => {
    const before = current[d];
    return before !== null && before !== "unknown" && before !== next[d];
  });
}

/**
 * Values a contact's own customer type may hold: the buyer roles (Unknown is
 * an empty value on a person) plus the two earlier labels still on records.
 */
export const CONTACT_CUSTOMER_TYPES = [...BUYER_ROLES.filter((k) => k !== "unknown"), "homeowner", "designer"] as const;
export const CONTACT_CUSTOMER_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(CLASSIFICATION_OPTIONS.buyer_role.map((o) => [o.key, o.label])),
  homeowner: "Homeowner (earlier label)",
  designer: "Designer (earlier label)",
};
