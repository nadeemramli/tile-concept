export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by: string | null;
  contact_id: string | null;
  contact_name: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  lead_id: string | null;
  project_id: string | null;
  completed_at: string | null;
  outcome: string | null;
  created_at: string;
}
