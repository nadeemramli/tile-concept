import type { StatusMap } from "@/lib/domain/status-maps";

/** Local status maps for the connector console (PRD §11.1). */

export const CONNECTOR_STATUS: StatusMap = {
  not_configured: { label: "Not configured", tone: "neutral" },
  paused: { label: "Paused", tone: "warning" },
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  failed: { label: "Failed", tone: "destructive" },
};

export const INTAKE_STATUS: StatusMap = {
  received: { label: "Received", tone: "info" },
  processed: { label: "Processed", tone: "success" },
  duplicate: { label: "Deduplicated", tone: "neutral" },
  failed: { label: "Failed", tone: "destructive" },
};

export const ENVIRONMENT: StatusMap = {
  demo: { label: "Demo", tone: "ai" },
  shadow: { label: "Shadow", tone: "info" },
  live: { label: "Live", tone: "warning" },
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
