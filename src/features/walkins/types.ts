export interface VisitRow {
  id: string;
  occurred_at: string;
  location_id: string | null;
  location_name: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  account_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  customer_type: string | null;
  origin_area: string | null;
  inquiry_source: string | null;
  purpose: string | null;
  is_new_customer: boolean | null;
  notes: string | null;
}

export interface PurchaseRow {
  id: string;
  purchased_at: string;
  external_ref: string | null;
  contact_id: string | null;
  contact_name: string | null;
  account_id: string | null;
  account_name: string | null;
  opportunity_id: string | null;
  project_id: string | null;
  visit_id: string | null;
  amount: number;
  currency: string;
  purchase_source: string | null;
  location_id: string | null;
  location_name: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  is_repeat: boolean;
  status: string;
  notes: string | null;
  payment_methods: string[];
  payments: { id: string; method: string; amount: number; reference: string | null }[];
  items: { id: string; description: string; quantity: number; unit: string | null; unit_price: number | null; line_total: number | null }[];
}

export interface OpenOpportunityRef {
  id: string;
  name: string;
  stage_key: string;
  project_id: string | null;
}

export interface WalkInResult {
  visit_id: string;
  lead_id: string;
  opportunity_id: string | null;
  project_id: string | null;
  purchase_id: string | null;
  new_customer: boolean;
}
