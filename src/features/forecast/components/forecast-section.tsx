"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill } from "@/components/patterns/status-pill";
import { DisabledHint, Gated } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { FORECAST_BAND, FORECAST_HISTORY_KIND } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { klToday } from "@/features/forecast/week";
import type { OpportunityDetail } from "@/server/queries/opportunities";
import { ForecastReviewDialog } from "./review-dialog";

/** Forecast facts, the review action and the append-only history for one opportunity. */
export function ForecastSection({ opp, names, isOwner }: { opp: OpportunityDetail; names: Map<string, string>; isOwner: boolean }) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const passed = !!opp.expected_close_date && opp.expected_close_date < klToday() && opp.status === "open";
  const button = (
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      <CalendarClock className="size-3.5" aria-hidden /> Review forecast
    </Button>
  );
  const action = !can("sales.write") ? (
    <Gated permission="sales.write">{button}</Gated>
  ) : opp.archived_at ? (
    <DisabledHint reason="Restore this opportunity first.">
      <Button variant="outline" size="sm" disabled>
        <CalendarClock className="size-3.5" aria-hidden /> Review forecast
      </Button>
    </DisabledHint>
  ) : opp.status !== "open" ? (
    <DisabledHint reason="Only open opportunities carry a forecast. Won, lost and deferred work is excluded from it.">
      <Button variant="outline" size="sm" disabled>
        <CalendarClock className="size-3.5" aria-hidden /> Review forecast
      </Button>
    </DisabledHint>
  ) : !isOwner ? (
    <DisabledHint reason={`Only ${names.get(opp.owner_id ?? "") ?? "its owner"}, a sales manager or an administrator can review this forecast.`}>
      <Button variant="outline" size="sm" disabled>
        <CalendarClock className="size-3.5" aria-hidden /> Review forecast
      </Button>
    </DisabledHint>
  ) : (
    button
  );

  return (
    <DrawerSection title="Forecast" action={action}>
      <FactList
        items={[
          { label: "Expected close", value: opp.expected_close_date ? <span className={passed ? "text-destructive" : undefined}>{formatDate(opp.expected_close_date)}{passed ? " · passed" : ""}</span> : "Unknown" },
          { label: "Likelihood", value: <StatusPill map={FORECAST_BAND} value={opp.probability_band ?? "unknown"} /> },
          { label: "Evidence", value: opp.forecast_evidence ?? "None recorded" },
          {
            label: "Last review",
            value: opp.forecast_reviewed_at ? `${formatDateTime(opp.forecast_reviewed_at)} · ${names.get(opp.forecast_reviewed_by ?? "") ?? "—"}` : "Never reviewed",
          },
        ]}
      />
      {opp.forecast_history.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Forecast history ({opp.forecast_history.length})</summary>
          <ul className="mt-1 space-y-1">
            {opp.forecast_history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="tnum text-muted-foreground">{formatDateTime(h.recorded_at)}</span>
                <StatusPill map={FORECAST_HISTORY_KIND} value={h.kind} />
                {h.review_context && h.review_context !== "review" && <span className="text-muted-foreground">at {h.review_context === "create" ? "creation" : h.review_context === "quote" ? "quote" : "stage change"}</span>}
                <span>
                  {h.expected_close_date ? formatDate(h.expected_close_date) : "no date"} · {h.probability_band ? titleCase(h.probability_band) : "likelihood unknown"} · {h.estimated_value !== null ? formatMoney(h.estimated_value, h.currency) : "value unknown"}
                </span>
                <span className="text-muted-foreground">{names.get(h.actor_id ?? "") ?? (h.kind === "baseline" ? "history began" : "system")}</span>
                {h.evidence && h.kind === "review" && <span className="italic text-muted-foreground">“{h.evidence}”</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Unweighted and not a sale. See every open forecast in <Link href="/sales/pipeline/forecast" className="underline">Weekly forecast</Link>.
      </p>
      {open && (
        <ForecastReviewDialog
          open
          onOpenChange={setOpen}
          target={{
            id: opp.id,
            name: opp.name,
            version: opp.version,
            expected_close_date: opp.expected_close_date,
            probability_band: opp.probability_band,
            estimated_value: opp.estimated_value,
            currency: opp.currency,
            evidence: opp.forecast_evidence,
            next_action: opp.next_action,
            next_action_due_at: opp.next_action_due_at,
            reviewed_at: opp.forecast_reviewed_at,
            reviewed_by_name: names.get(opp.forecast_reviewed_by ?? "") ?? null,
          }}
        />
      )}
    </DrawerSection>
  );
}
