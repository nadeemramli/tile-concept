import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

export const APP_TZ = "Asia/Kuala_Lumpur";

export function formatMoney(amount: number | string | null | undefined, currency = "MYR") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-MY", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function formatNumber(n: number | string | null | undefined, digits = 0) {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: digits }).format(v);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

export function formatDate(value: string | Date | null | undefined, pattern = "d MMM yyyy") {
  const d = toDate(value);
  return d ? format(d, pattern) : "—";
}

export function formatDateTime(value: string | Date | null | undefined) {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TZ }).format(d);
}

export function formatRelative(value: string | Date | null | undefined) {
  const d = toDate(value);
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const s = formatDistanceToNowStrict(d, { addSuffix: false });
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

export function isOverdue(value: string | null | undefined) {
  const d = toDate(value);
  return !!d && d.getTime() < Date.now();
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function titleCase(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mask phone/email for list views (PRD §6.2). */
export function maskValue(value: string | null | undefined, kind: "phone" | "email" | string) {
  if (!value) return "—";
  if (kind === "phone" || kind === "whatsapp") return value.replace(/^(\+?\d{2,3})\d+(\d{3})$/, "$1•••$2");
  if (kind === "email") return value.replace(/^(.).*(@.*)$/, "$1•••$2");
  return "•••";
}
