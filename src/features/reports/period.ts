import { formatDate } from "@/lib/format";
import type { ReportGrain } from "@/features/reports/registry";

/**
 * A period bucket from its first day, last day and grain: "Mon, 9 Mar 2026",
 * "9 – 15 Mar 2026", "Mar 2026". Without a grain the start date is shown alone.
 */
export function formatPeriod(start: string, end: unknown, grain?: ReportGrain): string {
  if (grain === "month") return formatDate(start, "MMM yyyy");
  if (grain === "week") {
    const last = typeof end === "string" ? end : null;
    if (!last) return `Week of ${formatDate(start)}`;
    const sameMonth = start.slice(0, 7) === last.slice(0, 7);
    return `${formatDate(start, sameMonth ? "d" : "d MMM")} – ${formatDate(last, "d MMM yyyy")}`;
  }
  if (grain === "day") return formatDate(start, "EEE, d MMM yyyy");
  return formatDate(start);
}
