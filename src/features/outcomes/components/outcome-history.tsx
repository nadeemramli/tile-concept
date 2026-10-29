"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { InfoTip } from "@/components/patterns/explain";
import { COMPETITOR_EVIDENCE, COMPETITOR_RELATIONSHIP, PURSUIT_OUTCOME, statusMeta } from "@/lib/domain/status-maps";
import { outcomeReason } from "@/lib/domain/outcome-reasons";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { PursuitOutcome } from "@/features/outcomes/types";
import { OutcomeDialog } from "./outcome-dialog";

/**
 * Every recorded outcome for an inquiry or opportunity, newest first. A reopen
 * is shown on the outcome it reopened; nothing is hidden or rewritten.
 */
export function OutcomeHistory({ items, canWrite }: { items: PursuitOutcome[]; canWrite: boolean }) {
  const [correcting, setCorrecting] = useState<PursuitOutcome | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="outcome-history">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        Outcome history
        <InfoTip label="Outcome history" content="Each loss, rejection or deferral with its reason, effective date and who recorded it. Reopening adds an event; earlier outcomes stay in their week for reporting." />
      </p>
      <ul className="space-y-2">
        {items.map((o) => {
          const reason = outcomeReason(o.outcome_type, o.reason_code);
          const original = o.original_reason_code !== o.reason_code ? outcomeReason(o.outcome_type, o.original_reason_code) : null;
          return (
            <li key={o.id} className="rounded-md border p-2 text-sm" data-testid="outcome-event">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill map={PURSUIT_OUTCOME} value={o.outcome_type} />
                <span className="font-medium">{reason?.label ?? o.reason_code}</span>
                {o.reopened_at && <StatusPill map={PURSUIT_OUTCOME} value="reopened" />}
              </div>
              {o.reason_detail && <p className="mt-1 whitespace-pre-wrap text-xs">{o.reason_detail}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Effective {formatDate(o.effective_date)}
                {o.review_date && ` · review ${formatDate(o.review_date)}`} · recorded {formatDateTime(o.recorded_at)} by {o.recorded_by ?? "unknown"}
                {o.closes_lead && o.closes_opportunity && " · inquiry and opportunity closed together (counted once)"}
              </p>
              {reason?.isCompetitor && (
                <p className="mt-1 text-xs">
                  Supplier: {o.competitor_name ?? <span className="italic">Unknown (not named)</span>}
                  {" · "}Relationship: {statusMeta(COMPETITOR_RELATIONSHIP, o.competitor_relationship).label}
                  {o.competitor_relationship === "reported" && (
                    <>
                      {" "}({statusMeta(COMPETITOR_EVIDENCE, o.competitor_evidence).label.toLowerCase()}): {o.competitor_relationship_detail}
                      <TonePill tone="warning" label="provisional" className="ml-1" hint="Reported, not confirmed by the business. “Friendly competitor” is not defined, so this is not a referral or customer relationship." />
                    </>
                  )}
                </p>
              )}
              {o.outcome_type === "lost" && (
                <p className="mt-1 text-xs tnum">
                  {o.quoted_value !== null ? <>Lost quoted value: {formatMoney(o.quoted_value, o.quoted_currency ?? "MYR")}</> : "No quotation total recorded"}
                  {o.estimated_value !== null && <> · Estimated value{o.quoted_value === null ? " (not quoted)" : ""}: {formatMoney(o.estimated_value, o.estimated_currency ?? "MYR")}</>}
                </p>
              )}
              {o.corrected_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Corrected {formatDateTime(o.corrected_at)} by {o.corrected_by ?? "unknown"}
                  {original && <> · originally “{original.label}”</>}
                  {o.original_effective_date !== o.effective_date && <> · originally effective {formatDate(o.original_effective_date)}</>}
                </p>
              )}
              {o.reopened_at && (
                <p className="mt-1 text-xs text-muted-foreground">Reopened {formatDateTime(o.reopened_at)} by {o.reopened_by ?? "unknown"}: {o.reopen_reason}</p>
              )}
              {canWrite && (
                <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => setCorrecting(o)}>Correct reason</Button>
              )}
            </li>
          );
        })}
      </ul>
      {correcting && <OutcomeDialog key={correcting.id} open mode="correct" event={correcting} target={{ leadId: correcting.lead_id, opportunityId: correcting.opportunity_id }} onOpenChange={(o) => !o && setCorrecting(null)} />}
    </div>
  );
}
