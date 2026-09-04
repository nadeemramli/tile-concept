"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, ExternalLink, MessageCircle, Search, UserPlus, X } from "lucide-react";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Timeline, type TimelineItem } from "@/components/patterns/timeline";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { LEAD_STATUS, LIFECYCLE_STATE } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/patterns/field";
import { CandidateList } from "@/features/inbox/components/candidate-list";
import { IntakeAnswers } from "@/features/inbox/components/intake-answers";
import { FOLLOW_UP_OPTIONS, followUpDueAt, followUpTaskTitle } from "@/features/inbox/lib/follow-up";
import { formatDateTime, formatRelative, isOverdue, maskValue, titleCase } from "@/lib/format";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { useSession } from "@/components/shell/session-context";
import { cn } from "@/lib/utils";
import type { IdentityCandidate, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { ProfileRef } from "@/server/queries/reference";
import {
  assignLeadAction,
  convertLeadAction,
  createContactForLeadAction,
  disqualifyLeadAction,
  findLeadMatchesAction,
  linkLeadIdentityAction,
  logLeadResponseAction,
  qualifyLeadAction,
  scheduleLeadFollowUpAction,
} from "@/server/commands/leads";

interface Props {
  lead: LeadRow | null;
  intake: IntakeEventRow[];
  timeline: TimelineItem[];
  contact: { id: string; display_name: string; lifecycle_state: string; customer_type: string | null } | null;
  members: ProfileRef[];
  initialSuggestions?: IdentityCandidate[];
  onClose: () => void;
}

type Panel = null | "respond" | "disqualify" | "matches" | "convert" | "assign";

export function LeadDrawer({ lead, intake, timeline, contact, members, initialSuggestions, onClose }: Props) {
  const router = useRouter();
  const { can } = useSession();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [candidates, setCandidates] = useState<IdentityCandidate[] | null>(initialSuggestions ?? null);
  const [followUpPromptLeadId, setFollowUpPromptLeadId] = useState<string | null>(null);

  if (!lead) return null;

  const refresh = () => router.refresh();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
      else {
        if (r.message) toast.success(r.message);
        after?.();
        refresh();
      }
    });

  const terminal = ["converted", "disqualified", "duplicate"].includes(lead.status);
  const slaOverdue = !lead.first_response_at && isOverdue(lead.first_response_due_at);
  const whatsappUrl = can("contact.reveal")
    ? buildWhatsAppUrl(
        lead.raw_phone_normalized ?? lead.raw_phone,
        buildLeadWhatsAppMessage({ name: lead.raw_name, interest: lead.interest, source: lead.source_channel }),
      )
    : null;

  // Prefer the human form/campaign name from the latest intake event over the
  // concatenated source_detail string.
  const latestPayload = intake[0]?.payload;
  const sourceContext =
    (typeof latestPayload?.form_name === "string" && latestPayload.form_name) ||
    (typeof latestPayload?.campaign_name === "string" && latestPayload.campaign_name) ||
    lead.source_detail;

  return (
    <>
      <RecordDrawer
        open={!!lead}
        onOpenChange={(o) => !o && onClose()}
        width="lg"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.raw_name ?? lead.raw_company ?? "Inquiry"} <StatusPill map={LEAD_STATUS} value={lead.status} size="md" />
          </span>
        }
        description={`${titleCase(lead.source_channel)}${sourceContext ? ` · ${sourceContext}` : ""} · received ${formatRelative(lead.created_at)}`}
      >
        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {whatsappUrl && (
            <Button asChild size="sm" className="h-7">
              <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Opens a pre-filled message; use Done WhatsApp after sending">
                <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
              </a>
            </Button>
          )}
          {whatsappUrl && !terminal && can("sales.write") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={pending}
              title="One click: logs a WhatsApp attempt in the timeline under your name"
              onClick={() =>
                run(
                  () => logLeadResponseAction({ lead_id: lead.id, kind: "message", channel: "whatsapp", reached: false, body: "WhatsApp message sent" }),
                  () => setFollowUpPromptLeadId(lead.id),
                )
              }
            >
              <Check className="size-3.5" aria-hidden /> Done WhatsApp
            </Button>
          )}
          {!terminal && can("sales.write") && (
            <Button size="sm" variant={whatsappUrl ? "outline" : "default"} className="h-7" onClick={() => setPanel("respond")}>
              Log response
            </Button>
          )}
          {!terminal && can("sales.assign") && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setPanel("assign")}>
              Assign
            </Button>
          )}
          {!terminal && can("sales.write") && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => {
                setPanel("matches");
                if (!candidates) start(async () => {
                  const r = await findLeadMatchesAction(lead.id);
                  if (r.ok) setCandidates(r.data);
                  else toast.error(r.error);
                });
              }}
            >
              <Search className="size-3.5" aria-hidden /> Find matches
            </Button>
          )}
          {!terminal && lead.status !== "qualified" && can("sales.write") && (
            <Button size="sm" variant="outline" className="h-7" disabled={pending} onClick={() => run(() => qualifyLeadAction(lead.id))}>
              <Check className="size-3.5" aria-hidden /> Qualify
            </Button>
          )}
          {!terminal && can("sales.write") && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setPanel("convert")} disabled={!lead.contact_id} title={lead.contact_id ? undefined : "Link a contact first"}>
              <ArrowRight className="size-3.5" aria-hidden /> Convert
            </Button>
          )}
          {!terminal && can("sales.write") && (
            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => setPanel("disqualify")}>
              <X className="size-3.5" aria-hidden /> Disqualify
            </Button>
          )}
          {lead.converted_opportunity_id && (
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link href={`/sales/pipeline?opportunity=${lead.converted_opportunity_id}`}>
                Open opportunity <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Button>
          )}
        </div>

        {/* Follow-up chips, shown right after a quick log */}
        {followUpPromptLeadId === lead.id && !terminal && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Follow up:</span>
            {FOLLOW_UP_OPTIONS.map((o) => (
              <Button
                key={o.key}
                size="sm"
                variant={o.emphasized ? "default" : "outline"}
                className="h-6 px-2 text-xs"
                disabled={pending}
                onClick={() =>
                  run(
                    () => scheduleLeadFollowUpAction({ lead_id: lead.id, due_at: followUpDueAt(o.days), title: followUpTaskTitle(lead) }),
                    () => setFollowUpPromptLeadId(null),
                  )
                }
              >
                {o.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={pending} onClick={() => setFollowUpPromptLeadId(null)}>
              No follow-up
            </Button>
          </div>
        )}

        {slaOverdue && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            First-response SLA overdue — due {formatRelative(lead.first_response_due_at)}. Log a response attempt.
          </p>
        )}

        <DrawerSection title="Contact & follow-up">
          <FactList
            items={[
              { label: "Name", value: lead.raw_name },
              { label: "Phone", value: can("contact.reveal") ? lead.raw_phone : maskValue(lead.raw_phone_normalized ?? lead.raw_phone, "phone"), mono: true },
              { label: "Email", value: can("contact.reveal") ? lead.raw_email : maskValue(lead.raw_email, "email"), mono: true },
              { label: "Company", value: lead.raw_company },
              { label: "Owner", value: lead.owner_name ?? "Unassigned" },
              {
                label: "Next follow-up",
                value: lead.next_follow_up_at ? (
                  <Link
                    href={lead.next_follow_up_task_id ? `/sales/tasks?task=${lead.next_follow_up_task_id}` : "/sales/tasks"}
                    className={cn("hover:underline", isOverdue(lead.next_follow_up_at) && "font-medium text-destructive")}
                  >
                    due {formatRelative(lead.next_follow_up_at)}
                  </Link>
                ) : (
                  "None scheduled"
                ),
              },
              { label: "Attempts", value: String(lead.contact_attempts) },
              { label: "First response due", value: lead.first_response_due_at ? formatDateTime(lead.first_response_due_at) : "—" },
              { label: "First responded", value: lead.first_response_at ? formatDateTime(lead.first_response_at) : "Not yet" },
            ]}
          />
        </DrawerSection>

        <DrawerSection title={`Form answers (${intake.length})`}>
          <IntakeAnswers intake={intake} maskContacts={!can("contact.reveal")} />
        </DrawerSection>

        <DrawerSection title="Identity">
          {contact ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <Link href={`/sales/contacts/${contact.id}`} className="text-sm font-medium hover:underline">
                  {contact.display_name}
                </Link>
                <div className="flex gap-1.5 pt-0.5">
                  <StatusPill map={LIFECYCLE_STATE} value={contact.lifecycle_state} />
                  {contact.customer_type && <TonePill tone="neutral" dot={false} label={titleCase(contact.customer_type)} />}
                </div>
              </div>
              <Button asChild size="sm" variant="ghost" className="h-7">
                <Link href={`/sales/contacts/${contact.id}`}>Open 360</Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not linked to a contact yet. Use <em>Find matches</em> to resolve safely or create a new contact.</p>
          )}
          {initialSuggestions && initialSuggestions.length > 0 && !contact && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Suggested matches from capture (not auto-linked):</p>
              <CandidateList candidates={initialSuggestions} filter="contact" pickLabel="Link" busy={pending} onPick={(c) => run(() => linkLeadIdentityAction({ lead_id: lead.id, contact_id: c.entity_id }))} />
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Details">
          <FactList
            items={[
              { label: "Product interest", value: lead.product_interest.length ? lead.product_interest.map(titleCase).join(", ") : "—" },
              { label: "Qualified", value: lead.qualified_at ? formatDateTime(lead.qualified_at) : "—" },
            ]}
          />
          {lead.interest && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{lead.interest}</p>}
          {lead.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{lead.notes}</p>}
          {lead.disqualified_reason && <p className="text-sm text-destructive">Disqualified: {lead.disqualified_reason}</p>}
        </DrawerSection>

        <DrawerSection title="Timeline">
          <Timeline items={timeline} emptyText="No responses or notes yet." />
        </DrawerSection>
      </RecordDrawer>

      {/* Log response */}
      <LogResponseDialog open={panel === "respond"} onOpenChange={(o) => !o && setPanel(null)} leadId={lead.id} onDone={() => { setPanel(null); refresh(); }} />

      {/* Assign */}
      <Dialog open={panel === "assign"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign lead</DialogTitle>
            <DialogDescription>Sets the owner and starts the first-response clock if not already running.</DialogDescription>
          </DialogHeader>
          <AssignForm members={members} current={lead.owner_id} pending={pending} onAssign={(owner, reason) => run(() => assignLeadAction({ lead_id: lead.id, owner_id: owner, reason }), () => setPanel(null))} />
        </DialogContent>
      </Dialog>

      {/* Disqualify */}
      <Dialog open={panel === "disqualify"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disqualify lead</DialogTitle>
            <DialogDescription>A reason is required and becomes part of the audit trail.</DialogDescription>
          </DialogHeader>
          <ReasonForm label="Reason" submitLabel="Disqualify" destructive pending={pending} onSubmit={(reason) => run(() => disqualifyLeadAction({ lead_id: lead.id, reason }), () => setPanel(null))} />
        </DialogContent>
      </Dialog>

      {/* Matches */}
      <Dialog open={panel === "matches"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Resolve identity</DialogTitle>
            <DialogDescription>Exact phone/email matches are high confidence; names alone are never enough. Pick the right record or create a new one.</DialogDescription>
          </DialogHeader>
          {candidates === null ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Contacts</div>
                <CandidateList
                  candidates={candidates}
                  filter="contact"
                  pickLabel="Link contact"
                  busy={pending}
                  onPick={(c) => run(() => linkLeadIdentityAction({ lead_id: lead.id, contact_id: c.entity_id }), () => setPanel(null))}
                />
              </div>
              {candidates.some((c) => c.entity_type === "account") && (
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Accounts</div>
                  <CandidateList
                    candidates={candidates}
                    filter="account"
                    pickLabel="Link account"
                    busy={pending}
                    onPick={(c) => run(() => linkLeadIdentityAction({ lead_id: lead.id, account_id: c.entity_id }), () => setPanel(null))}
                  />
                </div>
              )}
              <CreateContactInline
                defaultName={lead.raw_name ?? ""}
                pending={pending}
                onCreate={(name, type) => run(() => createContactForLeadAction({ lead_id: lead.id, display_name: name, customer_type: type }), () => setPanel(null))}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert */}
      <Dialog open={panel === "convert"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert to project opportunity</DialogTitle>
            <DialogDescription>Creates a project and an opportunity at the Qualified stage, linked to {contact?.display_name ?? "the contact"}. The original source is preserved.</DialogDescription>
          </DialogHeader>
          <ConvertForm
            lead={lead}
            pending={pending}
            onSubmit={(v) =>
              start(async () => {
                const r = await convertLeadAction({ lead_id: lead.id, contact_id: lead.contact_id!, account_id: lead.account_id ?? "", ...v });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.message);
                setPanel(null);
                router.push(`/sales/pipeline?opportunity=${r.data.opportunity_id}`);
              })
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssignForm({ members, current, pending, onAssign }: { members: ProfileRef[]; current: string | null; pending: boolean; onAssign: (owner: string, reason?: string) => void }) {
  const [owner, setOwner] = useState(current ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Owner" required>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="h-8"><SelectValue placeholder="Choose a salesperson" /></SelectTrigger>
          <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Reason (optional)">
        <Input className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Workload, language, location…" />
      </Field>
      <DialogFooter>
        <Button disabled={!owner || pending} onClick={() => onAssign(owner, reason || undefined)}>Assign</Button>
      </DialogFooter>
    </div>
  );
}

export function ReasonForm({ label, submitLabel, destructive, pending, onSubmit, min = 3 }: { label: string; submitLabel: string; destructive?: boolean; pending: boolean; onSubmit: (reason: string) => void; min?: number }) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <Field label={label} required hint={`At least ${min} characters`}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <DialogFooter>
        <Button variant={destructive ? "destructive" : "default"} disabled={reason.trim().length < min || pending} onClick={() => onSubmit(reason.trim())}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

function LogResponseDialog({ open, onOpenChange, leadId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string; onDone: () => void }) {
  const [kind, setKind] = useState<"call" | "message" | "email" | "meeting">("call");
  const [channel, setChannel] = useState<"phone" | "whatsapp" | "email" | "dm" | "meeting">("phone");
  const [reached, setReached] = useState(true);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log response</DialogTitle>
          <DialogDescription>Records the attempt, updates first-response time and lead status.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Channel">
            <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="dm">DM</SelectItem>
                <SelectItem value="meeting">In person</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <div className="text-sm">Customer reached</div>
            <div className="text-[11px] text-muted-foreground">Off = attempt only (status: Contact attempted)</div>
          </div>
          <Switch checked={reached} onCheckedChange={setReached} aria-label="Customer reached" />
        </div>
        <Field label="Notes">
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What was discussed, next step…" />
        </Field>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await logLeadResponseAction({ lead_id: leadId, kind, channel, reached, body });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.message);
                setBody("");
                onDone();
              })
            }
          >
            {pending ? "Saving…" : "Log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateContactInline({ defaultName, pending, onCreate }: { defaultName: string; pending: boolean; onCreate: (name: string, type: string | null) => void }) {
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<string>("homeowner");
  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <UserPlus className="size-3.5" aria-hidden /> Create a new contact from this inquiry
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["homeowner", "contractor", "designer", "developer", "retailer", "architect", "other"].map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8" disabled={name.trim().length < 2 || pending} onClick={() => onCreate(name.trim(), type)}>
          Create & link
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Phone/email from the inquiry become contact points; duplicate suggestions are generated for review.</p>
    </div>
  );
}

function ConvertForm({ lead, pending, onSubmit }: { lead: LeadRow; pending: boolean; onSubmit: (v: { project_name: string; opportunity_name: string; estimated_value?: number; next_action: string; next_action_due_at: string }) => void }) {
  const base = lead.raw_name ?? lead.raw_company ?? "Inquiry";
  const [projectName, setProjectName] = useState(`${base} — ${lead.interest?.slice(0, 40) || "project"}`);
  const [oppName, setOppName] = useState(`${base} — ${lead.product_interest.map(titleCase).join("/") || "opportunity"}`);
  const [value, setValue] = useState("");
  const [nextAction, setNextAction] = useState("Schedule consultation");
  const [due, setDue] = useState(() => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16));
  return (
    <div className="space-y-3">
      <Field label="Project / site name" required>
        <Input className="h-8" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </Field>
      <Field label="Opportunity name" required>
        <Input className="h-8" value={oppName} onChange={(e) => setOppName(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Estimated value (MYR)">
          <Input className="h-8 tnum" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Next action due" required>
          <Input className="h-8" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <Field label="Next action" required>
        <Input className="h-8" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button
          disabled={pending || projectName.trim().length < 2 || oppName.trim().length < 2 || nextAction.trim().length < 2 || !due}
          onClick={() => onSubmit({ project_name: projectName.trim(), opportunity_name: oppName.trim(), estimated_value: value ? Number(value) : undefined, next_action: nextAction.trim(), next_action_due_at: due })}
        >
          {pending ? "Converting…" : "Create opportunity"}
        </Button>
      </DialogFooter>
    </div>
  );
}
