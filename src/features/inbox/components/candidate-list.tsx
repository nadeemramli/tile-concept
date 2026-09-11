"use client";

import { Building2, Contact, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { Hint } from "@/components/patterns/explain";
import { CANDIDATE_CONFIDENCE, LEAD_STATUS, LIFECYCLE_STATE, SOURCE_CHANNEL, statusMeta } from "@/lib/domain/status-maps";
import { formatRelative } from "@/lib/format";
import type { CandidateReason, IdentityCandidate } from "@/features/inbox/types";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<string, string> = {
  exact_phone: "Same phone",
  exact_email: "Same email",
  similar_name: "Similar name",
  exact_registration: "Same registration no.",
  similar_company: "Similar company",
  alias_company: "Known alias",
};

/** Why the record was suggested, one sentence each. Shared wording with Identity Review. */
export const REASON_HINT: Record<string, string> = {
  exact_phone: "The same normalised phone number is on both records. Strong evidence; still confirm with the customer.",
  exact_email: "The same email address is on both records. Strong evidence.",
  similar_name: "The names are close after normalising spelling and spacing. Never enough on its own.",
  exact_registration: "The same company registration number is on both records. Strong evidence.",
  similar_company: "The company names are close. Supporting evidence only.",
  alias_company: "One record uses a trading or short name recorded as an alias of the other.",
};

export const SCORE_HINT = "Sum of the match reasons' weights. 55 or more is high confidence (an exact phone, email or registration match), 25 to 54 medium, below 25 low. A score never links or merges anything by itself.";

/** The zero-weight reason that says this person has enquired before, and how. */
export function priorEnquiry(c: IdentityCandidate): CandidateReason | undefined {
  return c.reasons.find((r) => r.code === "prior_enquiry");
}

function EnquiredBefore({ reason, unlinked }: { reason: CandidateReason; unlinked: boolean }) {
  const channel = reason.channel ? statusMeta(SOURCE_CHANNEL, reason.channel).label : null;
  const when = reason.at ? formatRelative(reason.at) : null;
  const count = reason.count ?? 1;
  const label = unlinked ? "Enquired before" : count > 1 ? `Enquired ${count}×` : "Enquired before";
  const detail = [when, channel ? `via ${channel}` : null].filter(Boolean).join(" ");
  return (
    <TonePill
      tone="ai"
      dot={false}
      label={detail ? `${label} · ${detail}` : label}
      hint={
        unlinked
          ? "This enquiry came in with the same phone or email and nobody has linked it to a customer record yet. Use it to create the contact so the enquiry, its history and its salesperson stay attached."
          : `This customer has ${count} recorded enquir${count === 1 ? "y" : "ies"} in the Inquiry Inbox. Open the contact to see them and who is handling the latest.`
      }
    />
  );
}

/** Identity candidates with masked identifiers and reason codes (PRD §6.2). Never auto-selects. */
export function CandidateList({
  candidates,
  onPick,
  pickLabel = "Use this",
  busy,
  className,
  filter,
}: {
  candidates: IdentityCandidate[];
  onPick?: (c: IdentityCandidate) => void;
  pickLabel?: string;
  busy?: boolean;
  className?: string;
  filter?: "contact" | "account";
}) {
  const rows = filter ? candidates.filter((c) => c.entity_type === filter) : candidates;
  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No matching {filter ?? "contact, account or enquiry"} records. Safe to create a new one.</p>;
  }
  return (
    <ul className={cn("divide-y rounded-md border", className)}>
      {rows.map((c) => {
        const isLead = c.entity_type === "lead";
        const enquiry = priorEnquiry(c);
        const Icon = c.entity_type === "account" ? Building2 : isLead ? Inbox : Contact;
        return (
          <li key={`${c.entity_type}-${c.entity_id}`} className="flex items-start gap-3 px-3 py-2">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", isLead ? "bg-ai/12" : "bg-muted")}>
              <Icon className={cn("size-3.5", isLead ? "text-ai" : "text-muted-foreground")} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{c.display_name}</span>
                {isLead && enquiry?.status && <StatusPill map={LEAD_STATUS} value={enquiry.status} />}
                <StatusPill map={CANDIDATE_CONFIDENCE} value={c.confidence} />
                {c.lifecycle_state && <StatusPill map={LIFECYCLE_STATE} value={c.lifecycle_state} />}
                {enquiry && <EnquiredBefore reason={enquiry} unlinked={isLead} />}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tnum">
                {c.masked_phone && <span className="font-mono">{c.masked_phone}</span>}
                {c.masked_email && <span className="font-mono">{c.masked_email}</span>}
                {c.last_activity_at && <span>{isLead ? "last activity" : "last activity"} {formatRelative(c.last_activity_at)}</span>}
                <Hint content={SCORE_HINT} focusable>
                  <span>score {c.score}</span>
                </Hint>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.reasons
                  .filter((r) => r.code !== "prior_enquiry")
                  .map((r, i) => (
                    <TonePill key={i} tone="neutral" dot={false} label={REASON_LABEL[r.code] ?? r.code} hint={REASON_HINT[r.code]} />
                  ))}
              </div>
            </div>
            {onPick && (
              <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={busy} onClick={() => onPick(c)}>
                {isLead ? "Use this enquiry" : pickLabel}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
