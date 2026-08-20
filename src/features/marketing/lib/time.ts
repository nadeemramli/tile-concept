/**
 * Calendar time helpers.
 *
 * Bookings are stored in UTC (timestamptz) and displayed in Asia/Kuala_Lumpur
 * (PRD §10.3). Malaysia has been a fixed UTC+08:00 with no daylight saving
 * since 1982, so constructing an instant from a wall-clock entry is exact —
 * reading a stored instant back goes through Intl so it stays correct even if
 * that ever changes.
 */
export const APP_TZ = "Asia/Kuala_Lumpur";
export const APP_TZ_LABEL = "MYT (UTC+8)";
const KL_OFFSET = "+08:00";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant, as seen in Kuala Lumpur. */
export function zonedParts(iso: string | Date): ZonedParts {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant in Kuala Lumpur — the calendar's day bucket. */
export function dayKey(iso: string | Date): string {
  const p = zonedParts(iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes past local midnight, for positioning inside a time grid. */
export function minutesOfDay(iso: string | Date): number {
  const p = zonedParts(iso);
  return p.hour * 60 + p.minute;
}

/** Instant → value for an `<input type="datetime-local">` showing MYT. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = zonedParts(iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** A wall-clock entry typed in MYT → the UTC instant to store. */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const d = new Date(`${withSeconds}${KL_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "YYYY-MM-DD" (calendar day, no time) → the UTC instant at MYT midnight. */
export function dayStartUtc(day: string): string {
  return new Date(`${day}T00:00:00${KL_OFFSET}`).toISOString();
}

export function dayEndUtc(day: string): string {
  return new Date(`${day}T23:59:59.999${KL_OFFSET}`).toISOString();
}

/** Today in Kuala Lumpur, as "YYYY-MM-DD". */
export function todayKey(): string {
  return dayKey(new Date());
}

/** Add days to a "YYYY-MM-DD" key without tripping over local timezones. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addMonths(day: string, delta: number): string {
  const [y, m] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`;
}

/** Monday of the week containing `day`. */
export function startOfWeek(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function dayLabel(day: string, opts?: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...(opts ?? { weekday: "short", day: "numeric", month: "short" }) }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function monthLabel(day: string): string {
  return dayLabel(day, { month: "long", year: "numeric" });
}

/** "10:00" in MYT. */
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = zonedParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "10:00 – 13:00" in MYT. */
export function timeRangeLabel(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso) return "—";
  return `${timeLabel(startIso)} – ${timeLabel(endIso)}`;
}

/** Every day key from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export interface CalendarRange {
  from: string;
  to: string;
}

/** The day span a view needs, so the server fetches exactly that window. */
export function rangeFor(view: "month" | "week" | "day" | "agenda", anchor: string): CalendarRange {
  switch (view) {
    case "month": {
      const first = startOfWeek(startOfMonth(anchor));
      return { from: first, to: addDays(first, 41) };
    }
    case "week": {
      const first = startOfWeek(anchor);
      return { from: first, to: addDays(first, 6) };
    }
    case "day":
      return { from: anchor, to: anchor };
    case "agenda":
      return { from: anchor, to: addDays(anchor, 29) };
  }
}

export function daysUntil(dateOnly: string | null | undefined): number | null {
  if (!dateOnly) return null;
  const today = todayKey();
  const [ty, tm, td] = today.split("-").map(Number);
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}
