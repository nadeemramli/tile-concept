/**
 * OCR lines → staged catalogue proposals (PRD §7.8, §12.5).
 *
 * A scanned catalogue is read as entries: a line carrying a product code
 * starts one, and the lines beneath it (size, finish, price…) belong to it
 * until the next code or a visible gap. Every field keeps the exact OCR line it
 * came from, that line's pixel box on the page image and the engine's own
 * confidence, so a reviewer compares the proposal with the scan rather than
 * trusting it. Nothing here publishes; a page that cannot be read becomes a
 * manual-entry item, never an empty result.
 */
import { averageConfidence, extractCode, extractColour, extractFinish, extractMaterial, parseDimensions, parseMoney, parseUnit } from "../parsers/mapper";
import type { FieldRegion, ParsedField, ParsedIssue, ParsedRecord } from "../parsers/types";
import { unionBox, type OcrLine, type OcrPage } from "./tsv";

/** Below this mean word confidence a page is treated as unreadable. */
export const UNREADABLE_PAGE_CONF = 45;
/** A line read below this is called out even when its fields parse. */
export const LOW_LINE_CONF = 80;
/** No single word below this, or a digit may be wrong. */
export const LOW_WORD_CONF = 60;
const MAX_ENTRY_LINES = 8;

export const OCR_MANUAL_DETAIL = (page: number, why: string) =>
  `OCR could not propose rows for page ${page}: ${why}. Enter this page's rows by hand from the original — nothing was guessed.`;

const CURRENCY_RE = /(RM|MYR|SGD|USD|\$)\s*\d/i;
const PRICE_LABEL_RE = /\bprice\b|\bharga\b/i;
const NAME_LABEL_RE = /^\s*(name|description|desc|product)\s*[:.-]\s*/i;
const LABEL_RE = /\b(code|item|art(icle)?\s*no|size|dimension|finish|surface|colou?r|material|body|price|harga)\s*[:.]/gi;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The engine's view of a line, scaled to 0-1 and capped by its weakest word. */
function lineFactor(line: OcrLine): number {
  const mean = line.conf / 100;
  const weakest = line.minConf / 100;
  return Math.max(0, Math.min(1, Math.min(mean, (mean + weakest) / 2)));
}

function regionFor(line: OcrLine, pageNo: number, page: OcrPage): FieldRegion & Record<string, number> {
  return { page: pageNo, line: line.index, x: line.x, y: line.y, w: line.w, h: line.h, page_w: page.width, page_h: page.height, ocr_conf: line.conf, ocr_min_conf: line.minConf };
}

