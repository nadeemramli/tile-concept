"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog } from "@/features/crm/components/form-dialog";
import { searchCreativeOptionsAction } from "@/server/commands/creative";
import { fromLocalInput, toLocalInput } from "@/features/marketing/lib/time";
import { CREATIVE_CHANNELS, CREATIVE_LINK_TYPES, type CreativeDetail, type CreativeOptions, type CreativePublication } from "../types";
import { CHANNEL_LABELS, CREATIVE_SELECT_CLASS, LINK_LABELS, USE_LABELS } from "../presentation";
import { fieldChecked, fieldNullable, fieldText, useCreativeCommand, type CreativeOperation } from "./creative-forms";

export type CreativeDialogAction = "prepare" | "produce" | "condition" | "source_add" | "source_remove" | "link_add" | "link_remove" | "readiness" | "submit" | "review" | "reopen" | "publication_plan" | "publication_schedule" | "publication_publish" | "publication_cancel" | "external_action";
export interface CreativeDialogSelection { action: CreativeDialogAction; targetId?: string }
const TITLES: Record<CreativeDialogAction, string> = { prepare: "Move to preparation", produce: "Start production", condition: "Update work status", source_add: "Link a source or shoot", source_remove: "Remove source relationship", link_add: "Add a working link", link_remove: "Remove link", readiness: "Confirm source readiness", submit: "Submit a version for review", review: "Review submitted version", reopen: "Reopen for changes", publication_plan: "Plan a channel release", publication_schedule: "Record scheduled release", publication_publish: "Record published release", publication_cancel: "Cancel release", external_action: "Record external follow-up" };

function Agreement({ name, children, required = false, defaultChecked = false, onChange }: { name: string; children: React.ReactNode; required?: boolean; defaultChecked?: boolean; onChange?: (checked: boolean) => void }) {
  return <label className="flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed"><input type="checkbox" name={name} required={required} defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" /> <span>{children}</span></label>;
}
function Note({ label = "Reason / notes", name = "notes", required = true, defaultValue = "" }: { label?: string; name?: string; required?: boolean; defaultValue?: string }) {
  return <Field label={label} htmlFor={name} required={required}><Textarea id={name} name={name} required={required} minLength={required ? 2 : undefined} rows={3} defaultValue={defaultValue} /></Field>;
}
function UrlField({ name, label }: { name: string; label: string }) {
  return <Field label={label} htmlFor={name} required><Input type="url" name={name} id={name} required placeholder="https://…" /></Field>;
}

