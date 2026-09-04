"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, ExternalLink, MessageCircle, MoreHorizontal, Search, UserPlus, X } from "lucide-react";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Timeline, type TimelineItem } from "@/components/patterns/timeline";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { LEAD_STATUS } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/patterns/field";
import { CandidateList } from "@/features/inbox/components/candidate-list";
import { FormAnswers } from "@/features/inbox/components/form-answers";
import { mergeFormAnswers } from "@/features/inbox/lib/payload";
import { FOLLOW_UP_OPTIONS, followUpDueAt, followUpTaskTitle } from "@/features/inbox/lib/follow-up";
import { formatRelative, isOverdue, maskValue, titleCase } from "@/lib/format";
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

const TIMELINE_PREVIEW = 5;

export function LeadDrawer({ lead, intake, timeline, contact, members, initialSuggestions, onClose }: Props) {
  const router = useRouter();
  const { can } = useSession();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [candidates, setCandidates] = useState<IdentityCandidate[] | null>(initialSuggestions ?? null);
  // Set after a quick log so the follow-up card draws the eye; keyed by lead so it resets on switch.
  const [nudgeFollowUpFor, setNudgeFollowUpFor] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

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

  const canWrite = can("sales.write");
  const canReveal = can("contact.reveal");
  const terminal = ["converted", "disqualified", "duplicate"].includes(lead.status);
  const slaOverdue = !lead.first_response_at && isOverdue(lead.first_response_due_at);
  const whatsappUrl = canReveal
    ? buildWhatsAppUrl(
        lead.raw_phone_normalized ?? lead.raw_phone,
        buildLeadWhatsAppMessage({ name: lead.raw_name, interest: lead.interest, source: lead.source_channel }),
      )
    : null;

  // Prefer the human form/campaign name from the latest submission over the
  // concatenated source_detail string.
  const latestPayload = intake[0]?.payload;
  const sourceContext =
    (typeof latestPayload?.form_name === "string" && latestPayload.form_name) ||
    (typeof latestPayload?.campaign_name === "string" && latestPayload.campaign_name) ||
    lead.source_detail;
  const responseLine = lead.first_response_at
    ? `first contacted ${formatRelative(lead.first_response_at)}`
    : lead.contact_attempts > 0
      ? `${lead.contact_attempts} attempt${lead.contact_attempts === 1 ? "" : "s"}, no reply yet`
      : "not contacted yet";

  const answers = mergeFormAnswers(intake, { interest: lead.interest, notes: lead.notes });
  const nothingAsked = !lead.interest && !lead.notes && lead.product_interest.length === 0 && answers.length === 0;
  const openMatches = () => {
    setPanel("matches");
    if (!candidates)
      start(async () => {
        const r = await findLeadMatchesAction(lead.id);
        if (r.ok) setCandidates(r.data);
        else toast.error(r.error);
      });
  };
  const followUpOverdue = isOverdue(lead.next_follow_up_at);
  const visibleActivity = showAllActivity ? timeline : timeline.slice(0, TIMELINE_PREVIEW);

  return (
    <>
      <RecordDrawer
        open={!!lead}
        onOpenChange={(o) => !o && onClose()}
        width="xl"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.raw_name ?? lead.raw_company ?? "Inquiry"} <StatusPill map={LEAD_STATUS} value={lead.status} size="md" />
          </span>
        }
        description={`${titleCase(lead.source_channel)}${sourceContext ? ` · ${sourceContext}` : ""} · received ${formatRelative(lead.created_at)} · ${responseLine}`}
      >
        {/* Primary actions: what a rep does most, in the order they do it. */}
        <div className="flex flex-wrap items-center gap-2">
          {whatsappUrl && (
            <Button asChild size="sm" className="h-8">
              <a href={whatsappUrl} target="_blank" rel="noreferrer" title="Opens a pre-filled message; tap Done WhatsApp after sending">
                <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
              </a>
            </Button>
          )}
          {whatsappUrl && !terminal && canWrite && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={pending}
              title="One tap: records that you messaged this customer, under your name"
              onClick={() =>
                run(
                  () => logLeadResponseAction({ lead_id: lead.id, kind: "message", channel: "whatsapp", reached: false, body: "WhatsApp message sent" }),
                  () => setNudgeFollowUpFor(lead.id),
                )
              }
            >
              <Check className="size-3.5" aria-hidden /> Done WhatsApp
            </Button>
          )}
          {!terminal && canWrite && (
            <Button size="sm" variant={whatsappUrl ? "outline" : "default"} className="h-8" onClick={() => setPanel("respond")}>
              Log a call or email
            </Button>
          )}
          {lead.converted_opportunity_id && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link href={`/sales/pipeline?opportunity=${lead.converted_opportunity_id}`}>
                Open opportunity <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Button>
          )}
          {!terminal && (canWrite || can("sales.assign")) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8" aria-label="More actions">
                  <MoreHorizontal className="size-4" aria-hidden /> More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {can("sales.assign") && <DropdownMenuItem onSelect={() => setPanel("assign")}>Assign to a salesperson</DropdownMenuItem>}
                {canWrite && (
                  <DropdownMenuItem onSelect={openMatches}>
                    <Search className="size-3.5" aria-hidden /> Link to a customer record
                  </DropdownMenuItem>
                )}
                {canWrite && lead.status !== "qualified" && (
                  <DropdownMenuItem onSelect={() => run(() => qualifyLeadAction(lead.id))}>
                    <Check className="size-3.5" aria-hidden /> Mark as qualified
                  </DropdownMenuItem>
                )}
                {canWrite && (
                  <DropdownMenuItem disabled={!lead.contact_id} onSelect={() => setPanel("convert")} title={lead.contact_id ? undefined : "Link a customer record first"}>
                    <ArrowRight className="size-3.5" aria-hidden /> Convert to opportunity
                  </DropdownMenuItem>
                )}
                {canWrite && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setPanel("disqualify")}>
                      <X className="size-3.5" aria-hidden /> Disqualify
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {slaOverdue && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            This customer has been waiting {formatRelative(lead.first_response_due_at).replace(" ago", "")} past the 4-hour reply target. Message them now.
          </p>
        )}
        {lead.disqualified_reason && <p className="text-sm text-destructive">Disqualified: {lead.disqualified_reason}</p>}

        <div className="@container">
          <div className="grid gap-5 @3xl:grid-cols-[3fr_2fr]">
            {/* Left: who they are and what they want */}
            <div className="space-y-5">
              <DrawerSection title="Contact">
                <FactList
                  className="sm:grid-cols-3"
                  items={[
                    { label: "Phone", value: canReveal ? lead.raw_phone : maskValue(lead.raw_phone_normalized ?? lead.raw_phone, "phone"), mono: true },
                    { label: "Email", value: canReveal ? lead.raw_email : maskValue(lead.raw_email, "email"), mono: true },
                    { label: "Company", value: lead.raw_company },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">Salesperson </span>
                    {lead.owner_name ?? <span className="text-warning">Unassigned</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">Customer record </span>
                    {contact ? (
                      <>
                        <Link href={`/sales/contacts/${contact.id}`} className="font-medium hover:underline" title="Open the customer 360">
                          {contact.display_name}
                        </Link>
                        <span className="text-muted-foreground">
                          {" · "}
                          {titleCase(contact.lifecycle_state)}
                          {contact.customer_type ? `, ${titleCase(contact.customer_type).toLowerCase()}` : ""}
                        </span>
                      </>
                    ) : canWrite && !terminal ? (
                      <button type="button" className="text-info hover:underline" onClick={openMatches}>
                        Not linked yet — find or create
                      </button>
                    ) : (
                      "Not linked"
                    )}
                  </span>
                </div>
                {initialSuggestions && initialSuggestions.length > 0 && !contact && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground">Possible existing customers (not linked automatically):</p>
                    <CandidateList candidates={initialSuggestions} filter="contact" pickLabel="Link" busy={pending} onPick={(c) => run(() => linkLeadIdentityAction({ lead_id: lead.id, contact_id: c.entity_id }))} />
                  </div>
                )}
              </DrawerSection>

              <DrawerSection title="What they asked for">
                {lead.interest && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{lead.interest}</p>}
                {lead.product_interest.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {lead.product_interest.map((p) => (
                      <TonePill key={p} tone="neutral" dot={false} label={titleCase(p)} />
                    ))}
                  </div>
                )}
                {lead.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{lead.notes}</p>}
                <FormAnswers answers={answers} />
                {nothingAsked && <p className="text-sm text-muted-foreground">Nothing captured yet.</p>}
              </DrawerSection>
            </div>

            {/* Right: what happens next and what has happened */}
            <div className="space-y-5">
              <DrawerSection title="Follow-up">
                <div className={cn("rounded-md border px-3 py-2.5 text-sm transition-shadow", nudgeFollowUpFor === lead.id && !lead.next_follow_up_at && "ring-2 ring-brand")}>
                  {lead.next_follow_up_at ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn(followUpOverdue && "font-medium text-destructive")}>
                        {followUpOverdue ? "Overdue — was due" : "Due"} {formatRelative(lead.next_follow_up_at)}
                      </span>
                      <Link href={lead.next_follow_up_task_id ? `/sales/tasks?task=${lead.next_follow_up_task_id}` : "/sales/tasks"} className="shrink-0 text-xs text-info hover:underline">
                        Open task
                      </Link>
                    </div>
                  ) : terminal ? (
                    <span className="text-muted-foreground">No follow-up needed.</span>
                  ) : canWrite ? (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground">{nudgeFollowUpFor === lead.id ? "Logged. When should we remind you?" : "No reminder set. Remind me:"}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {FOLLOW_UP_OPTIONS.map((o) => (
                          <Button
                            key={o.key}
                            size="sm"
                            variant={o.emphasized ? "default" : "outline"}
                            className="h-7"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => scheduleLeadFollowUpAction({ lead_id: lead.id, due_at: followUpDueAt(o.days), title: followUpTaskTitle(lead) }),
                                () => setNudgeFollowUpFor(null),
                              )
                            }
                          >
                            {o.label}
                          </Button>
                        ))}
                        {nudgeFollowUpFor === lead.id && (
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setNudgeFollowUpFor(null)}>
                            Not needed
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No reminder set.</span>
                  )}
                </div>
              </DrawerSection>

              <DrawerSection
                title="Activity"
                action={
                  timeline.length > TIMELINE_PREVIEW ? (
                    <button type="button" className="text-[11px] text-info hover:underline" onClick={() => setShowAllActivity((v) => !v)}>
                      {showAllActivity ? "Show recent" : `Show all (${timeline.length})`}
                    </button>
                  ) : undefined
                }
              >
                <Timeline items={visibleActivity} emptyText="No messages or calls logged yet." />
              </DrawerSection>
            </div>
          </div>
        </div>
      </RecordDrawer>

      {/* Log response */}
      <LogResponseDialog open={panel === "respond"} onOpenChange={(o) => !o && setPanel(null)} leadId={lead.id} onDone={() => { setPanel(null); setNudgeFollowUpFor(lead.id); refresh(); }} />

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
            <DialogTitle>Link to a customer record</DialogTitle>
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
          <DialogTitle>Log a call or email</DialogTitle>
          <DialogDescription>Records the attempt under your name and updates the lead status.</DialogDescription>
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
        <UserPlus className="size-3.5" aria-hidden /> Create a new customer record from this inquiry
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
