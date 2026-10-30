/**
 * Pursuit outcome taxonomy (TILE-8). This mirrors `core.outcome_reasons` in
 * `supabase/migrations/20261029163000_pursuit_outcomes.sql`, which is the
 * authority; `outcome-reasons.test.ts` fails if the two drift. The inbox, the
 * pipeline and Help & glossary all read this one list.
 *
 * The wording is a configurable proposal from the TILE-3 reporting baseline,
 * not an accepted business taxonomy. Unknown is an explicit choice in every
 * set and Other always needs an explanation.
 */
export type OutcomeType = "lost" | "rejected" | "deferred";

export interface OutcomeReason {
  key: string;
  label: string;
  hint: string;
  requiresDetail: boolean;
  isCompetitor: boolean;
}

export const OUTCOME_REASONS: Record<OutcomeType, OutcomeReason[]> = {
  lost: [
    { key: "price", label: "Price or budget", hint: "The customer said price or their budget decided it against us.", requiresDetail: false, isCompetitor: false },
    { key: "competitor", label: "Awarded to another supplier", hint: "The customer chose another supplier. Name it only if known; an unnamed supplier stays Unknown. Any relationship with that supplier is recorded separately and provisionally.", requiresDetail: false, isCompetitor: true },
    { key: "timing", label: "Timing: the award is gone", hint: "Timing ended this pursuit for good, for example the order was placed before we could respond. If the customer is only not ready yet, defer with a review date instead.", requiresDetail: false, isCompetitor: false },
    { key: "product_fit", label: "Product, specification or availability", hint: "What we could offer did not fit the specification, design or delivery the customer needed.", requiresDetail: false, isCompetitor: false },
    { key: "project_cancelled", label: "Project cancelled by the customer", hint: "The customer's project itself stopped, so nobody won it.", requiresDetail: false, isCompetitor: false },
    { key: "customer_unresponsive", label: "Customer stopped responding", hint: "Chosen by staff after deciding to close the pursuit. Recording No response never closes an inquiry by itself.", requiresDetail: false, isCompetitor: false },
    { key: "unknown", label: "Unknown", hint: "The reason is genuinely not known. Kept as its own bucket and never counted as any other reason.", requiresDetail: false, isCompetitor: false },
    { key: "other", label: "Other (explain)", hint: "None of the listed reasons fits. The explanation is required and kept with the outcome.", requiresDetail: true, isCompetitor: false },
  ],
  rejected: [
    { key: "not_buying", label: "Not a buying inquiry", hint: "Not someone looking to buy, for example a job seeker, supplier pitch or general question.", requiresDetail: false, isCompetitor: false },
    { key: "out_of_scope", label: "Product or service we do not offer", hint: "A genuine request for something outside our range or services.", requiresDetail: false, isCompetitor: false },
    { key: "out_of_area", label: "Outside our service area", hint: "The location is outside where we deliver or work.", requiresDetail: false, isCompetitor: false },
    { key: "spam", label: "Spam or fake contact", hint: "Automated, abusive or fake details. Excluded from valid inquiries.", requiresDetail: false, isCompetitor: false },
    { key: "test", label: "Test or internal entry", hint: "Created by staff to try the system. Excluded from valid inquiries.", requiresDetail: false, isCompetitor: false },
    { key: "duplicate", label: "Duplicate of another inquiry", hint: "The same buying need is already being handled. Link the original inquiry or explain which one it duplicates.", requiresDetail: false, isCompetitor: false },
    { key: "unknown", label: "Unknown", hint: "Rejected at qualification without a known reason. Kept explicit, never guessed.", requiresDetail: false, isCompetitor: false },
    { key: "other", label: "Other (explain)", hint: "None of the listed reasons fits. The explanation is required.", requiresDetail: true, isCompetitor: false },
  ],
  deferred: [
    { key: "timing", label: "Customer not ready yet", hint: "The customer still intends to buy but not now. Review on the stated date.", requiresDetail: false, isCompetitor: false },
    { key: "budget_pending", label: "Waiting on budget approval", hint: "The decision depends on budget the customer has not released yet.", requiresDetail: false, isCompetitor: false },
    { key: "awaiting_decision", label: "Waiting on the customer's design or project decision", hint: "A design, contractor or project decision has to happen first.", requiresDetail: false, isCompetitor: false },
    { key: "unknown", label: "Unknown", hint: "Deferred without a stated reason. Kept explicit, never guessed.", requiresDetail: false, isCompetitor: false },
    { key: "other", label: "Other (explain)", hint: "None of the listed reasons fits. The explanation is required.", requiresDetail: true, isCompetitor: false },
  ],
};

export function outcomeReason(type: string, key: string | null | undefined): OutcomeReason | undefined {
  if (!key || !(type in OUTCOME_REASONS)) return undefined;
  return OUTCOME_REASONS[type as OutcomeType].find((r) => r.key === key);
}

/**
 * "Friendly competitor" has not been defined by the business. Two readings
 * exist (an existing customer/business relationship, or a mutual referral
 * partner) and neither is adopted, so the app only records that a relationship
 * was reported, what was said, and how it is known.
 */
export const COMPETITOR_RELATIONSHIPS = [
  { key: "unknown", label: "Unknown", hint: "Nobody knows whether we have any relationship with this supplier. Kept explicit, never assumed." },
  { key: "none_reported", label: "No relationship reported", hint: "Nobody has reported a relationship with this supplier. This is not a confirmation that none exists." },
  { key: "reported", label: "Relationship reported (provisional)", hint: "Someone reported a relationship, sometimes called a friendly competitor. The business has not defined that term, so describe what was said; it is not recorded as a referral partner or as a customer relationship." },
] as const;

export const COMPETITOR_EVIDENCE = [
  { key: "unverified", label: "Unverified", hint: "Heard or assumed internally, not confirmed by the customer or a document." },
  { key: "customer_stated", label: "Customer stated", hint: "The customer said so directly. Still a claim, not a confirmed business arrangement." },
  { key: "documented", label: "Documented", hint: "Supported by a document such as a quotation, award letter or written message." },
] as const;

export type CompetitorRelationship = (typeof COMPETITOR_RELATIONSHIPS)[number]["key"];
export type CompetitorEvidence = (typeof COMPETITOR_EVIDENCE)[number]["key"];
