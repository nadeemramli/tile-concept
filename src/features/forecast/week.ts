/**
 * Forecast weeks run Monday to Sunday on the Kuala Lumpur calendar. Malaysia
 * has no daylight saving, so local dates are UTC+8 throughout. Dates here are
 * plain `YYYY-MM-DD` strings; the database (`api.forecast_window`) applies the
 * same rule and refuses a week that does not start on a Monday.
 */
const KL_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcDate(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

/** Today's date in Kuala Lumpur. */
export function klToday(now: Date = new Date()): string {
  return fromUtcDate(new Date(now.getTime() + KL_OFFSET_MS));
}

export function isValidDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && fromUtcDate(toUtcDate(value)) === value;
}

/** The Monday on or before `date`. */
export function weekStartOf(date: string): string {
  const dow = toUtcDate(date).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function isWeekStart(value: unknown): value is string {
  return isValidDate(value) && weekStartOf(value) === value;
}

export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(klToday(now));
}

export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

export function addWeeks(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7);
}

/** A `?week=` value if it names a Monday, otherwise the current Kuala Lumpur week. */
export function parseWeekParam(value: unknown, now: Date = new Date()): string {
  return isWeekStart(value) ? value : currentWeekStart(now);
}

const MONTH = new Intl.DateTimeFormat("en-MY", { month: "short", timeZone: "UTC" });

/** "2 – 8 Nov 2026", "26 Oct – 1 Nov 2026", "29 Dec 2025 – 4 Jan 2026". */
export function formatWeek(weekStart: string): string {
  const s = toUtcDate(weekStart);
  const e = toUtcDate(weekEndOf(weekStart));
  const day = (d: Date) => d.getUTCDate();
  const month = (d: Date) => MONTH.format(d);
  if (s.getUTCFullYear() !== e.getUTCFullYear()) return `${day(s)} ${month(s)} ${s.getUTCFullYear()} – ${day(e)} ${month(e)} ${e.getUTCFullYear()}`;
  if (s.getUTCMonth() !== e.getUTCMonth()) return `${day(s)} ${month(s)} – ${day(e)} ${month(e)} ${e.getUTCFullYear()}`;
  return `${day(s)} – ${day(e)} ${month(e)} ${e.getUTCFullYear()}`;
}
