"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, ExternalLink, MapPin, MessageCircle, MoreHorizontal, Search, UserPlus } from "lucide-react";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Timeline, type TimelineItem } from "@/components/patterns/timeline";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { DisabledHint, Hint } from "@/components/patterns/explain";
import { LEAD_STATUS } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/patterns/field";
import { CandidateList } from "@/features/inbox/components/candidate-list";
import { FormAnswers } from "@/features/inbox/components/form-answers";
import { mergeFormAnswers } from "@/features/inbox/lib/payload";
import { InquiryWorkflow } from "./inquiry-workflow";
import { formatRelative, isOverdue, maskValue, titleCase } from "@/lib/format";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { useSession } from "@/components/shell/session-context";
import { VIEW_LABELS, whereIsLead } from "@/features/inbox/lib/whereabouts";
import type { LeadView } from "@/features/inbox/schema";
import type { IdentityCandidate, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { ProfileRef } from "@/server/queries/reference";
import {
  assignLeadAction,
  convertLeadAction,
  createContactForLeadAction,
  findLeadMatchesAction,
  linkLeadIdentityAction,
  qualifyLeadAction,
} from "@/server/commands/leads";

interface Props {
  lead: LeadRow | null;
  intake: IntakeEventRow[];
  timeline: TimelineItem[];
  contact: { id: string; display_name: string; lifecycle_state: string; customer_type: string | null } | null;
  members: ProfileRef[];
  initialSuggestions?: IdentityCandidate[];
  /** The inbox view the drawer was opened from, and whether the lead still appears in it. */
  view?: LeadView;
  inCurrentView?: boolean;
  onClose: () => void;
}

type Panel = null | "matches" | "convert" | "assign";

const TIMELINE_PREVIEW = 5;

const MASKED_HINT = "Shown masked because your role does not include contact.reveal. Revealing a phone number or email is audited with who, when and which record.";

export function LeadDrawer({ lead, intake, timeline, contact, members, initialSuggestions, view, inCurrentView, onClose }: Props) {
  const router = useRouter();
  const { can, session } = useSession();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const [candidates, setCandidates] = useState<IdentityCandidate[] | null>(initialSuggestions ?? null);
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

  // The inbox is shared for reading; acting on a lead stays with its owner, a
  // sales manager or an administrator (the database enforces the same rule).
  const isOwner = can("sales.read_all") || !lead.owner_id || lead.owner_id === session.userId;
  const OWNER_ONLY = `Only ${lead.owner_name ?? "the assigned salesperson"}, a sales manager or an administrator can act on this lead. You can still read it and message the customer.`;
  const canWrite = can("sales.write") && isOwner;
  const canReveal = can("contact.reveal");
  const where = whereIsLead(lead, session.userId);
  const viewHref = (v: LeadView) => `/sales/inbox?view=${v}&lead=${lead.id}`;
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
  const visibleActivity = showAllActivity ? timeline : timeline.slice(0, TIMELINE_PREVIEW);

  return (
    <>
      <RecordDrawer
        open={!!lead}
        onOpenChange={(o) => !o && onClose()}
        width="xl"
        className="data-[side=right]:w-full"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.raw_name ?? lead.raw_company ?? "Inquiry"} <StatusPill map={LEAD_STATUS} value={lead.status} size="md" />
          </span>
        }
        description={`${titleCase(lead.source_channel)}${sourceContext ? ` · ${sourceContext}` : ""} · received ${formatRelative(lead.created_at)} · ${responseLine}`}
      >
        {/* Where the lead lives now, so a response never makes it vanish. */}
        {view && inCurrentView === false && view !== "all" && view !== where.home && (
          <p className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm">
            This inquiry is outside the current results. Its stage is available under{" "}
            <Link href={viewHref(where.home)} className="font-medium underline underline-offset-2">
              {VIEW_LABELS[where.home]}
            </Link>
            .
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden />
          <span>In view</span>
          <Link href={viewHref(where.home)} className="font-medium text-foreground hover:underline">
            {VIEW_LABELS[where.home]}
          </Link>
          {where.also.map((v) => (
            <Link key={v} href={viewHref(v)} className="rounded bg-muted px-1.5 py-0.5 hover:underline">
              {VIEW_LABELS[v]}
            </Link>
          ))}
          <span>·</span>
          {lead.owner_id ? (
            <span>owner {lead.owner_id === session.userId ? "you" : (lead.owner_name ?? "set")}</span>
          ) : (
            <Hint content="Nobody has been assigned. The first person to log a message or call becomes the owner, and the lead then appears under their My leads." focusable>
              <span>no owner yet</span>
            </Hint>
          )}
          {!terminal && !lead.next_follow_up_at && <span>· no reminder</span>}
        </p>

        {/* Primary actions: what a rep does most, in the order they do it. */}
        <div className="flex flex-wrap items-center gap-2">
          {whatsappUrl && (
            <Hint content="Opens WhatsApp with a pre-filled message. Sending it is not recorded here; record WhatsApp sent in Next action and progress afterwards.">
              <Button asChild size="sm" className="h-8">
                <a href={whatsappUrl} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
                </a>
              </Button>
            </Hint>
          )}
          {!terminal && !isOwner && (
            <DisabledHint reason={OWNER_ONLY}>
              <Button size="sm" variant={whatsappUrl ? "outline" : "default"} className="h-8" disabled>
                Log a call or email
              </Button>
            </DisabledHint>
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
                  <DropdownMenuItem disabled={!lead.contact_id} onSelect={() => setPanel("convert")}>
                    <ArrowRight className="size-3.5" aria-hidden /> Convert to opportunity
                    {!lead.contact_id && <span className="ml-1 text-[11px] text-muted-foreground">— link a customer record first</span>}
                  </DropdownMenuItem>
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
        {lead.disqualified_reason && <p className="text-sm text-destructive">Lost: {lead.disqualified_reason}</p>}

        <div className="@container">
          <div className="grid gap-5 @3xl:grid-cols-[3fr_2fr]">
            {/* Left: who they are and what they want */}
            <div className="space-y-5">
              <DrawerSection title="Contact">
                <FactList
                  className="sm:grid-cols-3"
                  items={[
                    {
                      label: "Phone",
                      value: canReveal ? (
                        lead.raw_phone
                      ) : (
                        <Hint content={MASKED_HINT} focusable>
                          <span>{maskValue(lead.raw_phone_normalized ?? lead.raw_phone, "phone")}</span>
                        </Hint>
                      ),
                      mono: true,
                    },
                    {
                      label: "Email",
                      value: canReveal ? (
                        lead.raw_email
                      ) : (
                        <Hint content={MASKED_HINT} focusable>
                          <span>{maskValue(lead.raw_email, "email")}</span>
                        </Hint>
                      ),
                      mono: true,
                    },
                    { label: "Company", value: lead.raw_company },
                  ]}
                />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">Salesperson </span>
                    {lead.owner_name ?? (
                      <Hint content="No salesperson owns this lead yet, so nobody is on the clock. A sales manager assigns it from More, or a rep picks it up." focusable>
                        <span className="text-warning">Unassigned</span>
                      </Hint>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">Customer record </span>
                    {contact ? (
                      <>
                        <Hint content="Open the customer 360: every inquiry, visit, purchase and consent for this person.">
                          <Link href={`/sales/contacts/${contact.id}`} className="font-medium hover:underline">
                            {contact.display_name}
                          </Link>
                        </Hint>
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
            <div className="order-first space-y-5 @3xl:order-last">
              <InquiryWorkflow key={lead.id} lead={lead} canWrite={canWrite} />

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
        <DisabledHint reason={owner ? null : "Choose a salesperson first."}>
          <Button disabled={!owner || pending} onClick={() => onAssign(owner, reason || undefined)}>
            Assign
          </Button>
        </DisabledHint>
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
        <DisabledHint reason={reason.trim().length < min ? `The reason needs at least ${min} characters. It is kept in the audit trail.` : null}>
          <Button variant={destructive ? "destructive" : "default"} disabled={reason.trim().length < min || pending} onClick={() => onSubmit(reason.trim())}>
            {submitLabel}
          </Button>
        </DisabledHint>
      </DialogFooter>
    </div>
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
        <DisabledHint reason={name.trim().length < 2 ? "Enter the customer's name (at least 2 characters) first." : null}>
          <Button size="sm" className="h-8" disabled={name.trim().length < 2 || pending} onClick={() => onCreate(name.trim(), type)}>
            Create & link
          </Button>
        </DisabledHint>
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
  const blocker =
    projectName.trim().length < 2
      ? "Give the project a name (at least 2 characters)."
      : oppName.trim().length < 2
        ? "Give the opportunity a name (at least 2 characters)."
        : nextAction.trim().length < 2
          ? "Every active opportunity needs a next action. Say what happens next."
          : !due
            ? "Set when the next action is due."
            : null;
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
        <DisabledHint reason={blocker}>
          <Button
            disabled={pending || !!blocker}
            onClick={() => onSubmit({ project_name: projectName.trim(), opportunity_name: oppName.trim(), estimated_value: value ? Number(value) : undefined, next_action: nextAction.trim(), next_action_due_at: due })}
          >
            {pending ? "Converting…" : "Create opportunity"}
          </Button>
        </DisabledHint>
      </DialogFooter>
    </div>
  );
}
