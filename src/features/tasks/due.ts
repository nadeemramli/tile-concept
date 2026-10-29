import { useEffect, useState } from "react";
import { formatDistanceStrict, isValid, parseISO } from "date-fns";

/**
 * The Due cell's relative label and overdue test, measured from an explicit
 * reference time instead of `Date.now()`. Wording matches `formatRelative`
 * ("just now", "3 minutes ago", "in 2 days"), and overdue matches `isOverdue`
 * (due strictly before the reference time).
 */
function toTime(dueAt: string): number | null {
  const d = parseISO(dueAt);
  return isValid(d) ? d.getTime() : null;
}

export function dueLabel(dueAt: string, now: number): string {
  const due = toTime(dueAt);
  if (due === null) return "—";
  const diff = due - now;
  if (Math.abs(diff) < 45_000) return "just now";
  const s = formatDistanceStrict(due, now, { addSuffix: false });
  return diff < 0 ? `${s} ago` : `in ${s}`;
}

export function isDuePast(dueAt: string, now: number): boolean {
  const due = toTime(dueAt);
  return due !== null && due < now;
}

/**
 * The reference time for Due labels. It is the server's request time until
 * mount, so the server HTML and the hydration pass produce the same text and
 * overdue styling; after mount it follows the browser clock, refreshed every
 * 30 seconds.
 */
export function useDueClock(renderedAt: string): number {
  const [now, setNow] = useState(() => Date.parse(renderedAt));
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
