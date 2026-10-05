/**
 * TikTok Ads Manager trend report → one daily total per date.
 *
 * The report lists campaign Spend per day. Each date's campaigns are summed
 * into one TikTok / Platform daily total / Platform advertising entry; dates
 * whose spend sums to zero are excluded and listed. Amounts are kept in
 * integer sen so nothing is lost to floating point.
 *
 * Nothing is defaulted into existence:
 * - Currency must be stated by the report (a Currency column, a "(MYR)"
 *   header suffix or a "Currency: MYR" line above the table). If the report
 *   says nothing, the operator must declare MYR explicitly, and the batch
 *   records that the currency was declared rather than stated. A non-MYR
 *   report is refused: nothing is converted.
 * - The report carries no tax, so tax is imported as unreported, never zero.
 *
 * Pure apart from hashing: no database, no React, relative imports only, so
 * the server actions, the MCP server and the unit tests share one parser.
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";

export const TIKTOK_TREND_FORMAT = "tiktok_trend_report" as const;
export const TIKTOK_TREND_PARSER_VERSION = "tiktok-trend/1";
export const TIKTOK_VENDOR = "TikTok";
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

export type Cell = string | number | boolean | null | undefined;

export interface CampaignSpend {
  name: string;
  campaign_id: string | null;
  spend: number;
  rows: number[];
}

export interface DailyEntry {
  incurred_on: string;
  cents: number;
  before_tax: number;
  campaigns: CampaignSpend[];
  source_rows: number[];
}

export interface TikTokTrendParse {
  format: typeof TIKTOK_TREND_FORMAT;
  parserVersion: string;
  sourceName: string;
  sha256: string;
  sheet: string | null;
  /** 1-based row number of the header in the source sheet. */
  headerRow: number | null;
  columns: Partial<Record<ColumnKey, string>>;
  statedCurrency: string | null;
  currency: "MYR" | null;
  currencyBasis: "report_stated" | "operator_declared" | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Data rows read (zero and blank spend included; total rows excluded). */
  sourceRowCount: number;
  campaignCount: number;
  entries: DailyEntry[];
  excludedZeroDates: string[];
  /** Rows whose spend cell was blank or "-": nothing was reported for them. */
  blankSpendRows: number[];
  reportTotal: number | null;
  totals: { entryCount: number; cents: number; beforeTax: number };
  errors: string[];
  warnings: string[];
}

export interface ParseOptions {
  /** Only used when the report itself does not state a currency. */
  declaredCurrency?: "MYR";
  sheet?: string;
}

type ColumnKey = "date" | "spend" | "campaign" | "campaignId" | "adGroup" | "ad" | "currency";

const HEADERS: Record<ColumnKey, RegExp> = {
  date: /^(date|day|by day|stat[ _]time(?:[ _]day)?|time|report(?:ing)? date)$/,
  spend: /^(spend|cost|total cost|total spend|amount spent|spend amount)$/,
  campaign: /^(campaign name|campaign)$/,
  campaignId: /^(campaign id)$/,
  adGroup: /^(ad group name|ad group)$/,
  ad: /^(ad name|ad)$/,
  currency: /^currency$/,
};

const CURRENCY_IN_HEADER = /\(\s*([A-Za-z]{2,3})\s*\)\s*$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const clean = (v: Cell): string => String(v ?? "").replace(/^﻿/, "").replace(/\s+/g, " ").trim();
const normHeader = (v: Cell): string => clean(v).replace(CURRENCY_IN_HEADER, "").trim().toLowerCase();
const currencyCode = (raw: string): string => (raw.toUpperCase() === "RM" ? "MYR" : raw.toUpperCase());

export const formatCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

