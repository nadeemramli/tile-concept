"use client";

import { Check, CircleDashed, Minus, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/patterns/status-pill";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { Hint } from "@/components/patterns/explain";
import { formatDateTime } from "@/lib/format";

const HINTS = {
  checkpoint: "The last position read from the provider, so the next pull resumes where this one stopped and nothing is fetched twice.",
  credentialSet: "Only the name of the secret-manager entry appears here. The secret itself is never stored in this app.",
  credentialUnset: "No secret is configured. The connector cannot leave demo mode until one is set in the environment.",
  runs: "Pulls or webhook deliveries in the last seven days, and how many of them failed.",
  idempotency: "Sending the same submission twice has the same effect as sending it once. Each submission carries a key, so a retry never creates a second lead.",
} as const;
import { useAction } from "@/features/catalog/use-action";
import { sendTestSubmissionAction } from "@/server/commands/connectors";
import { cn } from "@/lib/utils";
import { CONNECTOR_STATUS, CONTRACT, CONTRACT_BY_PROVIDER, ENVIRONMENT, UNLOCKS, type ContractState } from "@/features/connectors/status";

import type { ConnectorRow } from "@/server/queries/connectors";

const CONTRACT_CLASS: Record<ContractState, string> = {
  built: "bg-success/12 text-success border-success/25",
  partial: "bg-warning/12 text-warning border-warning/25",
  planned: "bg-muted text-muted-foreground border-transparent",
};

const ICON: Record<ContractState, typeof Check> = { built: Check, partial: CircleDashed, planned: Minus };

export function ConnectorCards({ connectors, demoMode }: { connectors: ConnectorRow[]; demoMode: boolean }) {
  const test = useAction(sendTestSubmissionAction);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {connectors.map((c) => {
        const contract = CONTRACT_BY_PROVIDER[c.provider] ?? {};
        const isWebsite = c.provider === "website";
        return (
          <Card key={c.id} className="gap-3 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <StatusPill map={CONNECTOR_STATUS} value={c.status} />
                  <StatusPill map={ENVIRONMENT} value={c.environment} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.business_purpose ?? "No business purpose recorded."}</p>
              </div>
              <FreshnessBadge lastSuccessAt={c.last_success_at} slaMinutes={1440} label="last success" />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div>
                <dt className="text-muted-foreground">Direction</dt>
                <dd>{c.direction}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{c.owner_name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last attempt</dt>
                <dd className="tnum">{c.last_attempt_at ? formatDateTime(c.last_attempt_at) : "Never"}</dd>
              </div>
              <div>
                <Hint content={HINTS.checkpoint} focusable>
                  <dt className="text-muted-foreground">Checkpoint</dt>
                </Hint>
                <dd className="truncate font-mono text-[11px]">{c.checkpoint ?? "—"}</dd>
              </div>
              <div>
                <Hint content={HINTS.runs} focusable>
                  <dt className="text-muted-foreground">Runs (7d)</dt>
                </Hint>
                <dd className="tnum">
                  {c.runs_7d}
                  {c.failed_7d > 0 && <span className="text-destructive"> · {c.failed_7d} failed</span>}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Credential</dt>
                <dd className="truncate">
                  {c.credential_ref ? (
                    <Hint content={HINTS.credentialSet} focusable>
                      <span className="font-mono text-[11px]">{c.credential_ref}</span>
                    </Hint>
                  ) : (
                    <Hint content={HINTS.credentialUnset} focusable>
                      <span className="text-warning">Not set</span>
                    </Hint>
                  )}
                </dd>
              </div>
            </dl>

            {c.scopes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {c.scopes.map((s) => (
                  <span key={s} className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
                    {s}
                  </span>
                ))}
              </div>
            )}

            {c.last_error && <p className="rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">{c.last_error}</p>}

            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Connector contract</div>
              <ul className="flex flex-wrap gap-1.5">
                {CONTRACT.map((item) => {
                  const state = (contract[item.key] ?? "planned") as ContractState;
                  const Icon = ICON[state];
                  return (
                    <li key={item.key}>
                      <Hint content={{ title: `${item.label} — ${state}`, body: item.detail }} focusable>
                        <span
                          className={cn(
                            "inline-flex h-5 cursor-help items-center gap-1 rounded-full border px-2 text-[11px] font-medium",
                            CONTRACT_CLASS[state],
                          )}
                        >
                          <Icon className="size-3" aria-hidden /> {item.label}
                        </span>
                      </Hint>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="text-[11px] text-muted-foreground">{UNLOCKS[c.provider] ?? "No unlock notes recorded."}</p>

            {isWebsite && demoMode && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={test.pending} onClick={() => test.run()}>
                  <Send className="size-3.5" aria-hidden /> {test.pending ? "Sending…" : "Send a test submission"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Signs a synthetic payload and posts it at this app&rsquo;s own endpoint — proves signature, freshness and{" "}
                  <Hint content={HINTS.idempotency} focusable>
                    <span className="underline decoration-dotted underline-offset-2">idempotency</span>
                  </Hint>{" "}
                  without a provider.
                </span>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
