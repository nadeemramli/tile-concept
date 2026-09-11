import { PERMISSION_EXPLAINERS, PERMISSIONS, type PermissionKey } from "@/lib/rbac/matrix";

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail<T = undefined>(error: unknown, fieldErrors?: Record<string, string[]>): ActionResult<T> {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Something went wrong";
  return { ok: false, error: humanizeDbError(message), fieldErrors };
}

const PERMISSION_KEY = new Set<string>(PERMISSIONS);

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const cased = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

/**
 * Translate Postgres/PostgREST messages into operator-friendly text. The
 * database is the authority on refusals, so the detail it raises is kept:
 * a role gate names the role that can, and a customer-media-permission gate
 * says whose permission and where to record it.
 */
export function humanizeDbError(message: string): string {
  const denied = /permission denied:?\s*(.*)$/i.exec(message);
  if (denied) {
    const detail = denied[1]?.trim() ?? "";
    if (PERMISSION_KEY.has(detail)) return PERMISSION_EXPLAINERS[detail as PermissionKey];
    if (/not the owner/i.test(detail)) return "Only the owner of this record, or a sales manager, can change it.";
    const embedded = detail.match(/\b([a-z]+\.[a-z_]+)\b/g)?.find((k) => PERMISSION_KEY.has(k)) as PermissionKey | undefined;
    if (embedded) return `${sentence(detail)} ${PERMISSION_EXPLAINERS[embedded]}`;
    return detail ? sentence(detail) : "Your role does not include this action.";
  }
  if (/workspace access denied/i.test(message)) return "This record belongs to a workspace your membership does not cover.";
  if (/customer media permission/i.test(message)) return `${sentence(message)} Record the customer's media permission on the nomination in Content Opportunities.`;
  if (/not authenticated/i.test(message)) return "Your session has expired. Sign in again.";
  if (/reason required/i.test(message)) return sentence(message.replace(/^.*?:\s*/, ""));
  if (/duplicate key value/i.test(message)) return "A record with the same unique value already exists.";
  if (/violates row-level security/i.test(message)) return "This record is outside your access scope.";
  return message;
}
