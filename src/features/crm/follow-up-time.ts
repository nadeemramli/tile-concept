import { useEffect, useState } from "react";
import { formatDistanceStrict, isValid, parseISO } from "date-fns";

/**
 * The Projects list's relative follow-up times ("Next follow-up" due and
 * "Last followed up"), measured from an explicit reference time instead of
 * `Date.now()`. Wording matches `formatRelative` ("just now", "51 seconds
 * ago", "in 3 hours"), including "—" for a missing or unparseable value.
 */
export function followUpRelative(value: string | null | undefined, now: number): string {
  const d = value ? parseISO(value) : null;
  if (!d || !isValid(d)) return "—";
  const diff = d.getTime() - now;
  if (Math.abs(diff) < 45_000) return "just now";
  const s = formatDistanceStrict(d, now, { addSuffix: false });
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

/**
 * The reference time for those labels. It is the server's request time until
 * mount, so the server HTML and the hydration pass produce the same text;
 * after mount it follows the browser clock, refreshed every 30 seconds.
 */
export function useFollowUpClock(renderedAt: string): number {
  const [now, setNow] = useState(() => {
    const t = Date.parse(renderedAt);
    return Number.isFinite(t) ? t : Date.now();
  });
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, []);
  return now;
}