function SourceFields({ initialOptions }: { initialOptions: CreativeOptions }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ query: "", options: initialOptions, error: "" });
  const [source, setSource] = useState("");
  const [shoot, setShoot] = useState("");
  const isSearching = query !== result.query;
  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const res = await searchCreativeOptionsAction(query);
        if (current) setResult({ query, options: res.ok ? res.data : initialOptions, error: res.ok ? "" : res.error });
      } catch { if (current) setResult({ query, options: initialOptions, error: "Source search could not finish. Try again." }); }
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [query, initialOptions]);
  const options = result.options;
  return <>
    <Field label="Find a source" htmlFor="source_search" hint="Search accepted content opportunities and shoot titles. Existing relationships retain customer media permission."><Input id="source_search" value={query} onChange={(e) => { setQuery(e.target.value); setSource(""); setShoot(""); }} placeholder="Project or shoot title…" /></Field>
    <p role="status" className="text-xs text-muted-foreground">{isSearching ? "Searching…" : `${options.opportunities.length} of ${options.opportunities_total} opportunities · ${options.bookings.length} of ${options.bookings_total} shoots. Narrow the search if needed.`}</p>
    {result.error && <p role="alert" className="text-xs text-destructive">{result.error}</p>}
    <Field label="Content opportunity" htmlFor="content_opportunity_id"><select id="content_opportunity_id" name="content_opportunity_id" className={CREATIVE_SELECT_CLASS} value={source} onChange={(e) => { setSource(e.target.value); setShoot(""); }} disabled={isSearching}><option value="">Choose an opportunity or a shoot below</option>{options.opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></Field>
    <Field label="Shoot (optional)" htmlFor="shoot_booking_id"><select id="shoot_booking_id" name="shoot_booking_id" className={CREATIVE_SELECT_CLASS} value={shoot} onChange={(e) => setShoot(e.target.value)} disabled={isSearching}><option value="">No shoot selected</option>{options.bookings.filter((b) => !source || b.content_opportunity_id === source).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</select></Field>
    <p className="text-xs text-muted-foreground">A creative may use several sources. Add each separately so every customer’s allowed uses are checked.</p>
  </>;
}

function PlanFields({ publication, detail }: { publication?: CreativePublication; detail: CreativeDetail }) {
  return <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Channel" htmlFor="channel" required><select id="channel" name="channel" className={CREATIVE_SELECT_CLASS} defaultValue={publication?.channel ?? detail.channels[0] ?? "tiktok"}>{CREATIVE_CHANNELS.map((v) => <option key={v} value={v}>{CHANNEL_LABELS[v]}</option>)}</select></Field>
      <Field label="Account / destination" htmlFor="account_label" required><Input id="account_label" name="account_label" required maxLength={200} defaultValue={publication?.account_label ?? ""} placeholder="e.g. Tile Concept main account" /></Field>
    </div>
    <Field label="Intended use" htmlFor="intended_use" hint="Checked against each linked customer's media permission."><select id="intended_use" name="intended_use" className={CREATIVE_SELECT_CLASS} defaultValue={publication?.intended_use ?? "organic_social"}>{Object.entries(USE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    <Field label="Target release date" htmlFor="target_date" hint="A provisional plan. Leave blank to keep it in Unscheduled."><Input id="target_date" name="target_date" type="date" defaultValue={publication?.target_date ?? ""} /></Field>
  </>;
}

export function CreativeActionDialog({ selection, detail, options, onClose }: { selection: CreativeDialogSelection; detail: CreativeDetail; options: CreativeOptions; onClose: () => void }) {
  const router = useRouter();
  const run = useCreativeCommand(detail);
  const { action, targetId } = selection;
  const publication = detail.publications.find((p) => p.id === targetId);
  const latest = detail.versions[0];
  const hasScheduled = detail.publications.some((p) => p.status === "scheduled" || p.external_action_required);
  const [ready, setReady] = useState(detail.source_ready);
  const [condition, setCondition] = useState<string>(detail.condition);
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const execute = async (fd: FormData) => {
    let operation: CreativeOperation;
    switch (action) {
      case "prepare": operation = { action: "phase", data: { phase: "preparing" } }; break;
      case "produce": operation = { action: "phase", data: { phase: "in_production" } }; break;
      case "condition": operation = { action: "condition", data: { condition: condition as CreativeDetail["condition"], reason: fieldText(fd, "reason"), blocker_owner_id: fieldNullable(fd, "blocker_owner_id"), blocker_review_date: fieldNullable(fd, "blocker_review_date"), next_action: fieldText(fd, "next_action") } }; break;
      case "source_add": operation = { action: "source_add", data: { content_opportunity_id: fieldNullable(fd, "content_opportunity_id"), shoot_booking_id: fieldNullable(fd, "shoot_booking_id") } }; break;
      case "source_remove": operation = { action: "source_remove", data: { source_id: targetId!, reason: fieldText(fd, "reason") } }; break;
      case "link_add": operation = { action: "link_add", data: { kind: fieldText(fd, "kind") as typeof CREATIVE_LINK_TYPES[number], label: fieldText(fd, "label"), url: fieldText(fd, "url"), access_state: fieldText(fd, "access_state") as "not_checked" | "confirmed" | "problem" } }; break;
      case "link_remove": operation = { action: "link_remove", data: { link_id: targetId!, reason: fieldText(fd, "reason") } }; break;
      case "readiness": operation = { action: "readiness", data: { ready: fieldChecked(fd, "ready"), note: fieldText(fd, "note"), rights_confirmed: fieldChecked(fd, "rights_confirmed") } }; break;
      case "submit": operation = { action: "submit", data: { export_label: fieldText(fd, "export_label"), review_url: fieldText(fd, "review_url"), final_url: fieldText(fd, "final_url"), notes: fieldText(fd, "notes"), access_confirmed: fieldChecked(fd, "access_confirmed") as true, specific_export_confirmed: fieldChecked(fd, "specific_export_confirmed") as true } }; break;
      case "review": operation = { action: "review", data: { version_id: latest!.id, decision, notes: fieldText(fd, "notes"), restrictions_confirmed: fieldChecked(fd, "restrictions_confirmed") } }; break;
      case "reopen": operation = { action: "reopen", data: { reason: fieldText(fd, "reason"), external_cancellation_acknowledged: !hasScheduled || fieldChecked(fd, "external_cancellation_acknowledged") } }; break;
      case "publication_plan": operation = { action: "publication_plan", data: { publication_id: targetId ?? null, channel: fieldText(fd, "channel") as typeof CREATIVE_CHANNELS[number], account_label: fieldText(fd, "account_label"), intended_use: fieldText(fd, "intended_use") as CreativePublication["intended_use"], target_date: fieldNullable(fd, "target_date") } }; break;
      case "publication_schedule": operation = { action: "publication_schedule", data: { publication_id: targetId!, version_id: detail.approved_version_id!, scheduled_at: fromLocalInput(fieldText(fd, "scheduled_at")) ?? "", scheduling_method: fieldText(fd, "scheduling_method"), restrictions_confirmed: fieldChecked(fd, "restrictions_confirmed") } }; break;
      case "publication_publish": operation = { action: "publication_publish", data: { publication_id: targetId!, version_id: detail.approved_version_id!, published_at: fromLocalInput(fieldText(fd, "published_at")) ?? "", live_url: fieldText(fd, "live_url"), restrictions_confirmed: fieldChecked(fd, "restrictions_confirmed") } }; break;
      case "publication_cancel": operation = { action: "publication_cancel", data: { publication_id: targetId!, reason: fieldText(fd, "reason"), external_cancellation_acknowledged: publication?.status !== "scheduled" || fieldChecked(fd, "external_cancellation_acknowledged") } }; break;
      case "external_action": operation = { action: "external_action", data: { publication_id: targetId!, note: fieldText(fd, "note") } }; break;
    }
    return run(operation);
  };
  return <FormDialog open onOpenChange={(open) => !open && onClose()} title={TITLES[action]} description={detail.title} action={execute} onSuccess={() => router.refresh()} submitLabel={action === "submit" ? "Submit version" : action === "review" ? "Save review decision" : "Save"} className="sm:max-w-xl">
    {action === "prepare" && <p className="text-sm text-muted-foreground">The brief, owner, reviewer, format, channels and deadlines are checked before this creative is committed to preparation.</p>}
    {action === "produce" && <p className="text-sm text-muted-foreground">Source readiness must be confirmed, with accessible material and the required footage coverage. A completed shoot by itself is not enough.</p>}
    {action === "condition" && <>
      <Field label="Work status" htmlFor="condition"><select id="condition" value={condition} onChange={(e) => setCondition(e.target.value)} className={CREATIVE_SELECT_CLASS}><option value="active">Active</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option></select></Field>
      <Note name="reason" label="Reason" />
      <Field label="Next action" htmlFor="next_action"><Input id="next_action" name="next_action" defaultValue={detail.next_action ?? ""} required={condition === "blocked" || condition === "on_hold"} /></Field>
      <Field label="Responsible person" htmlFor="blocker_owner_id"><select id="blocker_owner_id" name="blocker_owner_id" defaultValue={detail.blocker_owner_id ?? detail.owner_id ?? ""} className={CREATIVE_SELECT_CLASS}><option value="">Choose a person</option>{options.members.filter((m) => m.can_write).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Review this blocker on" htmlFor="blocker_review_date"><Input id="blocker_review_date" name="blocker_review_date" type="date" defaultValue={detail.blocker_review_date ?? ""} /></Field>
      <p className="text-xs text-muted-foreground">Cancelled work stays in All Creatives. Cancel externally scheduled release plans before cancelling the creative.</p>
    </>}
    {action === "source_add" && <SourceFields initialOptions={options} />}
    {(action === "source_remove" || action === "link_remove") && <Note name="reason" label="Why is this being removed?" />}
    {action === "link_add" && <>
      <Field label="Link type" htmlFor="kind"><select id="kind" name="kind" className={CREATIVE_SELECT_CLASS} defaultValue="raw_footage">{CREATIVE_LINK_TYPES.map((k) => <option key={k} value={k}>{LINK_LABELS[k]}</option>)}</select></Field>
      <Field label="Label" htmlFor="label" required><Input name="label" id="label" required minLength={2} maxLength={200} /></Field>
      <UrlField name="url" label="Link" />
      <Field label="Access check" htmlFor="access_state"><select id="access_state" name="access_state" className={CREATIVE_SELECT_CLASS} defaultValue="not_checked"><option value="not_checked">Not checked</option><option value="confirmed">I confirmed the team can open it</option><option value="problem">Access problem</option></select></Field>
      <p className="text-xs text-muted-foreground">Drive, SharePoint and other HTTP(S) links are supported. File permissions remain with the provider; adding a link does not make it public.</p>
    </>}
    {action === "readiness" && <>
      <Agreement name="ready" defaultChecked={detail.source_ready} onChange={setReady}>Required footage/copy is complete and accessible for this deliverable.</Agreement>
      <Agreement name="rights_confirmed" required={ready}>I checked the rights and intended uses of all source material. Any customer material is linked to its original content opportunity.</Agreement>
      <Note name="note" label="Coverage and readiness notes" defaultValue={detail.source_readiness_note ?? ""} />
    </>}
    {action === "submit" && <>
      <Field label="Export / version label" htmlFor="export_label" required><Input id="export_label" name="export_label" required minLength={2} placeholder={`e.g. Kitchen reel v${detail.versions.length + 1}`} /></Field>
      <UrlField name="review_url" label="Review link" /><UrlField name="final_url" label="Specific export link" />
      <Note required={false} label="Handoff notes" />
      <Agreement name="access_confirmed" required>I confirmed the assigned reviewer can open both links.</Agreement>
      <Agreement name="specific_export_confirmed" required>These links identify this exact export, not only a changing folder. I will submit a new version if the content changes.</Agreement>
    </>}
    {action === "review" && <>
      <p className="text-sm">Reviewing {latest?.export_label ?? "current submission"}. Your decision and notes stay attached to this version.</p>
      <Field label="Decision" htmlFor="decision"><select id="decision" className={CREATIVE_SELECT_CLASS} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}><option value="approved">Approve this version</option><option value="changes_requested">Request changes</option></select></Field>
      <Note label={decision === "approved" ? "Approval notes" : "What needs to change?"} />
      <Agreement name="restrictions_confirmed" required={decision === "approved"}>I checked the content, factual claims and all customer media restrictions for the intended uses.</Agreement>
    </>}
    {action === "reopen" && <>
      <Note name="reason" label="What needs to change?" />
      <p className="text-xs text-muted-foreground">The next submission needs a fresh review. Published history stays attached to the version that was released.</p>
      {hasScheduled && <Agreement name="external_cancellation_acknowledged" required>I have cancelled or paused the affected posts in the external scheduler. The app cannot cancel them for me.</Agreement>}
    </>}
    {action === "publication_plan" && <PlanFields publication={publication} detail={detail} />}
    {action === "publication_schedule" && <>
      <Field label="Scheduled release time · MYT (UTC+8)" htmlFor="scheduled_at" required><Input id="scheduled_at" name="scheduled_at" type="datetime-local" required defaultValue={publication?.scheduled_at ? toLocalInput(publication.scheduled_at) : publication?.target_date ? `${publication.target_date}T09:00` : ""} /></Field>
      <Field label="Where / how is it scheduled?" htmlFor="scheduling_method" required><Textarea id="scheduling_method" name="scheduling_method" rows={2} required minLength={2} defaultValue={publication?.scheduling_method ?? ""} placeholder="e.g. Meta Business Suite, Instagram reel" /></Field>
      <Agreement name="restrictions_confirmed" required>I checked customer media permission for the scheduled date and arranged the approved version in the named scheduler.</Agreement>
    </>}
    {action === "publication_publish" && <>
      <Field label="Actual publication time · MYT (UTC+8)" htmlFor="published_at" required><Input id="published_at" name="published_at" type="datetime-local" required /></Field>
      <UrlField name="live_url" label="Live post URL" />
      <Agreement name="restrictions_confirmed" required>I opened the live post, checked it is the approved version, and confirmed the allowed uses still apply.</Agreement>
    </>}
    {action === "publication_cancel" && <>
      <Note name="reason" label="Cancellation reason" />
      {publication?.status === "scheduled" && <Agreement name="external_cancellation_acknowledged" required>I cancelled the post in its external scheduler.</Agreement>}
    </>}
    {action === "external_action" && <Note name="note" label="What did you cancel, remove or otherwise resolve externally?" />}
  </FormDialog>;
}
