/**
 * Heuristic mapping from a supplier's words to our canonical fields.
 *
 * Deliberately conservative: a header match scores high, a positional guess
 * scores low, and anything it cannot place stays in `raw` for the reviewer
 * rather than being dropped or guessed into a field.
 */
import type { FieldRegion, ParsedField } from "./types";

type CanonicalKey = "code" | "sku" | "name" | "amount" | "currency" | "color" | "finish" | "material" | "unit" | "min_quantity" | "valid_from";

/** Header synonyms, most specific first. Matched against a normalized header. */
const HEADER_SYNONYMS: { key: CanonicalKey; patterns: RegExp[] }[] = [
  { key: "code", patterns: [/^(item|product|material)?\s*(code|no|number)$/, /^sku$/, /^art(icle)?\s*(no|code)$/, /^ref(erence)?$/] },
  { key: "sku", patterns: [/^variant\s*(code|sku)$/] },
  { key: "name", patterns: [/^(product\s*)?(name|description|desc|item)$/, /^title$/] },
  { key: "amount", patterns: [/^(unit\s*)?price$/, /^amount$/, /^rate$/, /^(member|retail|list|selling)\s*price$/, /^price\s*\(?[a-z]{0,3}\)?$/] },
  { key: "currency", patterns: [/^currency$/, /^ccy$/] },
  { key: "color", patterns: [/^colou?r$/] },
  { key: "finish", patterns: [/^finish(ing)?$/, /^surface$/] },
  { key: "material", patterns: [/^material$/, /^body$/] },
  { key: "unit", patterns: [/^(selling\s*)?(unit|uom)$/, /^per$/, /^basis$/] },
  { key: "min_quantity", patterns: [/^min(imum)?\s*(qty|quantity|order)$/, /^moq$/] },
  { key: "valid_from", patterns: [/^(valid|effective)\s*(from|date)$/, /^w\.?e\.?f\.?$/] },
];

const DIMENSION_HEADERS: { key: string; patterns: RegExp[] }[] = [
  { key: "width_mm", patterns: [/^width(\s*\(?mm\)?)?$/, /^w$/] },
  { key: "length_mm", patterns: [/^length(\s*\(?mm\)?)?$/, /^l$/] },
  { key: "thickness_mm", patterns: [/^thick(ness)?(\s*\(?mm\)?)?$/, /^t$/] },
  { key: "depth_mm", patterns: [/^depth(\s*\(?mm\)?)?$/, /^d$/] },
  { key: "sheet_width_mm", patterns: [/^sheet\s*width$/] },
  { key: "sheet_height_mm", patterns: [/^sheet\s*(height|length)$/] },
];

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9() .]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which canonical field (if any) a spreadsheet header maps to. */
export function mapHeader(header: string): { key: string; kind: "canonical" | "dimension" } | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  for (const { key, patterns } of HEADER_SYNONYMS) {
    if (patterns.some((p) => p.test(h))) return { key, kind: "canonical" };
  }
  for (const { key, patterns } of DIMENSION_HEADERS) {
    if (patterns.some((p) => p.test(h))) return { key, kind: "dimension" };
  }
  return null;
}

/** A product/item code: letters and digits with separators, not a plain word. */
const CODE_RE = /\b([A-Z0-9]{2,}(?:[-/][A-Z0-9]{1,}){1,4})\b/;
/** Money with an optional currency marker. */
const MONEY_RE = /(?:(RM|MYR|SGD|USD|\$)\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:\/\s*([a-z²m]{1,6}))?/i;
/** 300x300, 600 x 1200 x 9, 300X300MM */
const DIMENSION_RE = /\b(\d{2,4})\s*[x×]\s*(\d{2,4})(?:\s*[x×]\s*(\d{1,3}(?:\.\d+)?))?\s*(mm|cm)?\b/i;

const COLOURS = ["white", "black", "grey", "gray", "beige", "cream", "oak", "walnut", "teak", "green", "blue", "red", "brown", "ivory", "charcoal", "sand", "taupe", "natural"];
const FINISHES = ["matt", "matte", "gloss", "glossy", "satin", "polished", "honed", "textured", "rustic", "lappato", "carving"];
const MATERIALS = ["porcelain", "ceramic", "wpc", "pvc", "marble", "granite", "glass", "stone", "vinyl", "aluminium", "aluminum", "steel"];
const UNIT_WORDS: Record<string, string> = { pc: "pc", pcs: "pc", piece: "pc", sheet: "sheet", sht: "sheet", ctn: "ctn", carton: "ctn", box: "ctn", sqm: "sqm", "m2": "sqm", "m²": "sqm", m: "m", meter: "m", metre: "m", set: "set", roll: "roll" };

export function parseMoney(text: string): { amount: string; currency: string | null; unit: string | null } | null {
  const m = MONEY_RE.exec(text);
  if (!m) return null;
  const amount = m[2].replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const marker = m[1]?.toUpperCase();
  const currency = marker ? (marker === "RM" || marker === "$" ? (marker === "RM" ? "MYR" : "USD") : marker) : null;
  const unit = m[3] ? (UNIT_WORDS[m[3].toLowerCase()] ?? null) : null;
  return { amount, currency, unit };
}