/** Parse a money cell into integer sen. `null` = blank/"-"; `"invalid"` = not a valid amount. */
export function moneyCents(v: Cell): number | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "invalid";
    const cents = Math.round(v * 100);
    return Math.abs(v * 100 - cents) < 1e-6 ? cents : "invalid";
  }
  if (typeof v === "boolean") return "invalid";
  const s = clean(v).replace(/^(MYR|RM)\s*/i, "").replace(/\s*(MYR|RM)$/i, "").replace(/\s/g, "");
  if (s === "" || s === "-" || s === "--") return null;
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return "invalid";
  const whole = Number(m[2].replace(/,/g, ""));
  const cents = whole * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return "invalid";
  return m[1] ? -cents : cents;
}

const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Report dates. Year-first (2026-08-10, 2026/08/10, optional time) and
 * month-name (Aug 10, 2026 / 10 Aug 2026) forms are unambiguous; an Excel
 * serial arrives as a number from a date-formatted cell. Day/month-first
 * numeric dates (10/08/2026) are refused: they read differently by locale.
 */
export function reportDate(v: Cell, isDateCell = false): string | null {
  if (typeof v === "number") {
    if (!isDateCell || !Number.isFinite(v) || v < 30000 || v > 80000) return null;
    const p = XLSX.SSF.parse_date_code(v);
    return p ? iso(p.y, p.m, p.d) : null;
  }
  const s = clean(v);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?.*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.?,? (\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  return null;
}

interface Sheet {
  name: string | null;
  rows: Cell[][];
  /** "r,c" of numeric cells whose number format is a date. */
  dateCells: Set<string>;
}

export function readSheets(bytes: Uint8Array, fileName: string): Sheet[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: lower.endsWith(".tsv") ? "\t" : "" });
    return [{ name: null, rows: (parsed.data ?? []).map((r) => (Array.isArray(r) ? r : [])), dateCells: new Set() }];
  }
  // Stored values only; formulas are not evaluated and dates stay serials so
  // no time zone can move them.
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellNF: true, cellText: false });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    const rows: Cell[][] = [];
    const dateCells = new Set<string>();
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: Cell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (cell?.t === "n" && typeof cell.z === "string" && XLSX.SSF.is_date(cell.z)) dateCells.add(`${r - range.s.r},${c - range.s.c}`);
        row.push(cell?.t === "d" ? null : (cell?.v as Cell));
      }
      rows.push(row);
    }
    return { name, rows, dateCells };
  });
}

function findHeader(rows: Cell[][]): { index: number; columns: Map<ColumnKey, number>; duplicates: ColumnKey[] } | null {
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const columns = new Map<ColumnKey, number>();
    const duplicates: ColumnKey[] = [];
    rows[r].forEach((cell, c) => {
      const h = normHeader(cell);
      for (const [key, re] of Object.entries(HEADERS) as [ColumnKey, RegExp][]) {
        if (!re.test(h)) continue;
        if (columns.has(key)) duplicates.push(key);
        else columns.set(key, c);
      }
    });
    if (columns.has("date") && columns.has("spend")) return { index: r, columns, duplicates };
  }
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "row 7" / "rows 2, 3 and 4 more" */
const onRows = (rows: number[], max = 8) => `${rows.length === 1 ? "row" : "rows"} ${rows.slice(0, max).join(", ")}${rows.length > max ? ` and ${rows.length - max} more` : ""}`;

