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

/** Translate common Postgres/PostgREST messages into operator-friendly text. */
export function humanizeDbError(message: string): string {
  if (/permission denied/i.test(message)) return "You do not have permission for this action.";
  if (/not authenticated/i.test(message)) return "Your session has expired. Sign in again.";
  if (/reason required/i.test(message)) return message.replace(/^.*?:\s*/, "");
  if (/duplicate key value/i.test(message)) return "A record with the same unique value already exists.";
  if (/violates row-level security/i.test(message)) return "This record is outside your access scope.";
  return message;
}
