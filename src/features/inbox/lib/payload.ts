import { flatten } from "@/integrations/mapping";
import { titleCase } from "@/lib/format";

export interface PayloadEntry {
  key: string;
  label: string;
  value: string;
}

export interface ClassifiedPayload {
  /** Question → answer pairs a salesperson should read, in payload order. */
  answers: PayloadEntry[];
  /** Ad/tracking metadata, collapsed behind a disclosure. Sorted by key. */
  technical: PayloadEntry[];
}

/**
 * Deny-list of technical/ad keys; everything else is treated as a form answer.
 * Covers the automation intake contract (submission_id, form/campaign/ad/page
 * ids and names, consent_version), webhook plumbing (external ids, timestamps,
 * hub challenge fields) and website UTM parameters.
 */
const TECHNICAL_KEY =
  /^(?:__|utm_|hub_)|^(?:id|leadgen_id|lead_id|form_id|form_name|form_ref|page_id|page_name|ad_id|ad_name|adset_id|adset_name|adgroup_id|adgroup_name|campaign_id|campaign_name|advertiser_id|submission_id|external_id|idempotency_key|created_time|create_time|occurred_at|received_at|timestamp|consent_version|source|source_detail|provider|platform|locale|signature|token|secret|is_organic|status)$/;

function toText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ").trim();
  return String(v).trim();
}

/**
 * Splits an intake event payload into readable form answers and collapsed
 * technical metadata. Meta `field_data` / TikTok `answers` lists are flattened
 * via the same helper the webhooks use, and the `__unmapped` bag (questions we
 * had no mapping row for) is folded back in as answers — a question is never
 * dropped just because nobody mapped it yet.
 */
export function classifyIntakePayload(payload: Record<string, unknown>): ClassifiedPayload {
  const { __unmapped, ...rest } = payload;
  const entries: [string, unknown][] = Object.entries(flatten(rest));
  if (__unmapped && typeof __unmapped === "object" && !Array.isArray(__unmapped)) {
    for (const [k, v] of Object.entries(__unmapped as Record<string, unknown>)) entries.push([k, v]);
  }

  const answers: PayloadEntry[] = [];
  const technical: PayloadEntry[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of entries) {
    if (raw === null || raw === undefined || seen.has(key)) continue;
    const value = toText(raw);
    if (!value) continue;
    seen.add(key);
    const entry: PayloadEntry = { key, label: titleCase(key), value };
    (TECHNICAL_KEY.test(key) ? technical : answers).push(entry);
  }
  technical.sort((x, y) => x.key.localeCompare(y.key));
  return { answers, technical };
}
