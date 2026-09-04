import { maskValue } from "@/lib/format";

/** Asia/Kuala_Lumpur is fixed UTC+8 with no DST, so plain offset math is safe. */
const KL_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

export interface FollowUpOption {
  key: "tomorrow" | "3d" | "1w";
  label: string;
  days: number;
  /** The team default cadence gets the filled button. */
  emphasized?: boolean;
}

export const FOLLOW_UP_OPTIONS: FollowUpOption[] = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "3d", label: "In 3 days", days: 3, emphasized: true },
  { key: "1w", label: "In 1 week", days: 7 },
];

/** 09:00 Asia/Kuala_Lumpur on the day `days` after today (KL), as an ISO string. */
export function followUpDueAt(days: number, from: Date = new Date()): string {
  const klDay = Math.floor((from.getTime() + KL_OFFSET_MS) / DAY_MS) + days;
  return new Date(klDay * DAY_MS + 9 * 3_600_000 - KL_OFFSET_MS).toISOString();
}

/** Task title that never leaks a full phone number and never comes out empty. */
export function followUpTaskTitle(lead: { raw_name: string | null; raw_company: string | null; raw_phone_normalized: string | null }): string {
  const who =
    lead.raw_name?.trim() ||
    lead.raw_company?.trim() ||
    (lead.raw_phone_normalized ? maskValue(lead.raw_phone_normalized, "phone") : null) ||
    "lead";
  return `Follow up with ${who}`;
}