/** Group lines into entries; returns the lines before the first code too. */
export function groupEntries(page: OcrPage): { preamble: OcrLine[]; entries: OcrLine[][] } {
  const lineHeight = median(page.lines.map((l) => l.h)) || 20;
  const preamble: OcrLine[] = [];
  const entries: OcrLine[][] = [];
  let current: OcrLine[] | null = null;

  for (const line of page.lines) {
    if (extractCode(line.text)) {
      current = [line];
      entries.push(current);
      continue;
    }
    if (!current) {
      preamble.push(line);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = line.y - (prev.y + prev.h);
    // A gap of more than about two lines, or a long run, ends the entry: what
    // follows is a new section, not more of this product.
    if (gap > lineHeight * 2.2 || current.length >= MAX_ENTRY_LINES) {
      current = null;
      continue;
    }
    current.push(line);
  }
  return { preamble, entries };
}

function moneyText(text: string): string {
  // Read money from the currency marker or the price label onward, so digits
  // in a code or a size on the same line are never taken for a price.
  const cur = CURRENCY_RE.exec(text);
  if (cur) return text.slice(cur.index);
  const label = PRICE_LABEL_RE.exec(text);
  return label ? text.slice(label.index + label[0].length) : "";
}

function buildEntry(lines: OcrLine[], pageNo: number, page: OcrPage, rowNo: number, engine: string): ParsedRecord {
  const fields: ParsedField[] = [];
  const normalized: Record<string, unknown> = {};
  const put = (key: string, value: string, base: number, line: OcrLine) => {
    normalized[key] = value;
    fields.push({ key, value, confidence: round3(base * lineFactor(line)), source_text: line.text, region: regionFor(line, pageNo, page) });
  };

  const head = lines[0];
  const code = extractCode(head.text)!;
  put("code", code, 0.85, head);

  const priceLine = lines.find((l) => CURRENCY_RE.test(l.text) || PRICE_LABEL_RE.test(l.text));
  let suspectAmount: string | null = null;
  if (priceLine) {
    const text = moneyText(priceLine.text);
    const money = parseMoney(text);
    if (money) {
      // "32:50" or "32,50" is almost always a misread decimal point. Propose
      // what was read, with low confidence, and say so — never repair it.
      const misread = new RegExp(`${money.amount.replace(".", "\\.")}\\s*[:;,']\\s*\\d{2}\\b`).exec(text);
      if (misread && !money.amount.includes(".")) suspectAmount = misread[0];
      put("amount", money.amount, suspectAmount ? 0.3 : 0.8, priceLine);
      if (money.currency) put("currency", money.currency, 0.9, priceLine);
      const unit = money.unit ?? parseUnit(priceLine.text.slice(priceLine.text.search(/\d/)));
      if (unit) put("unit", unit, money.unit ? 0.7 : 0.55, priceLine);
      normalized.source_page_or_row = `page ${pageNo}, line ${priceLine.index + 1}`;
    }
  }

  const dimLine = lines.find((l) => parseDimensions(l.text.replace(code, " ")));
  if (dimLine) {
    const dims = parseDimensions(dimLine.text.replace(code, " "))!;
    normalized.dimensions = dims;
    fields.push({
      key: "dimensions",
      value: Object.entries(dims).map(([k, v]) => `${k}=${v}`).join(" "),
      confidence: round3(0.7 * lineFactor(dimLine)),
      source_text: dimLine.text,
      region: regionFor(dimLine, pageNo, page),
    });
  }

  for (const [key, pick, base] of [
    ["color", extractColour, 0.6],
    ["finish", extractFinish, 0.6],
    ["material", extractMaterial, 0.55],
  ] as const) {
    const line = lines.find((l) => pick(l.text));
    if (line) put(key, pick(line.text)!, base, line);
  }

  const labelled = lines.find((l) => NAME_LABEL_RE.test(l.text));
  const nameText = labelled
    ? labelled.text.replace(NAME_LABEL_RE, "")
    : head.text.replace(code, " ").replace(LABEL_RE, " ").replace(/\b\d{2,4}\s*[x×]\s*\d{2,4}(\s*[x×]\s*\d+(\.\d+)?)?\s*(mm|cm)?/gi, " ");
  const name = nameText.replace(/\s{2,}/g, " ").replace(/^[\s.,;:|-]+|[\s.,;:|-]+$/g, "").trim();
  if (/[a-z]{3,}/i.test(name)) put("name", name.slice(0, 90), labelled ? 0.7 : 0.45, labelled ?? head);

  const issues: ParsedIssue[] = [];
  const weakest = lines.reduce((w, l) => Math.min(w, l.minConf), 100);
  const meanLine = Math.round(lines.reduce((s, l) => s + l.conf, 0) / lines.length);
  if (fields.some((f) => f.confidence < 0.8) || meanLine < LOW_LINE_CONF || weakest < LOW_WORD_CONF) {
    issues.push({
      code: "low_confidence",
      detail: `Read by OCR from a scanned page (mean line confidence ${meanLine}%, weakest word ${Math.round(weakest)}%). Compare every field with the highlighted region before approving.`,
    });
  }
  if (suspectAmount) {
    issues.push({ code: "low_confidence", detail: `The price reads as "${suspectAmount}" — the decimal point was probably misread. The proposal keeps only "${String(normalized.amount)}"; check the page.` });
  }
  if (!normalized.amount) issues.push({ code: "missing_amount", detail: "No price was read for this entry. Add one, or approve it as a product only." });

  return {
    row_no: rowNo,
    page_no: pageNo,
    raw: {
      page: pageNo,
      engine,
      lines: lines.map((l) => l.text).join("\n"),
      line_confidence: lines.map((l) => l.conf),
      box: unionBox(lines),
    },
    normalized,
    confidence: averageConfidence(fields),
    item_type: normalized.amount ? "price" : "product",
    issues,
    fields,
  };
}

export function manualRecord(pageNo: number, rowNo: number, why: string, raw: Record<string, unknown> = {}): ParsedRecord {
  return {
    row_no: rowNo,
    page_no: pageNo,
    raw: { page: pageNo, ...raw },
    normalized: {},
    confidence: 0,
    item_type: "product",
    issues: [{ code: "needs_manual", detail: OCR_MANUAL_DETAIL(pageNo, why) }],
    fields: [],
  };
}

/**
 * One page's proposals. An unreadable page, or a readable one with no product
 * codes, yields a single manual-entry record that says why.
 */
export function buildOcrRecords(page: OcrPage, pageNo: number, startRowNo: number, engine: string): ParsedRecord[] {
  if (page.wordCount === 0) return [manualRecord(pageNo, startRowNo, "no text was recognised on the scan", { engine })];
  if (page.meanConf < UNREADABLE_PAGE_CONF) {
    return [manualRecord(pageNo, startRowNo, `the scan is too poor to read reliably (mean confidence ${Math.round(page.meanConf)}%)`, { engine, mean_confidence: page.meanConf })];
  }
  const { entries } = groupEntries(page);
  if (entries.length === 0) {
    return [manualRecord(pageNo, startRowNo, `${page.wordCount} words were read but no product code was found`, { engine, mean_confidence: page.meanConf })];
  }
  return entries.map((lines, i) => buildEntry(lines, pageNo, page, startRowNo + i, engine));
}
