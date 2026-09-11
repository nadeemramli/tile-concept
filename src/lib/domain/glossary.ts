import {
  APP_MODE,
  APPROVAL_ACTION,
  CANDIDATE_CONFIDENCE,
  CANDIDATE_STATUS,
  CONNECTOR_STATUS,
  FEEDBACK_REQUEST_STATUS,
  INVITE_STATUS,
  ISSUE_SEVERITY,
  ISSUE_STATUS,
  ISSUE_TYPE,
  LEAD_STATUS,
  LIFECYCLE_STATE,
  MEMBER_STATUS,
  OPPORTUNITY_STATUS,
  PRICE_LIST_STATUS,
  PRICE_STATE,
  PRODUCT_STATUS,
  PURCHASE_STATUS,
  REVIEW_STATE,
  SOURCE_CHANNEL,
  TASK_PRIORITY,
  TASK_STATUS,
  type StatusMap,
} from "@/lib/domain/status-maps";
import {
  BOOKING_STATUS_MAP,
  CAPTURE_TYPES,
  CONTENT_STATUS_MAP,
  CONTENT_TYPES,
  OUTPUT_STATE_MAP,
  PARTICIPANT_ROLE_HINTS,
  PERMISSION_STATUS_MAP,
  PERMITTED_USES,
  PRIORITY,
  READINESS_STATE_MAP,
} from "@/features/marketing/lib/status";
import { AVAILABILITY_STATUS, CASE_STATUS, CHANNEL_HINT, CHANNEL_LABEL, FRESHNESS_STATUS, MAPPING_STATUS, SOURCE_KIND } from "@/features/stock/status";
import { ASSET_KIND, ASSET_STATUS, CONFIDENCE_HINT, ITEM_TYPE, JOB_STATUS, REVIEW_ITEM_STATUS } from "@/features/sources/status-maps";
import { INTAKE_STATUS } from "@/features/connectors/status";
import { titleCase } from "@/lib/format";

/**
 * Help & glossary is generated from the same maps the tooltips read, so the
 * page can never drift from what people see on screen. Anchor ids here are
 * the ones `HELP` in the marketing status file links to.
 */

export interface GlossaryEntry {
  id: string;
  title: string;
  /** A short paragraph before the list of states. */
  intro?: string;
  map: StatusMap;
}

export interface GlossaryGroup {
  domain: string;
  entries: GlossaryEntry[];
}

function listMap(items: readonly { value: string; label: string; hint: string }[]): StatusMap {
  return Object.fromEntries(items.map((i) => [i.value, { label: i.label, tone: "neutral" as const, hint: i.hint }]));
}

function recordMap(labels: Record<string, string>, hints: Record<string, string>): StatusMap {
  return Object.fromEntries(Object.keys(hints).map((k) => [k, { label: labels[k] ?? titleCase(k), tone: "neutral" as const, hint: hints[k] }]));
}