export function parseDimensions(text: string): Record<string, number> | null {
  const m = DIMENSION_RE.exec(text);
  if (!m) return null;
  const scale = m[4]?.toLowerCase() === "cm" ? 10 : 1;
  const dims: Record<string, number> = { width_mm: Number(m[1]) * scale, length_mm: Number(m[2]) * scale };
  if (m[3]) dims.thickness_mm = Number(m[3]) * scale;
  return dims;
}

export function parseUnit(text: string): string | null {
  const t = text.toLowerCase();
  for (const [word, unit] of Object.entries(UNIT_WORDS)) {
    if (new RegExp(`(^|[^a-z])${word.replace("²", "\\u00b2")}([^a-z]|$)`, "i").test(t)) return unit;
  }
  return null;
}

function firstWord(text: string, words: string[]): string | null {
  const t = text.toLowerCase();
  const hit = words.find((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t));
  if (!hit) return null;
  return hit.charAt(0).toUpperCase() + hit.slice(1);
}

export interface Proposal {
  normalized: Record<string, unknown>;
  fields: ParsedField[];
  confidence: number;
}

/**
 * Build a proposal from a free-text line (a PDF row). Everything here is a
 * guess, so confidences stay modest and the source text travels with each
 * field.
 */
export function proposeFromLine(line: string, region: FieldRegion): Proposal | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (text.length < 4) return null;

  const fields: ParsedField[] = [];
  const normalized: Record<string, unknown> = {};

  const codeMatch = CODE_RE.exec(text.toUpperCase());
  if (codeMatch) {
    normalized.code = codeMatch[1];
    fields.push({ key: "code", value: codeMatch[1], confidence: 0.82, source_text: text, region });
  }

  const money = parseMoney(text);
  if (money) {
    normalized.amount = money.amount;
    fields.push({ key: "amount", value: money.amount, confidence: 0.78, source_text: text, region });
    if (money.currency) {
      normalized.currency = money.currency;
      fields.push({ key: "currency", value: money.currency, confidence: 0.9, source_text: text, region });
    }
    if (money.unit) {
      normalized.unit = money.unit;
      fields.push({ key: "unit", value: money.unit, confidence: 0.7, source_text: text, region });
    }
  }

  // A code and a price are the two things that make a price-list row; without
  // either, this is prose, not a row.
  if (!codeMatch && !money) return null;

  // The name is what is left once the code and the money are removed.
  let name = text;
  if (codeMatch) name = name.replace(new RegExp(codeMatch[1], "i"), " ");
  if (money) name = name.replace(MONEY_RE, " ");
  name = name.replace(/\s{2,}/g, " ").replace(/^[\s.,;:|-]+|[\s.,;:|-]+$/g, "").trim();
  if (name.length >= 3) {
    const pretty = name.length > 90 ? name.slice(0, 90) : name;
    normalized.name = pretty;
    fields.push({ key: "name", value: pretty, confidence: 0.6, source_text: text, region });
  }

  const dims = parseDimensions(text);
  if (dims) {
    normalized.dimensions = dims;
    fields.push({ key: "dimensions", value: Object.entries(dims).map(([k, v]) => `${k}=${v}`).join(" "), confidence: 0.65, source_text: text, region });
  }
  const colour = firstWord(text, COLOURS);
  if (colour) {
    normalized.color = colour;
    fields.push({ key: "color", value: colour, confidence: 0.55, source_text: text, region });
  }
  const finish = firstWord(text, FINISHES);
  if (finish) {
    normalized.finish = finish === "Matt" ? "Matte" : finish;
    fields.push({ key: "finish", value: String(normalized.finish), confidence: 0.5, source_text: text, region });
  }
  const material = firstWord(text, MATERIALS);
  if (material) {
    normalized.material = material.toUpperCase() === "WPC" ? "WPC" : material;
    fields.push({ key: "material", value: String(normalized.material), confidence: 0.5, source_text: text, region });
  }
  if (!normalized.unit) {
    const unit = parseUnit(text);
    if (unit) {
      normalized.unit = unit;
      fields.push({ key: "unit", value: unit, confidence: 0.45, source_text: text, region });
    }
  }

  return { normalized, fields, confidence: averageConfidence(fields) };
}

export function averageConfidence(fields: ParsedField[]): number {
  if (fields.length === 0) return 0;
  // The identifying fields carry the weight: a confident code and amount matter
  // more than a confident colour.
  const weight = (k: string) => (k === "code" || k === "amount" ? 3 : k === "name" ? 2 : 1);
  const total = fields.reduce((sum, f) => sum + f.confidence * weight(f.key), 0);
  const divisor = fields.reduce((sum, f) => sum + weight(f.key), 0);
  return Math.round((total / divisor) * 1000) / 1000;
}

/** Coerce a spreadsheet cell to the canonical shape for its field. */
export function coerceCell(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (key === "code" || key === "sku") {
    // Codes carry digits or separators. A phrase in the code column is prose
    // (a footnote, a section heading), not an identifier.
    const looksLikeCode = !/\s/.test(text) || /\d/.test(text);
    return looksLikeCode ? text : null;
  }
  if (key === "amount" || key === "min_quantity") {
    const money = parseMoney(text);
    return money ? money.amount : /^\d+(\.\d+)?$/.test(text.replace(/,/g, "")) ? text.replace(/,/g, "") : null;
  }
  if (key === "currency") return text.toUpperCase().replace("RM", "MYR").slice(0, 3);
  if (key === "unit") return parseUnit(text) ?? text.toLowerCase().slice(0, 10);
  if (key === "valid_from") {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return text;
}
