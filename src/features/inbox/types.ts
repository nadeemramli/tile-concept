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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdentityCandidate {
  entity_type: "contact" | "account";
  entity_id: string;
  display_name: string;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: { code: string; field: string; weight?: number }[];
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
  new: number;
  unassigned: number;
  mine: number;
  noResponse: number;
  followUp: number;
  duplicates: number;
  aging: number;
}
