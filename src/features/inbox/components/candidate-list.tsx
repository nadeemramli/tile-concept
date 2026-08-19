"use client";

import { Building2, Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { CANDIDATE_CONFIDENCE, LIFECYCLE_STATE } from "@/lib/domain/status-maps";
import { formatRelative } from "@/lib/format";
import type { IdentityCandidate } from "@/features/inbox/types";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<string, string> = {
  exact_phone: "Same phone",
  exact_email: "Same email",
  similar_name: "Similar name",
  exact_registration: "Same registration no.",
  similar_company: "Similar company",
  alias_company: "Known alias",
};

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
    return <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No matching {filter ?? "contact or account"} records. Safe to create a new one.</p>;
  }
  return (
    <ul className={cn("divide-y rounded-md border", className)}>
      {rows.map((c) => (
        <li key={`${c.entity_type}-${c.entity_id}`} className="flex items-start gap-3 px-3 py-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
            {c.entity_type === "account" ? <Building2 className="size-3.5 text-muted-foreground" aria-hidden /> : <Contact className="size-3.5 text-muted-foreground" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">{c.display_name}</span>
              <StatusPill map={CANDIDATE_CONFIDENCE} value={c.confidence} />
              {c.lifecycle_state && <StatusPill map={LIFECYCLE_STATE} value={c.lifecycle_state} />}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tnum">
              {c.masked_phone && <span className="font-mono">{c.masked_phone}</span>}
              {c.masked_email && <span className="font-mono">{c.masked_email}</span>}
              {c.last_activity_at && <span>last activity {formatRelative(c.last_activity_at)}</span>}
              <span>score {c.score}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.reasons.map((r, i) => (
                <TonePill key={i} tone="neutral" dot={false} label={REASON_LABEL[r.code] ?? r.code} />
              ))}
            </div>
          </div>
          {onPick && (
            <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={busy} onClick={() => onPick(c)}>
              {pickLabel}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
