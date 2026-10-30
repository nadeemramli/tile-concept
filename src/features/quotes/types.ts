/** Where the quote panel is opened from. Exactly one anchor is set. */
export type QuoteAnchor = { lead_id: string } | { visit_id: string } | { opportunity_id: string };

export interface QuoteSendView {
  id: string;
  sent_at: string;
  recorded_at: string;
  channel: string;
  evidence: string;
  evidence_ref: string | null;
  note: string | null;
  sent_by_name: string | null;
  recorded_by_name: string | null;
  /** first_quote | revision | resend; null when voided. */
  kind: string | null;
  voided: { reason: string; at: string } | null;
}

export interface QuoteVersionView {
  id: string;
  version_no: number;
  prepared_at: string;
  issued_at: string | null;
  total_amount: number | null;
  currency: string;
  external_ref: string | null;
  valid_until: string | null;
  evidence_state: string;
  notes: string | null;
  sends: QuoteSendView[];
}

export interface QuoteEventView {
  id: string;
  event_type: string;
  occurred_at: string;
  recorded_at: string;
  actor_name: string | null;
  reason: string | null;
}

export interface QuoteView {
  id: string;
  quote_number: string | null;
  status: string;
  lifecycle: string;
  origin: string;
  opportunity_id: string | null;
  lead_id: string | null;
  visit_id: string | null;
  current_version_no: number;
  first_sent_at: string | null;
  first_sent_version_no: number | null;
  /** Newest first. */
  versions: QuoteVersionView[];
  events: QuoteEventView[];
}

export interface VisitEvidenceView {
  evidence_key: string;
  visit_id: string;
  evidence_kind: "reference" | "file";
  file_id: string | null;
  reference_text: string | null;
  amount: number | null;
  file_name: string | null;
  resolution: string;
  quote_id: string | null;
  decided_version_id: string | null;
  decision_id: string | null;
  decision_reason: string | null;
  changed_since_decision: boolean;
}

export interface QuoteContext {
  quotes: QuoteView[];
  evidence: VisitEvidenceView[];
}
