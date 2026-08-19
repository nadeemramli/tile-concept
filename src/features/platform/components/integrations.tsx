"use client";

import { useState } from "react";
import { Cable, CalendarDays, FolderOpen, Globe, MessageSquare, Pause, Play, Settings2, Video, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/patterns/status-pill";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { Field } from "@/components/patterns/field";
import { APP_MODE, CONNECTOR_STATUS } from "@/lib/domain/status-maps";
import { formatDateTime } from "@/lib/format";
import type { IntegrationRow } from "@/server/queries/platform";
import { toggleIntegrationAction, updateIntegrationAction } from "@/server/commands/platform";
import { useAction } from "@/features/catalog/use-action";
import { SimpleSelect } from "@/features/catalog/components/selects";

const PROVIDER_META: Record<string, { icon: LucideIcon; gate: string }> = {
  meta: { icon: MessageSquare, gate: "Phase 3 — requires Meta app review, page/form ownership, and webhook signature verification." },
  tiktok: { icon: Video, gate: "Phase 3 — requires an approved TikTok for Business developer app with lead-gen scopes." },
  website: { icon: Globe, gate: "Phase 3 — requires the website form handler and a signed server-to-server secret." },
  sql_account: { icon: Cable, gate: "Phase 5 — requires SQL Account API entitlement, a dedicated least-privilege API user, and the outbound local connector." },
  google_drive: { icon: FolderOpen, gate: "Phase 4 — requires a least-privilege service account and an allowlisted folder boundary." },
  supplier_web: { icon: Globe, gate: "Phase 4 — requires owner-approved domains and a terms/robots review per supplier." },
  calendar: { icon: CalendarDays, gate: "Phase 2+ — optional; internal booking remains authoritative." },
};

const CONTRACT = ["manifest", "test", "pull / webhook", "normalize", "reconcile", "retry", "rotate", "disable"];

export function IntegrationCards({ rows, canManage, members }: { rows: IntegrationRow[]; canManage: boolean; members: { user_id: string; full_name: string }[] }) {
  const [editFor, setEditFor] = useState<IntegrationRow | null>(null);
  const [owner, setOwner] = useState("");
  const [purpose, setPurpose] = useState("");
  const toggle = useAction(toggleIntegrationAction);
  const update = useAction(updateIntegrationAction, { onSuccess: () => setEditFor(null) });

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => {
          const meta = PROVIDER_META[c.provider] ?? { icon: Cable, gate: "Not yet scheduled." };
          const Icon = meta.icon;
          const contract = (c.config.contract as Record<string, boolean> | undefined) ?? {};
          return (
            <Card key={c.id} className="gap-3 px-4 py-3">
              <CardHeader className="p-0">
                <CardTitle className="flex items-start justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span>
                      <span className="block">{c.name}</span>
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {c.provider} · {c.direction}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusPill map={CONNECTOR_STATUS} value={c.status} />
                    <StatusPill map={APP_MODE} value={c.environment} />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-0 text-sm">
                <p className="text-muted-foreground">{c.business_purpose ?? "No business purpose recorded."}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd>{c.owner_name ?? "Unassigned"}</dd>
                  <dt className="text-muted-foreground">Last attempt</dt>
                  <dd className="tnum">{c.last_attempt_at ? formatDateTime(c.last_attempt_at) : "never"}</dd>
                  <dt className="text-muted-foreground">Last success</dt>
                  <dd>
                    <FreshnessBadge lastSuccessAt={c.last_success_at} slaMinutes={240} />
                  </dd>
                  <dt className="text-muted-foreground">Credential</dt>
                  <dd className="font-mono">{c.credential_ref ?? "none (reference only)"}</dd>
                  <dt className="text-muted-foreground">Scopes</dt>
                  <dd>{c.scopes.length ? c.scopes.join(", ") : "—"}</dd>
                </dl>
                {c.last_error && <p className="rounded border border-destructive/25 bg-destructive/10 px-2 py-1 text-xs text-destructive">{c.last_error}</p>}
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Connector contract (PRD §11.1)</div>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    {CONTRACT.map((k) => (
                      <li key={k} className="flex items-center gap-1.5">
                        <Checkbox checked={!!contract[k]} disabled aria-label={k} className="size-3.5" />
                        <span className={contract[k] ? "" : "text-muted-foreground"}>{k}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled>
                          <Settings2 className="size-3" aria-hidden /> Configure
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">{meta.gate}</TooltipContent>
                  </Tooltip>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={toggle.pending} onClick={() => toggle.run(c.id, c.status !== "paused")}>
                        {c.status === "paused" ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
                        {c.status === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditFor(c);
                          setOwner(c.owner_id ?? "");
                          setPurpose(c.business_purpose ?? "");
                        }}
                      >
                        Edit
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editFor?.name}</DialogTitle>
            <DialogDescription>Owner and business purpose. Credentials are never stored here — only a reference to the secret manager entry.</DialogDescription>
          </DialogHeader>
          <Field label="Owner">
            <SimpleSelect value={owner} onChange={setOwner} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} noneLabel="Unassigned" />
          </Field>
          <Field label="Business purpose">
            <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />
          </Field>
          <Field label="Credential reference (read-only)">
            <Input value={editFor?.credential_ref ?? ""} readOnly className="font-mono" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFor(null)}>
              Cancel
            </Button>
            <Button disabled={update.pending || !editFor} onClick={() => editFor && update.run(editFor.id, { owner_id: owner, business_purpose: purpose })}>
              {update.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
