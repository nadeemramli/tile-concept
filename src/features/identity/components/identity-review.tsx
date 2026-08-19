"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useQueryState, parseAsString } from "nuqs";
import { toast } from "sonner";
import { ArrowLeftRight, ExternalLink, GitMerge, ScanSearch, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { EmptyState } from "@/components/patterns/states";
import { CANDIDATE_CONFIDENCE, CANDIDATE_STATUS, LIFECYCLE_STATE, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, formatRelative, maskValue, titleCase } from "@/lib/format";
import { useSession } from "@/components/shell/session-context";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import type { MemberOption } from "@/features/crm/components/selects";
import type { CandidatePair, CandidateSide, MergeEventRow } from "@/server/queries/identity";
import { mergeContactsAction, rejectCandidateAction, scanDuplicatesAction, unmergeContactsAction } from "@/server/commands/identity";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<string, string> = { exact_phone: "Same phone", exact_email: "Same email", similar_name: "Similar name", exact_registration: "Same registration no.", similar_company: "Similar company", alias_company: "Alias match" };

export function IdentityReview({ pairs, events, members, status }: { pairs: CandidatePair[]; events: MergeEventRow[]; members: MemberOption[]; status: string }) {
  const { can } = useSession();
  const [, setStatus] = useQueryState("status", parseAsString.withDefault("suggested").withOptions({ shallow: false }));
  const [merging, setMerging] = useState<CandidatePair | null>(null);
  const [rejecting, setRejecting] = useState<CandidatePair | null>(null);
  const [unmerging, setUnmerging] = useState<MergeEventRow | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));
  const canMerge = can("identity.merge");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={status} onValueChange={(v) => setStatus(v)}>
          <TabsList>
            <TabsTrigger value="suggested">Suggested</TabsTrigger>
            <TabsTrigger value="confirmed">Merged</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await scanDuplicatesAction(200);
              if (res.ok) toast.success(res.message ?? "Scan complete");
              else toast.error(res.error);
            })
          }
        >
          <ScanSearch className="size-3.5" aria-hidden /> {pending ? "Scanning…" : "Scan for duplicates"}
        </Button>
      </div>

      {pairs.length === 0 ? (
        <EmptyState title={status === "suggested" ? "No duplicates waiting" : `No ${status} candidates`} description={status === "suggested" ? "New contacts and imports are checked automatically. Run a scan to re-check recent contacts." : "Decisions appear here once made."} />
      ) : (
        <ul className="space-y-3">
          {pairs.map((p) => (
            <li key={p.id}>
              <Card className="gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill map={CANDIDATE_CONFIDENCE} value={p.confidence} size="md" />
                  <span className="tnum text-xs text-muted-foreground">score {p.score}</span>
                  {p.reasons.map((r, i) => (
                    <span key={i} className="rounded-full border px-2 py-0.5 text-[11px]">
                      {REASON_LABEL[r.code] ?? r.code}
                    </span>
                  ))}
                  <StatusPill map={CANDIDATE_STATUS} value={p.status} className="ml-auto" />
                  <span className="tnum text-[11px] text-muted-foreground">suggested {formatRelative(p.created_at)}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                  <SideCard side={p.subject} label="New / subject" />
                  <div className="hidden items-center md:flex">
                    <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden />
                  </div>
                  <SideCard side={p.candidate} label="Existing / candidate" />
                </div>
                {p.status !== "suggested" && (
                  <p className="text-xs text-muted-foreground">
                    Decided {p.decided_at ? formatDateTime(p.decided_at) : ""} by {names.get(p.decided_by ?? "") ?? "—"}
                    {p.decision_note ? ` · “${p.decision_note}”` : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/sales/contacts/${p.subject.id}`} target="_blank">
                      <ExternalLink className="size-3.5" aria-hidden /> Open subject
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/sales/contacts/${p.candidate.id}`} target="_blank">
                      <ExternalLink className="size-3.5" aria-hidden /> Open candidate
                    </Link>
                  </Button>
                  {p.status === "suggested" && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setRejecting(p)}>
                        <X className="size-3.5" aria-hidden /> Not a duplicate
                      </Button>
                      <Button size="sm" className="ml-auto" disabled={!canMerge} title={canMerge ? undefined : "Only sales managers / admins can confirm a merge"} onClick={() => setMerging(p)}>
                        <GitMerge className="size-3.5" aria-hidden /> Merge…
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Merge history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No merges yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card text-sm">
            {events.map((e) => (
              <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", e.reversed_at && "opacity-70")}>
                <span className="tnum text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
                <Link href={`/sales/contacts/${e.merged_id}`} className="hover:underline">
                  {e.merged_name || "(merged)"}
                </Link>
                <span className="text-muted-foreground">→</span>
                <Link href={`/sales/contacts/${e.survivor_id}`} className="font-medium hover:underline">
                  {e.survivor_name || "(survivor)"}
                </Link>
                <span className="text-xs text-muted-foreground">by {names.get(e.actor_id ?? "") ?? "—"}</span>
                <span className="text-xs italic text-muted-foreground">“{e.reason}”</span>
                <span className="tnum text-[11px] text-muted-foreground">
                  moved:{" "}
                  {Object.entries(e.relinked)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${k} ${n}`)
                    .join(", ") || "nothing"}
                </span>
                {e.reversed_at ? (
                  <TonePill tone="warning" label={`reversed ${formatDate(e.reversed_at)}`} />
                ) : (
                  canMerge && (
                    <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setUnmerging(e)}>
                      <Undo2 className="size-3.5" aria-hidden /> Unmerge
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {merging && <MergeDialog pair={merging} onOpenChange={(o) => !o && setMerging(null)} />}
      {rejecting && (
        <FormDialog open onOpenChange={(o) => !o && setRejecting(null)} title="Not a duplicate" description="This becomes negative evidence so the same pair is not suggested again without new information." submitLabel="Confirm" action={async (fd) => rejectCandidateAction({ candidate_id: rejecting.id, ...formToObject(fd) })}>
          <Field label="Note (optional)" htmlFor="note">
            <Input id="note" name="note" placeholder="e.g. father and son share the house phone" />
          </Field>
        </FormDialog>
      )}
      {unmerging && (
        <FormDialog open onOpenChange={(o) => !o && setUnmerging(null)} title="Reverse merge" description={`Restore “${unmerging.merged_name}” as a separate contact. Contact points and account links move back; business records created after the merge stay with the survivor (see audit).`} submitLabel="Unmerge" destructive action={async (fd) => unmergeContactsAction({ merge_event_id: unmerging.id, ...formToObject(fd) })}>
          <Field label="Reason" htmlFor="reason" required>
            <Textarea id="reason" name="reason" rows={2} required />
          </Field>
        </FormDialog>
      )}
    </div>
  );
}

function SideCard({ side, label }: { side: CandidateSide; label: string }) {
  return (
    <div className="rounded-md border bg-background p-3 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {side.is_provisional && <TonePill tone="warning" label="provisional" />}
      </div>
      <div className="font-medium">{side.display_name}</div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Phones</dt>
        <dd className="font-mono tnum">{side.phones.map((p) => maskValue(p, "phone")).join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Emails</dt>
        <dd className="font-mono tnum">{side.emails.map((e) => maskValue(e, "email")).join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{titleCase(side.customer_type ?? "") || "—"}</dd>
        <dt className="text-muted-foreground">Lifecycle</dt>
        <dd>
          <StatusPill map={LIFECYCLE_STATE} value={side.lifecycle_state} />
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>{side.original_acquisition_source ? <StatusPill map={SOURCE_CHANNEL} value={side.original_acquisition_source} /> : "—"}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd className="tnum">{side.created_at ? formatDate(side.created_at) : "—"}</dd>
        <dt className="text-muted-foreground">Records</dt>
        <dd className="tnum">
          {side.opportunities} opp · {side.purchases} purchases
        </dd>
      </dl>
    </div>
  );
}

function MergeDialog({ pair, onOpenChange }: { pair: CandidatePair; onOpenChange: (o: boolean) => void }) {
  const older = new Date(pair.subject.created_at || 0) <= new Date(pair.candidate.created_at || 0) ? pair.subject : pair.candidate;
  const [survivor, setSurvivor] = useState<string>(older.id);
  const merged = survivor === pair.subject.id ? pair.candidate : pair.subject;
  const surv = survivor === pair.subject.id ? pair.subject : pair.candidate;
  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title="Merge contacts"
      description="The merged record is archived (not deleted) and all linked history moves to the survivor. This is reversible from merge history."
      submitLabel="Merge now"
      action={async (fd) => mergeContactsAction({ candidate_id: pair.id, survivor_id: survivor, merged_id: merged.id, reason: String(fd.get("reason") ?? "") })}
    >
      <Field label="Surviving record">
        <RadioGroup value={survivor} onValueChange={setSurvivor} className="gap-2">
          {[pair.subject, pair.candidate].map((s) => (
            <label key={s.id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm", survivor === s.id && "border-ring bg-accent/40")}>
              <RadioGroupItem value={s.id} className="mt-0.5" />
              <span>
                <span className="font-medium">{s.display_name}</span>
                <span className="block text-xs text-muted-foreground">
                  created {s.created_at ? formatDate(s.created_at) : "—"} · {s.opportunities} opp · {s.purchases} purchases{s.id === older.id ? " · older" : ""}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Field>
      <p className="text-xs text-muted-foreground">
        “{merged.display_name}” will be merged into “{surv.display_name}”. The earliest acquisition source is kept.
      </p>
      <Field label="Reason" htmlFor="reason" required hint="Recorded in the merge event and audit log">
        <Textarea id="reason" name="reason" rows={2} required placeholder="Same phone; customer confirmed both records are theirs" />
      </Field>
    </FormDialog>
  );
}
