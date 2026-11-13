import { z } from "zod";
import { uuid } from "@/lib/zod";
import { isValidDate } from "./week";

export const FORECAST_BANDS = ["high", "medium", "low"] as const;
export type ForecastBand = (typeof FORECAST_BANDS)[number];

export const FORECAST_MODES = ["current", "recorded"] as const;
export type ForecastMode = (typeof FORECAST_MODES)[number];

/** `week` is the primary list; the rest are exception queues over all active work. */
export const FORECAST_QUEUES = ["week", "missing_date", "missing_band", "missing_value", "overdue_date", "stale_review", "never_reviewed", "not_recorded"] as const;
export type ForecastQueue = (typeof FORECAST_QUEUES)[number];
export type ExceptionQueue = Exclude<ForecastQueue, "week" | "not_recorded">;

export const STALE_DAY_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_STALE_DAYS = 14;
export const FORECAST_PAGE_SIZE = 50;

/** Where a forecast was captured. Only `review` comes from the review dialog itself. */
export const FORECAST_CONTEXTS = ["review", "create", "quote", "stage"] as const;

const blankToNull = (v: unknown) => (v === "" || v === "__none__" || v === undefined ? null : v);
const dateOrUnknown = z.preprocess(blankToNull, z.string().refine(isValidDate, "Enter a date as YYYY-MM-DD").nullable());
const bandOrUnknown = z.preprocess(blankToNull, z.enum(FORECAST_BANDS).nullable());
const valueOrUnknown = z.preprocess(
  (v) => (v === "" || v === undefined || v === null || (typeof v === "number" && Number.isNaN(v)) ? null : v),
  z.coerce.number().finite().nonnegative("Value cannot be negative").nullable(),
);

/**
 * The review dialog states every field. A blank field is sent as "unknown"
 * (null), never as zero or a default, and the database keeps it unknown.
 */
export const reviewForecastSchema = z.object({
  opportunity_id: uuid(),
  version: z.coerce.number().int().positive(),
  request_id: uuid(),
  expected_close_date: dateOrUnknown,
  probability_band: bandOrUnknown,
  estimated_value: valueOrUnknown,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code"),
  evidence: z.preprocess(blankToNull, z.string().trim().max(2000).nullable()),
  next_action: z.string().trim().min(1, "Enter the next step"),
  next_action_due_at: z.string().min(1, "Enter when the next step is due"),
});
export type ReviewForecastInput = z.infer<typeof reviewForecastSchema>;

/**
 * Optional forecast fields offered while creating an opportunity, issuing a
 * quote or changing stage. Only fields the person filled in are applied; a
 * blank field leaves the current value alone, and none of them is required.
 */
export const forecastCaptureShape = {
  forecast_close_date: z.preprocess((v) => (v === "" ? undefined : v), z.string().refine(isValidDate, "Enter a date as YYYY-MM-DD").optional()),
  forecast_band: z.preprocess((v) => (v === "" || v === "__none__" ? undefined : v), z.enum(FORECAST_BANDS).optional()),
  forecast_evidence: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(2000).optional()),
};
export type ForecastCapture = { forecast_close_date?: string; forecast_band?: ForecastBand; forecast_evidence?: string };

/** The keys a capture states, in the shape `api.review_opportunity_forecast` reads. */
export function captureToReviewInput(c: ForecastCapture): Record<string, string> {
  const out: Record<string, string> = {};
  if (c.forecast_close_date) out.expected_close_date = c.forecast_close_date;
  if (c.forecast_band) out.probability_band = c.forecast_band;
  if (c.forecast_evidence) out.evidence = c.forecast_evidence;
  return out;
}