export async function parseTikTokTrendReport(bytes: Uint8Array, sourceName: string, options: ParseOptions = {}): Promise<TikTokTrendParse> {
  const result: TikTokTrendParse = {
    format: TIKTOK_TREND_FORMAT, parserVersion: TIKTOK_TREND_PARSER_VERSION, sourceName: clean(sourceName).slice(0, 255), sha256: await sha256Hex(bytes),
    sheet: null, headerRow: null, columns: {}, statedCurrency: null, currency: null, currencyBasis: null, dateFrom: null, dateTo: null,
    sourceRowCount: 0, campaignCount: 0, entries: [], excludedZeroDates: [], blankSpendRows: [], reportTotal: null,
    totals: { entryCount: 0, cents: 0, beforeTax: 0 }, errors: [], warnings: [],
  };
  const { errors, warnings } = result;
  if (!result.sourceName) errors.push("Name the source file.");
  if (bytes.byteLength === 0) { errors.push("The file is empty."); return result; }
  if (bytes.byteLength > MAX_REPORT_BYTES) { errors.push("The file is larger than 5 MB; export a shorter date range."); return result; }

  let sheets: Sheet[];
  try { sheets = readSheets(bytes, sourceName); } catch { errors.push("The file could not be read as a CSV or Excel workbook."); return result; }
  // TikTok names the export's data sheet "Trend"; look there first.
  if (options.sheet) sheets = sheets.filter((s) => s.name === options.sheet);
  else sheets = [...sheets.filter((s) => s.name?.toLowerCase() === "trend"), ...sheets.filter((s) => s.name?.toLowerCase() !== "trend")];
  const found = sheets.map((s) => ({ sheet: s, header: findHeader(s.rows) })).find((x) => x.header);
  if (!found?.header) {
    errors.push("No header row with a date column (Date / By Day) and a Spend (or Cost) column was found.");
    return result;
  }
  const { sheet, header } = found;
  result.sheet = sheet.name;
  result.headerRow = header.index + 1;
  for (const [key, c] of header.columns) result.columns[key] = clean(sheet.rows[header.index][c]);
  if (header.duplicates.includes("spend")) errors.push("The report has more than one Spend/Cost column; export it with a single spend column.");
  if (header.duplicates.includes("date")) errors.push("The report has more than one date column.");
  if (!header.columns.has("campaign")) warnings.push("The report has no Campaign name column; each row is treated as one line of spend.");

  // Currency: header suffix, metadata lines above the table, or a Currency column.
  const stated = new Set<string>();
  const spendHeader = clean(sheet.rows[header.index][header.columns.get("spend")!]);
  const suffix = CURRENCY_IN_HEADER.exec(spendHeader);
  if (suffix) stated.add(currencyCode(suffix[1]));
  let reportRange: [string, string] | null = null;
  for (const row of sheet.rows.slice(0, header.index)) {
    const line = row.map(clean).filter(Boolean).join(" ");
    const cur = /currency\W+([A-Za-z]{2,3})\b/i.exec(line);
    if (cur) stated.add(currencyCode(cur[1]));
    const range = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(?:~|to|–|—|-)\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i.exec(line);
    const a = range && reportDate(range[1]); const b = range && reportDate(range[2]);
    if (a && b) reportRange = a <= b ? [a, b] : [b, a];
  }

  const col = (row: Cell[], key: ColumnKey) => (header.columns.has(key) ? row[header.columns.get(key)!] : undefined);
  const seen = new Map<string, number>();
  const byDate = new Map<string, Map<string, CampaignSpend>>();
  const campaigns = new Set<string>();
  const badDates: number[] = []; const badSpend: number[] = []; const negative: number[] = []; const dupes: string[] = [];
  let totalRowCents: number[] = [];
  let lossyIds = false;
  const allDates = new Set<string>();

  // TikTok ends the export with a summary row: "-" in every dimension column
  // (By Day, Campaign ID, Campaign name, Currency) and the report's totals.
  // Only the last row may be read that way; a dashed row anywhere else is an
  // undated data row and stays an error.
  const placeholder = (v: Cell) => { const t = clean(v); return t === "" || t === "-" || t === "--"; };
  let lastRow = -1;
  for (let r = sheet.rows.length - 1; r > header.index; r--) if (sheet.rows[r].some((c) => clean(c) !== "")) { lastRow = r; break; }

  for (let r = header.index + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const rowNo = r + 1;
    if (!row.some((c) => clean(c) !== "")) continue;
    const dateRaw = col(row, "date");
    const campaignRaw = clean(col(row, "campaign"));
    const spend = moneyCents(col(row, "spend"));
    const summaryRow = r === lastRow && (["date", "campaign", "campaignId", "adGroup", "ad"] as ColumnKey[]).every((k) => placeholder(col(row, k)));
    if (summaryRow || /^total\b/i.test(clean(dateRaw)) || /^total\b/i.test(campaignRaw) || (clean(dateRaw) === "" && /\btotal\b/i.test(campaignRaw))) {
      if (typeof spend === "number") totalRowCents = [...totalRowCents, spend];
      continue;
    }
    result.sourceRowCount++;
    const day = reportDate(dateRaw, sheet.dateCells.has(`${r},${header.columns.get("date")}`));
    if (!day) { badDates.push(rowNo); continue; }
    allDates.add(day);
    const rowCurrency = clean(col(row, "currency"));
    if (rowCurrency) stated.add(currencyCode(rowCurrency));
    if (spend === "invalid") { badSpend.push(rowNo); continue; }
    if (spend === null) { result.blankSpendRows.push(rowNo); continue; }
    if (spend < 0) { negative.push(rowNo); continue; }
    const name = campaignRaw || "All campaigns (report row)";
    const idCell = col(row, "campaignId");
    // TikTok campaign IDs have 19 digits; stored as an Excel number they lose
    // precision, so two campaigns could share a rounded ID. ID and name
    // together tell campaigns apart, and the loss is reported.
    if (typeof idCell === "number" && !Number.isSafeInteger(idCell)) lossyIds = true;
    const campaignId = typeof idCell === "number" ? idCell.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 }) : clean(idCell) || null;
    const campaignKey = `${campaignId ?? ""}\u0000${name.toLowerCase()}`;
    const key = [day, campaignKey, clean(col(row, "adGroup")).toLowerCase(), clean(col(row, "ad")).toLowerCase()].join("\u0000");
    if (seen.has(key)) { dupes.push(`${seen.get(key)} and ${rowNo}`); continue; }
    seen.set(key, rowNo);
    campaigns.add(campaignKey);
    const day_ = byDate.get(day) ?? new Map<string, CampaignSpend>();
    const c = day_.get(campaignKey) ?? { name, campaign_id: campaignId, spend: 0, rows: [] };
    c.spend += spend; // sen while aggregating
    c.rows.push(rowNo);
    day_.set(campaignKey, c);
    byDate.set(day, day_);
  }

  if (badDates.length) errors.push(`No readable date on ${onRows(badDates)}. Use year-first dates (2026-08-10) or month names; 10/08/2026 is ambiguous.`);
  if (badSpend.length) errors.push(`The spend on ${onRows(badSpend)} is not a MYR amount with at most two decimals.`);
  if (negative.length) errors.push(`Negative spend on ${onRows(negative)}; record credits separately.`);
  if (dupes.length) errors.push(`The same campaign appears twice on one date (rows ${dupes.slice(0, 5).join("; ")}${dupes.length > 5 ? "; …" : ""}); summing would double count it.`);
  if (lossyIds) warnings.push("Campaign IDs are stored as numbers and have lost precision past 15 digits; campaigns are told apart by ID and name together.");
  if (result.blankSpendRows.length) warnings.push(`No spend reported ("-" or blank) on ${onRows(result.blankSpendRows)}; left out.`);

  if (stated.size > 1) errors.push(`The report states more than one currency (${[...stated].join(", ")}).`);
  else if (stated.size === 1) {
    result.statedCurrency = [...stated][0];
    if (result.statedCurrency === "MYR") { result.currency = "MYR"; result.currencyBasis = "report_stated"; }
    else errors.push(`The report is in ${result.statedCurrency}. Only MYR amounts can be imported; nothing is converted.`);
  } else if (options.declaredCurrency === "MYR") {
    result.currency = "MYR"; result.currencyBasis = "operator_declared";
    warnings.push("The report does not state its currency; MYR was declared by the operator and is recorded as declared.");
  } else {
    errors.push("The report does not state its currency. Confirm the amounts are MYR (declare the currency) or export the report with a currency column.");
  }

  for (const [day, map] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    const cents = list.reduce((s, c) => s + c.spend, 0);
    if (cents === 0) { result.excludedZeroDates.push(day); continue; }
    // The export lists every campaign on every day. A date's campaigns are the
    // ones that spent; the zero rows stay in its source rows as provenance.
    result.entries.push({
      incurred_on: day, cents, before_tax: cents / 100,
      campaigns: list.filter((c) => c.spend > 0).map((c) => ({ ...c, spend: c.spend / 100 })),
      source_rows: list.flatMap((c) => c.rows).sort((a, b) => a - b),
    });
  }
  // A date whose every row was blank/"-" is also a no-spend date.
  for (const day of allDates) if (!byDate.has(day)) result.excludedZeroDates.push(day);
  result.excludedZeroDates.sort();

  result.campaignCount = campaigns.size;
  const cents = result.entries.reduce((s, e) => s + e.cents, 0);
  result.totals = { entryCount: result.entries.length, cents, beforeTax: cents / 100 };
  const dates = [...allDates].sort();
  result.dateFrom = reportRange?.[0] ?? dates[0] ?? null;
  result.dateTo = reportRange?.[1] ?? dates[dates.length - 1] ?? null;
  if (reportRange && dates.length && (dates[0] < reportRange[0] || dates[dates.length - 1] > reportRange[1])) {
    errors.push(`Rows fall outside the report's stated range ${reportRange[0]} – ${reportRange[1]}.`);
  }
  if (totalRowCents.length) {
    result.reportTotal = totalRowCents[0] / 100;
    if (totalRowCents.some((t) => t !== cents) && !badSpend.length && !badDates.length && !negative.length && !dupes.length) {
      errors.push(`The report's total row says MYR ${formatCents(totalRowCents[0])}, but its dated rows sum to MYR ${formatCents(cents)}.`);
    }
  }
  if (!result.entries.length && !errors.length) errors.push("The report has no date with spend above zero.");
  return result;
}