export const GLOSSARY: GlossaryGroup[] = [
  {
    domain: "Sales",
    entries: [
      { id: "lead-status", title: "Lead status", intro: "Where an enquiry is between arriving and becoming a project. The first-response clock runs from New until Contacted.", map: LEAD_STATUS },
      { id: "opportunity-status", title: "Opportunity status", intro: "The outcome group of an opportunity. Stages within Open are configured in Settings; Won, Lost and Deferred each need a reason.", map: OPPORTUNITY_STATUS },
      { id: "source-channel", title: "Source channel", intro: "Where a lead or customer first came from. The original source is kept even after a merge.", map: SOURCE_CHANNEL },
      { id: "task-status", title: "Task status", map: TASK_STATUS },
      { id: "task-priority", title: "Task priority", map: TASK_PRIORITY },
      { id: "purchase-status", title: "Purchase status", intro: "Purchases recorded at the counter. Corrections are permissioned and audited.", map: PURCHASE_STATUS },
      { id: "feedback-request-status", title: "Customer feedback request", intro: "The post-purchase private feedback flow. Opening the Google review handoff is never counted as a posted review.", map: FEEDBACK_REQUEST_STATUS },
    ],
  },
  {
    domain: "Customer identity",
    entries: [
      { id: "lifecycle-state", title: "Customer lifecycle", intro: "Derived from purchases recorded in the app only; SQL Account history is not included.", map: LIFECYCLE_STATE },
      { id: "duplicate-confidence", title: "Duplicate confidence", intro: "How strong a suggested match is. Nothing is merged automatically at any level.", map: CANDIDATE_CONFIDENCE },
      { id: "duplicate-status", title: "Duplicate candidate status", intro: "A merge is reversible: the merged record is archived, not deleted.", map: CANDIDATE_STATUS },
    ],
  },
  {
    domain: "Marketing",
    entries: [
      {
        id: "customer-media-permission",
        title: "Customer media permission",
        intro:
          "The customer's documented agreement to be photographed or filmed and to have the material used in marketing. It is recorded on the nomination in Content Opportunities, separately from sales-contact consent, and it has nothing to do with your own access in this app. A shoot date can be held before it is approved, but no asset from the shoot can be marked usable until it is. It records who agreed, when, the permitted capture types and uses, restrictions, an expiry date, evidence, and any revocation.",
        map: PERMISSION_STATUS_MAP,
      },
      { id: "permitted-capture", title: "Permitted capture", intro: "What the customer allowed the crew to record.", map: listMap(CAPTURE_TYPES) },
      { id: "permitted-uses", title: "Permitted uses", intro: "Where the customer allowed the material to appear. Paid advertising must be asked for explicitly.", map: listMap(PERMITTED_USES) },
      { id: "content-status", title: "Content opportunity status", intro: "Sales nominates a finished project; Marketing decides; then it is scheduled, shot and completed.", map: CONTENT_STATUS_MAP },
      { id: "project-readiness", title: "Project readiness", intro: "Whether the site is finished enough to film. Tracked separately from customer media permission.", map: READINESS_STATE_MAP },
      { id: "content-types", title: "Content types", map: listMap(CONTENT_TYPES) },
      { id: "content-priority", title: "Content priority", map: PRIORITY },
      { id: "booking-status", title: "Shoot booking status", intro: "Holds and confirmed bookings stay distinct. Only a marketing coordinator can confirm, and confirming checks for clashes.", map: BOOKING_STATUS_MAP },
      { id: "participant-roles", title: "Participant roles", map: recordMap({}, PARTICIPANT_ROLE_HINTS) },
      { id: "asset-state", title: "Shoot asset state", intro: "Photos, video and notes from a shoot. Usable is gated by the database on an approved, unexpired customer media permission.", map: OUTPUT_STATE_MAP },
    ],
  },
  {
    domain: "Merchandise",
    entries: [
      { id: "product-status", title: "Product status", map: PRODUCT_STATUS },
      { id: "review-state", title: "Review state", intro: "Whether a person has confirmed a product's attributes and source. Trust is earned by review, not by import.", map: REVIEW_STATE },
      { id: "price-state", title: "Price state", intro: "A price is a versioned fact with a validity window, never a field edited in place.", map: PRICE_STATE },
      { id: "price-list-status", title: "Price list status", map: PRICE_LIST_STATUS },
      { id: "approval-action", title: "Price approval actions", map: APPROVAL_ACTION },
      { id: "availability", title: "Stock availability", intro: "A state is never collapsed into a number. Unknown and Ask supplier mean nobody has confirmed anything.", map: AVAILABILITY_STATUS },
      { id: "stock-source", title: "Stock source", map: SOURCE_KIND },
      { id: "freshness", title: "Freshness", intro: "How old the latest figure is against the supplier's or connector's policy. Stale means do not quote from it.", map: FRESHNESS_STATUS },
      { id: "stock-channel", title: "How a stock update was heard", map: recordMap(CHANNEL_LABEL, CHANNEL_HINT) },
      { id: "mapping-status", title: "SQL Account item mapping", map: MAPPING_STATUS },
      { id: "reconciliation-case", title: "Reconciliation case", map: CASE_STATUS },
    ],
  },
  {
    domain: "Sources and imports",
    entries: [
      { id: "asset-status", title: "Source document status", map: ASSET_STATUS },
      { id: "asset-kind", title: "Source document kind", map: ASSET_KIND },
      { id: "job-status", title: "Parse job status", map: JOB_STATUS },
      { id: "review-item-status", title: "Review item status", intro: "Nothing reaches the catalog until a reviewer approves it. Unresolved fields are named, never defaulted.", map: REVIEW_ITEM_STATUS },
      { id: "review-item-type", title: "Review item type", map: ITEM_TYPE },
      { id: "confidence", title: "Confidence score", intro: CONFIDENCE_HINT, map: {} },
    ],
  },
  {
    domain: "Platform",
    entries: [
      { id: "app-mode", title: "Operating mode", map: APP_MODE },
      { id: "connector-status", title: "Connector status", map: CONNECTOR_STATUS },
      { id: "intake-status", title: "Lead intake status", map: INTAKE_STATUS },
      { id: "issue-type", title: "Data health issue types", map: ISSUE_TYPE },
      { id: "issue-severity", title: "Issue severity", map: ISSUE_SEVERITY },
      { id: "issue-status", title: "Issue status", map: ISSUE_STATUS },
      { id: "member-status", title: "Member status", map: MEMBER_STATUS },
      { id: "invite-status", title: "Invitation status", map: INVITE_STATUS },
    ],
  },
];

/** Cross-cutting words that are not a status but come up on every page. */
export const TERMS: { id: string; term: string; meaning: string }[] = [
  { id: "term-masked", term: "Masked contact details", meaning: "Lists show phone numbers and emails partly hidden. Reveal needs the contact.reveal permission and every reveal is audited with who, when and which record." },
  { id: "term-first-response", term: "First response and SLA", meaning: "The time from a lead arriving to the first real contact. The target is 4 hours; SLA overdue means it has passed with no response. Terminal leads show no SLA." },
  { id: "term-reason-required", term: "Reason required", meaning: "Some actions only save with a written reason: closing an opportunity, moving a stage backward, correcting a purchase, merging, overriding a price clash, declining a nomination. The reason is kept in the audit trail." },
  { id: "term-override", term: "Override (audited)", meaning: "Going ahead despite a rule the app would otherwise enforce, such as a price overlap or a crew clash. It needs a reason and is recorded against your name." },
  { id: "term-evidence", term: "Evidence versus fact", meaning: "A screenshot, a phone call or a parsed page is evidence of what somebody said or wrote. It becomes a fact only when a person confirms it. Pixels in an image never become a physical size." },
  { id: "term-freshness", term: "Freshness", meaning: "How old a figure is compared with the policy for its source. Fresh, aging and stale are about age, not about whether the figure is right." },
  { id: "term-idempotent", term: "Idempotent", meaning: "Sending the same thing twice has the same effect as sending it once. Lead submissions and imports carry a key so a retry never creates a duplicate." },
  { id: "term-superseded", term: "Superseded", meaning: "Replaced by a newer version and kept for history. Nothing published is edited or deleted in place." },
  { id: "term-scope", term: "Your scope", meaning: "Which records you can see. Sales representatives see their own; managers and management see everyone's. Some pages say Your records or All sales records at the top." },
  { id: "term-roles", term: "Roles and permissions", meaning: "What you can do is decided by the database from your role. A greyed-out control with a lock explanation means your role does not include that action; ask an administrator if you need it." },
];
