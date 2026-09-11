import type { StatusMap } from "@/lib/domain/status-maps";

/** Local status maps for the connector console (PRD §11.1). */

export const CONNECTOR_STATUS: StatusMap = {
  not_configured: { label: "Not configured", tone: "neutral", hint: "No secret or endpoint yet. Nothing is being received." },
  paused: { label: "Paused", tone: "warning", hint: "Deliberately stopped. Submissions are rejected until resumed." },
  healthy: { label: "Healthy", tone: "success", hint: "The last submission or test was accepted inside the freshness policy." },
  degraded: { label: "Degraded", tone: "warning", hint: "Working, but the last activity is older than the policy or some submissions failed." },
  failed: { label: "Failed", tone: "destructive", hint: "The last submission failed. Leads may be missing until it is fixed." },
};

export const INTAKE_STATUS: StatusMap = {
  received: { label: "Received", tone: "info", hint: "Accepted and stored with its signature verified. Not yet turned into a lead." },
  processed: { label: "Processed", tone: "success", hint: "Became a lead in the Inquiry Inbox." },
  duplicate: { label: "Deduplicated", tone: "neutral", hint: "The same submission id arrived before. Kept for the record; no second lead was made." },
  failed: { label: "Failed", tone: "destructive", hint: "Could not be processed. Fix the cause, then Replay it." },
};

export const ENVIRONMENT: StatusMap = {
  demo: { label: "Demo", tone: "ai", hint: "Synthetic submissions only." },
  shadow: { label: "Shadow", tone: "info", hint: "Real submissions are stored and become leads, but nothing is sent back to the provider or the customer." },
  live: { label: "Live", tone: "warning", hint: "Real customers. Every submission is audited." },
};

/**
 * The connector contract from PRD §11.1, and what exists today for each
 * provider. Honest by design: "planned" means not built, not "coming soon".
 */
export type ContractState = "built" | "partial" | "planned";

export interface ContractItem {
  key: string;
  label: string;
  detail: string;
}

export const CONTRACT: ContractItem[] = [
  { key: "manifest", label: "Manifest", detail: "Provider, scopes, data classes, purpose, owner, freshness policy" },
  { key: "test", label: "Test", detail: "Authenticated health check with no mutation" },
  { key: "pull", label: "Pull / webhook", detail: "Idempotent ingestion with a checkpoint and raw reference" },
  { key: "normalize", label: "Normalize", detail: "Provider payload to the versioned canonical contract" },
  { key: "reconcile", label: "Reconcile", detail: "Source counts and ids against accepted records" },
  { key: "retry", label: "Retry", detail: "Reason-coded backoff with a dead-letter or review state" },
  { key: "rotate", label: "Rotate", detail: "Credential expiry and rotation procedure" },
  { key: "disable", label: "Disable", detail: "Stops new intake without deleting accepted history" },
];

export const CONTRACT_BY_PROVIDER: Record<string, Record<string, ContractState>> = {
  website: { manifest: "built", test: "built", pull: "built", normalize: "built", reconcile: "built", retry: "partial", rotate: "planned", disable: "built" },
  meta: { manifest: "built", test: "planned", pull: "built", normalize: "built", reconcile: "built", retry: "partial", rotate: "planned", disable: "built" },
  tiktok: { manifest: "built", test: "planned", pull: "built", normalize: "built", reconcile: "built", retry: "partial", rotate: "planned", disable: "built" },
  sql_account: { manifest: "built", test: "planned", pull: "planned", normalize: "planned", reconcile: "planned", retry: "planned", rotate: "planned", disable: "built" },
  google_drive: { manifest: "built", test: "planned", pull: "planned", normalize: "planned", reconcile: "planned", retry: "planned", rotate: "planned", disable: "built" },
  supplier_web: { manifest: "built", test: "planned", pull: "planned", normalize: "planned", reconcile: "planned", retry: "planned", rotate: "planned", disable: "built" },
};

export const CONTRACT_TONE: Record<ContractState, "success" | "warning" | "neutral"> = {
  built: "success",
  partial: "warning",
  planned: "neutral",
};

/** What each provider still needs before it can leave demo mode. */
export const UNLOCKS: Record<string, string> = {
  website: "Set INTAKE_WEBSITE_SECRET here and on the website server, then point the site's form handler at /api/intake/website.",
  meta: "Business Manager access, an approved developer app, the leads_retrieval permission, then META_APP_SECRET and META_VERIFY_TOKEN.",
  tiktok: "An approved TikTok for Business developer app with lead-generation scope, then TIKTOK_APP_SECRET.",
  sql_account: "SQL Account API entitlement, a least-privilege API user, and the local connector service (Phase 5).",
  google_drive: "A service account with an allowlisted folder boundary (Phase 4).",
  supplier_web: "Per-domain owner approval and a terms/robots review (Phase 4).",
};