export interface Expectation {
  entryCount?: number;
  total?: number | string;
}

/** Compare a parse with figures the operator expects (e.g. 46 dates, MYR 3,269.40). */
export function reconcile(parse: Pick<TikTokTrendParse, "totals">, expected: Expectation = {}): string[] {
  const issues: string[] = [];
  if (expected.entryCount !== undefined && expected.entryCount !== parse.totals.entryCount) {
    issues.push(`Expected ${expected.entryCount} dates with spend; the report has ${parse.totals.entryCount}.`);
  }
  if (expected.total !== undefined) {
    const cents = moneyCents(typeof expected.total === "string" ? expected.total : expected.total);
    if (typeof cents !== "number") issues.push("The expected total is not a valid MYR amount.");
    else if (cents !== parse.totals.cents) issues.push(`Expected MYR ${formatCents(cents)}; the report totals MYR ${formatCents(parse.totals.cents)}.`);
  }
  return issues;
}

/** The payload `api.preview_marketing_spend_batch` / `api.import_marketing_spend_batch` take. */
export function toBatchPayload(parse: TikTokTrendParse, vendor: string = TIKTOK_VENDOR) {
  return {
    source: {
      format: parse.format, name: parse.sourceName, sha256: parse.sha256, parser_version: parse.parserVersion,
      row_count: parse.sourceRowCount, campaign_count: parse.campaignCount, date_from: parse.dateFrom, date_to: parse.dateTo,
    },
    currency: parse.currency,
    currency_basis: parse.currencyBasis,
    tax_status: "unreported" as const,
    mapping: { platform: "tiktok" as const, entry_mode: "daily_total" as const, category: "platform_ads" as const, vendor },
    entries: parse.entries.map((e) => ({
      incurred_on: e.incurred_on, before_tax: e.before_tax, source_rows: e.source_rows,
      campaigns: e.campaigns.map((c) => ({ name: c.name, campaign_id: c.campaign_id, spend: c.spend, rows: c.rows })),
    })),
    excluded_zero_dates: parse.excludedZeroDates,
    totals: { entry_count: parse.totals.entryCount, before_tax: parse.totals.beforeTax },
  };
}
export type BatchPayload = ReturnType<typeof toBatchPayload>;
