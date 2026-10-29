import * as XLSX from "xlsx";

/**
 * Workbook read options for the walk-in import. `raw` keeps every cell of a
 * text file (CSV) as the text the file holds, and leaving `cellDates` off keeps
 * typed spreadsheet dates as serial numbers, so every date reaches `toIsoDate`
 * as written. Letting the reader build dates instead guesses month-first for
 * ambiguous text (05/10/2026 became 10 May) and builds them in the browser's
 * timezone, which moves the calendar day east of UTC (Kuala Lumpur saw 9 May).
 */
export const WORKBOOK_READ_OPTIONS = { type: "array", raw: true } as const satisfies XLSX.ParsingOptions;

/** UTC timestamp for a calendar day and wall-clock time, or null when the parts are not a real date (31/02 is refused, not rolled into March). */
function calendarIso(year: number, month: number, day: number, hour = 0, minute = 0): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString();
}

/**
 * A cell from the mapped date column as an ISO timestamp. Calendar dates keep
 * the day they name at UTC midnight (a workbook serial keeps its wall-clock
 * time), whatever the browser's timezone. Accepts spreadsheet date serials
 * (also as bare numeric text), day-first text (DD/MM/YYYY, with / . or -,
 * two-digit years as 20YY), ISO dates, and other text the browser can parse.
 * Text with a time of day keeps the instant the browser reads from it, as it
 * always has: its own offset, or the browser's timezone without one.
 */
export function toIsoDate(v: unknown, date1904 = false): string | null {
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v, { date1904 });
    return d ? calendarIso(d.y, d.m, d.d, d.H, d.M) : null;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return toIsoDate(Number(s), date1904);
  const dayFirst = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dayFirst) return calendarIso(dayFirst[3].length === 2 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  // Check an ISO date's own parts first: JavaScript would roll 2026-02-30T14:30Z into March.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[T ])/);
  if (iso) {
    const day = calendarIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!day || s.length === iso[0].length) return day;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  if (/\d:\d{2}/.test(s)) return parsed.toISOString();
  return calendarIso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}
