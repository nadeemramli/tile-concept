export interface FeedbackPurchaseContext {
  purchase_id: string;
  purchase_ref: string | null;
  purchased_at: string;
  amount: number;
  currency: string;
  contact_id: string;
  customer_name: string;
  phone: string | null;
  visit_id: string | null;
  location_id: string | null;
  location_name: string | null;
  salesperson_id: string | null;
  salesperson_name: string | null;
  existing_request_id: string | null;
}

export interface FeedbackRequestRow {
  id: string;
  purchase_id: string;
  visit_id: string | null;
  contact_id: string;
  customer_name: string;
  purchase_ref: string | null;
  purchased_at: string;
  purchase_amount: number;
  purchase_currency: string;
  location_name: string | null;
  salesperson_name: string | null;
  status: string;
  benefit_status: string;
  customer_confirmed_at: string | null;
  google_handoff_opened_at: string | null;
  has_photo: boolean;
  created_at: string;
}

export interface CustomerFeedbackAnswer {
  question_key: string;
  question_text: string;
  answer_text: string | null;
  position: number;
}

export interface CustomerFeedbackView {
  request_id: string;
  status: string;
  expires_at: string;
  customer_name: string;
  purchased_at: string;
  location_name: string | null;
  answers: CustomerFeedbackAnswer[];
  draft_text: string;
  has_photo: boolean;
  review_url: string | null;
  benefit_status: string;
}

export interface FeedbackCreationResult {
  request_id: string;
  secure_link: string;
  whatsapp_url: string;
  generation_mode: "llm" | "deterministic";
  photo_warning?: string;
}

