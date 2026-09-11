import type { LeadView } from "@/features/inbox/schema";

/**
 * Where a lead lives in the Inquiry Inbox. The inbox is a set of saved views,
 * and a lead's status decides its home view; ownership, the first-response
 * clock and reminders decide which other views also list it. Used by the
 * drawer, the response toast and the "moved out of this view" notice so all
 * three say the same thing.
 */

export const VIEW_LABELS: Record<LeadView, string> = {
  new: "New",
  waiting: "Waiting for reply",
  contacted: "Contacted",
  unassigned: "Unassigned",
  mine: "My leads",
  "no-response": "No response",
  "follow-up": "SLA overdue",
  "follow-ups-due": "Follow-ups due",
  duplicates: "Duplicate review",
  qualified: "Qualified",
  disqualified: "Disqualified",
  all: "All",
  aging: "Aging",
};

export interface LeadLocation {
  status: string;
  owner_id: string | null;
  source_channel: string;
  first_response_at: string | null;
  first_response_due_at: string | null;
  next_follow_up_at: string | null;
  duplicate_of_lead_id: string | null;
  created_at: string;
}

export interface Whereabouts {
  /** The view that lists this lead because of its status. */
  home: LeadView;
  /** Other views that also list it right now. */
  also: LeadView[];
}

const ACTIVE = new Set(["new", "contact_attempted", "contacted"]);

/** 23:59:59 in Kuala Lumpur (UTC+8, no daylight saving) for the day containing `now`. */
function endOfTodayKl(now: Date): Date {
  const kl = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${kl}T15:59:59.999Z`);
}

export function whereIsLead(lead: LeadLocation, userId: string, now: Date = new Date()): Whereabouts {
  const walkIn = lead.source_channel === "walk_in";
  let home: LeadView;
  switch (lead.status) {
    case "new":
      home = "new";
      break;
    case "contact_attempted":
      home = walkIn ? "all" : "waiting";
      break;
    case "contacted":
      home = walkIn ? "all" : "contacted";
      break;
    case "qualified":
    case "converted":
      home = "qualified";
      break;
    case "disqualified":
      home = "disqualified";
      break;
    case "duplicate":
      home = "duplicates";
      break;
    default:
      home = "all";
  }
  const also: LeadView[] = [];
  if (lead.owner_id === userId && (ACTIVE.has(lead.status) || lead.status === "qualified")) also.push("mine");
  if (lead.owner_id === null && ACTIVE.has(lead.status)) also.push("unassigned");
  if (ACTIVE.has(lead.status) && !lead.first_response_at && lead.first_response_due_at && new Date(lead.first_response_due_at) < now) also.push("follow-up");
  if (lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= endOfTodayKl(now)) also.push("follow-ups-due");
  if ((lead.status === "new" || lead.status === "contact_attempted") && new Date(lead.created_at) < new Date(now.getTime() - 2 * 86_400_000)) also.push("aging");
  if (lead.duplicate_of_lead_id && home !== "duplicates") also.push("duplicates");
  return { home, also };
}

/** One sentence for a toast or notice: "Now in Waiting for reply and My leads." */
export function whereSentence(w: Whereabouts): string {
  const views = [VIEW_LABELS[w.home], ...w.also.map((v) => VIEW_LABELS[v])];
  if (views.length === 1) return `Now in ${views[0]}.`;
  return `Now in ${views.slice(0, -1).join(", ")} and ${views[views.length - 1]}.`;
}
