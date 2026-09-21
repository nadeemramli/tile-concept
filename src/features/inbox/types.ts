export interface LeadRow {
  id: string;
  status: string;
  source_channel: string;
  source_detail: string | null;
  contact_id: string | null;
  account_id: string | null;
  raw_name: string | null;
  raw_phone: string | null;
  raw_phone_normalized: string | null;
  raw_email: string | null;
  raw_company: string | null;
  interest: string | null;
  product_interest: string[];
  location_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  assigned_at: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
  contact_attempts: number;
  qualified_at: string | null;
  disqualified_reason: string | null;
  converted_opportunity_id: string | null;
  duplicate_of_lead_id: string | null;
  next_follow_up_at: string | null;
  next_follow_up_task_id: string | null;
  follow_up_owner_id: string | null;
  open_follow_ups: number;
  completed_follow_ups: number;
  first_showroom_at: string | null;
  showroom_visits: number;
  first_whatsapp_sent_at: string | null;
  first_customer_reply_at: string | null;
  first_whatsapp_reply_at: string | null;
  last_contact_attempt_at: string | null;
  no_next_action_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A match reason. `prior_enquiry` is a zero-weight reason that carries the
 * enquiry facts (how many, latest channel/status/date) so the walk-in counter
 * can say "they enquired before" without changing the score.
 */
export interface CandidateReason {
  code: string;
  field: string;
  weight?: number;
  count?: number;
  channel?: string | null;
  status?: string | null;
  at?: string | null;
}

export interface IdentityCandidate {
  /** `lead` is an enquiry nobody has linked to a contact yet. */
  entity_type: "contact" | "account" | "lead";
  entity_id: string;
  display_name: string;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: CandidateReason[];
  masked_phone: string | null;
  masked_email: string | null;
  lifecycle_state: string | null;
  last_activity_at: string | null;
}

export interface IntakeEventRow {
  id: string;
  source_channel: string;
  provider: string | null;
  external_id: string | null;
  received_at: string;
  payload: Record<string, unknown>;
  raw_text: string | null;
  status: string;
}

export interface InboxCounts {
  needsAction: number;
  replied: number;
  upcoming: number;
  completed: number;
  new: number;
  waiting: number;
  contacted: number;
  unassigned: number;
  mine: number;
  noResponse: number;
  followUp: number;
  duplicates: number;
  aging: number;
  followUpsDue: number;
}
