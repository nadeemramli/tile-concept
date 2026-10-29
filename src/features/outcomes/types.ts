export interface PursuitOutcome {
  id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  closes_lead: boolean;
  closes_opportunity: boolean;
  outcome_type: "lost" | "rejected" | "deferred";
  reason_code: string;
  reason_detail: string | null;
  effective_date: string;
  review_date: string | null;
  competitor_name: string | null;
  competitor_relationship: string | null;
  competitor_relationship_detail: string | null;
  competitor_evidence: string | null;
  quoted_value: number | null;
  quoted_currency: string | null;
  estimated_value: number | null;
  estimated_currency: string | null;
  recorded_by: string | null;
  recorded_at: string;
  original_reason_code: string;
  original_effective_date: string;
  corrected_by: string | null;
  corrected_at: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
}
