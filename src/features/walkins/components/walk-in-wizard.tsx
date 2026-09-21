"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Phone, Plus, Trash2, UserPlus, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { DisabledHint, Hint } from "@/components/patterns/explain";
import { CandidateList } from "@/features/inbox/components/candidate-list";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { SOURCE_CHANNEL, LIFECYCLE_STATE, statusMeta } from "@/lib/domain/status-maps";
import { formatMoney, titleCase } from "@/lib/format";
import { normalizePhone } from "@/lib/identity/normalize";
import { useSession } from "@/components/shell/session-context";
import { cn } from "@/lib/utils";
import { createWalkInContactAction, findCandidatesAction, getOpenOpportunitiesAction, recordWalkInAction } from "@/server/commands/walkins";
import { EMPTY_INQUIRY_CHOICE, InquiryLinkChoice } from "./inquiry-link-choice";
import { CUSTOMER_TYPES, PAYMENT_METHODS, PRODUCT_INTERESTS, VISIT_PURPOSES, walkInSchema, type WalkInInput } from "@/features/walkins/schema";
import type { IdentityCandidate } from "@/features/inbox/types";
import type { InquiryChoice, OpenOpportunityRef, WalkInResult } from "@/features/walkins/types";
import type { ProfileRef } from "@/server/queries/reference";

const SOURCES = ["walk_in", "tiktok", "meta", "website", "whatsapp", "dm", "call", "email", "referral", "other"] as const;
const INTEREST_LABEL: Record<string, string> = { wall_panel: "Wall panel", tile: "Tile", cut_tile: "Cut tile", mosaic: "Mosaic", finishing: "Finishing", accessory: "Accessory" };
const STEPS = ["Phone", "Customer", "Visit", "Purchase", "Review"] as const;

interface Payment { method: (typeof PAYMENT_METHODS)[number]; amount: string; reference: string }
interface Item { description: string; quantity: string; unit: string; unit_price: string }

function localNow() {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 19);
}

export function WalkInWizard({ locations, members }: { locations: { id: string; name: string }[]; members: ProfileRef[] }) {
  const { session } = useSession();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const saving = useRef(false);
  const selectedCustomer = useRef<string | null>(null);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const [inquiryChoice, setInquiryChoice] = useState<InquiryChoice>(EMPTY_INQUIRY_CHOICE);

  // step 1
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [candidates, setCandidates] = useState<IdentityCandidate[] | null>(null);

  // step 2
  const [contact, setContact] = useState<{ id: string; name: string; lifecycle?: string | null; isNew: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("homeowner");
  /** A prior inquiry selected at identity confirmation; saved with the visit. */
  const [fromLead, setFromLead] = useState<IdentityCandidate | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [openOpps, setOpenOpps] = useState<OpenOpportunityRef[]>([]);

  // step 3
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [locationId, setLocationId] = useState(session.defaultLocationId ?? locations[0]?.id ?? "");
  const [staffId, setStaffId] = useState(session.userId);
  const [customerType, setCustomerType] = useState<string>("homeowner");
  const [area, setArea] = useState("");
  const [renovationArea, setRenovationArea] = useState("");
  const [source, setSource] = useState<string>("walk_in");
  const [purpose, setPurpose] = useState<string>("browse");
  const [sqNumber, setSqNumber] = useState("");
  const [quotationAmount, setQuotationAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [interest, setInterest] = useState<string[]>([]);
  const [oppMode, setOppMode] = useState<"none" | "create" | "link">("none");
  const [oppId, setOppId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [oppName, setOppName] = useState("");

  // step 4
  const [hasPurchase, setHasPurchase] = useState(false);
  const [orc, setOrc] = useState("");
  const [amount, setAmount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ method: "cash", amount: "", reference: "" }]);
  const [items, setItems] = useState<Item[]>([]);

  const [result, setResult] = useState<WalkInResult | null>(null);

  const normalizedPhone = normalizePhone(phone);
  const amountNum = Number(amount || 0);
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.round((amountNum - paidTotal) * 100) / 100;

  function search() {
    if (!normalizedPhone && !email.trim()) {
      toast.error("Enter a phone number (or email) to search.");
      return;
    }
    start(async () => {
      const r = await findCandidatesAction({ phone: phone, email: email, company });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setCandidates(r.data);
      setFromLead(null);
      setContact(null);
      selectedCustomer.current = null;
      setAccountId("");
      setInquiryChoice(EMPTY_INQUIRY_CHOICE);
      setStep(1);
    });
  }

  function pickCandidate(c: IdentityCandidate) {
    if (c.entity_type === "account") {
      setAccountId(c.entity_id);
      toast.info(`Account ${c.display_name} will be linked. Choose or create the person too.`);
      return;
    }
    if (c.entity_type === "lead") {
      // They enquired before but were never registered: register them now from
      // the enquiry so its phone, email, history and salesperson stay attached.
      setFromLead(c);
      setContact(null); selectedCustomer.current = null;
      setInquiryChoice(EMPTY_INQUIRY_CHOICE);
      setOppId(""); setOppMode("none"); setOpenOpps([]);
      if (c.display_name && c.display_name !== "Enquiry") setNewName(c.display_name);
      toast.info("Register the customer below, then confirm the original inquiry with the visit.");
      return;
    }
    setContact({ id: c.entity_id, name: c.display_name, lifecycle: c.lifecycle_state, isNew: false });
    selectedCustomer.current = c.entity_id;
    setFromLead(null);
    setInquiryChoice(EMPTY_INQUIRY_CHOICE);
    setOppId(""); setOppMode("none"); setOpenOpps([]);
    start(async () => {
      const r = await getOpenOpportunitiesAction(c.entity_id);
      if (r.ok && selectedCustomer.current === c.entity_id) setOpenOpps(r.data);
    });
    setStep(2);
  }

  function createContact(provisional: boolean) {
    start(async () => {
      const r = await createWalkInContactAction({ display_name: newName, phone, email, customer_type: newType, provisional });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setContact({ id: r.data.contact_id, name: newName.trim(), lifecycle: "new", isNew: true });
      selectedCustomer.current = r.data.contact_id;
      setCustomerType(newType);
      setOpenOpps([]);
      setOppId(""); setOppMode("none");
      setInquiryChoice(fromLead ? { mode: "choose", leadId: fromLead.entity_id, reason: "" } : EMPTY_INQUIRY_CHOICE);
      setStep(2);
    });
  }

  function submit() {
    if (!contact || saving.current) return;
    const input: WalkInInput = {
      request_id: retry.current?.id ?? crypto.randomUUID(),
      inquiry_mode: inquiryChoice.mode,
      inquiry_lead_id: inquiryChoice.leadId,
      inquiry_reason: inquiryChoice.reason,
      contact_id: contact.id,
      account_id: accountId,
      occurred_at: `${occurredAt.length === 16 ? `${occurredAt}:00` : occurredAt}+08:00`,
      location_id: locationId,
      staff_user_id: staffId,
      customer_type: customerType as WalkInInput["customer_type"],
      origin_area: area,
      renovation_area: renovationArea,
      inquiry_source: source,
      purpose: purpose as WalkInInput["purpose"],
      quotation_ref: sqNumber,
      quotation_amount: quotationAmount ? Number(quotationAmount) : null,
      notes,
      product_interest: interest as WalkInInput["product_interest"],
      opportunity_mode: oppMode,
      opportunity_id: oppId,
      project_name: projectName,
      opportunity_name: oppName,
      purchase: hasPurchase
        ? {
            amount: amountNum,
            external_ref: orc,
            payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
            items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, quantity: Number(i.quantity) || 1, unit: i.unit, unit_price: i.unit_price ? Number(i.unit_price) : undefined })),
            purchase_source: "walk_in",
          }
        : null,
    };
    const payload = JSON.stringify({ ...input, request_id: undefined });
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    input.request_id = retry.current.id;
    const check = walkInSchema.safeParse(input);
    if (!check.success) {
      const issue = check.error.issues[0];
      toast.error(issue ? `${issue.path.join(".") || "Form"}: ${issue.message}` : "Check the details.");
      return;
    }
    saving.current = true;
    start(async () => {
      try {
        const r = await recordWalkInAction(input);
        if (!r.ok) { toast.error(r.error); return; }
        toast.success(r.message);
        setResult(r.data);
      } catch {
        toast.error("The save result could not be confirmed. Retry with the same details; the visit will not be recorded twice.");
      } finally { saving.current = false; }
    });
  }

  function reset() {
    retry.current = null; selectedCustomer.current = null; setFromLead(null); setInquiryChoice(EMPTY_INQUIRY_CHOICE);
    setStep(0); setPhone(""); setEmail(""); setCompany(""); setCandidates(null); setContact(null); setNewName(""); setAccountId(""); setOpenOpps([]);
    setOccurredAt(localNow()); setArea(""); setRenovationArea(""); setSource("walk_in"); setPurpose("browse"); setSqNumber(""); setQuotationAmount(""); setNotes(""); setInterest([]); setOppMode("none"); setOppId(""); setProjectName(""); setOppName("");
    setHasPurchase(false); setOrc(""); setAmount(""); setPayments([{ method: "cash", amount: "", reference: "" }]); setItems([]); setResult(null);
  }

  const canNextVisit = !!purpose && (oppMode !== "link" || !!oppId) && (oppMode !== "create" || projectName.trim().length > 1);
  const canNextPurchase = !hasPurchase || (amountNum >= 0 && amount !== "" && (payments.every((p) => !p.amount) || Math.abs(remaining) < 0.005));
  const nextVisitReason = !purpose ? "Choose a visit purpose first." : oppMode === "link" && !oppId ? "Choose which open opportunity to link, or switch to None." : oppMode === "create" && projectName.trim().length <= 1 ? "Give the new project a name (at least 2 characters)." : undefined;
  const nextPurchaseReason = !hasPurchase ? undefined : amount === "" || Number.isNaN(amountNum) || amountNum < 0 ? "Enter the total amount (zero or more)." : !payments.every((p) => !p.amount) && Math.abs(remaining) >= 0.005 ? `The payments entered must add up to the total: ${remaining > 0 ? `${formatMoney(remaining)} short` : `${formatMoney(Math.abs(remaining))} over`}. Use Fill remaining or clear the split.` : undefined;

  if (result) {
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-base font-semibold">
          <span className="flex size-7 items-center justify-center rounded-full bg-success/15 text-success"><Check className="size-4" aria-hidden /></span>
          Walk-in recorded
        </div>
        <div className="flex flex-wrap gap-2">
          {result.new_customer ? (
            <TonePill tone="info" label="New customer" size="md" hint="This is the first recorded showroom visit for this customer. Their earlier inquiries remain linked." />
          ) : (
            <TonePill tone="ai" label="Existing customer · repeat signal kept" size="md" hint="The visit was attached to a customer already in the app, so their history and repeat status carry on." />
          )}
          {result.purchase_id && <TonePill tone="success" label="Purchase recorded" size="md" hint="The purchase is linked to this visit and the customer. Corrections later need the purchase.correct permission and a reason." />}
          {result.opportunity_id && <TonePill tone="info" label="Opportunity linked" size="md" hint="The visit was linked to a pipeline opportunity, so it shows on that opportunity's timeline." />}
        </div>
        <ul className="space-y-1 text-sm">
          <li>{result.inquiry_link_state === "needs_linking" ? "Needs linking: this visit is saved for inquiry review." : "Original inquiry linked. Acquisition source and salesperson preserved."}</li>
          {result.lead_id && <li><Link href={`/sales/inbox?view=all&lead=${result.lead_id}`} className="text-info hover:underline">Open original inquiry</Link></li>}
          <li><Link href={`/sales/contacts/${contact?.id}`} className="text-info hover:underline">Open {contact?.name}’s 360</Link></li>
          {result.opportunity_id && <li><Link href={`/sales/pipeline?opportunity=${result.opportunity_id}`} className="text-info hover:underline">Open opportunity</Link></li>}
          {result.purchase_id && <li><Link href={`/sales/walk-ins?tab=purchases&purchase=${result.purchase_id}`} className="text-info hover:underline">Open purchase</Link></li>}
          <li><Link href={`/sales/walk-ins?visit=${result.visit_id}`} className="text-info hover:underline">Open visit</Link></li>
        </ul>
        <div className="flex gap-2">
          <Button onClick={reset}><Plus className="size-3.5" aria-hidden /> Record another walk-in</Button>
          <Button asChild variant="outline"><Link href={`/sales/contacts/${contact?.id}`}>Go to contact</Link></Button>
          {result.purchase_id ? <Button asChild variant="outline"><Link href={`/sales/feedback/new?purchase=${result.purchase_id}`}>Request feedback</Link></Button> : null}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Steps">
        {STEPS.map((s, i) => {
          const locked = i > step || (i >= 2 && !contact);
          const reason = !locked ? undefined : i >= 2 && !contact ? "Find or register the customer first." : "Finish the current step to reach this one.";
          return (
            <li key={s} className="flex items-center gap-1">
              <DisabledHint reason={reason}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setStep(i)}
                  className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60", i === step ? "border-primary bg-primary text-primary-foreground" : i < step ? "bg-accent" : "text-muted-foreground")}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className="tnum">{i + 1}</span> {s}
                </button>
              </DisabledHint>
              {i < STEPS.length - 1 && <span className="text-muted-foreground/60">›</span>}
            </li>
          );
        })}
      </ol>

      {/* Step 1 */}
      {step === 0 && (
        <Card className="space-y-4 p-4">
          <Field label="Customer phone" required hint={normalizedPhone ? `Normalized: ${normalizedPhone}` : "Type or scan. Malaysian numbers assumed."}>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input autoFocus inputMode="tel" className="h-12 pl-10 font-mono text-lg tnum" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="012-345 6789" />
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email (optional)"><Input type="email" className="h-9" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} /></Field>
            <Field label="Company (optional)"><Input className="h-9" value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} /></Field>
          </div>
          <div className="flex justify-end">
            <Button size="lg" onClick={search} disabled={pending}>
              <UserSearch className="size-4" aria-hidden /> {pending ? "Searching…" : "Find customer"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2 */}
      {step === 1 && (
        <Card className="space-y-4 p-4">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Matches for <span className="font-mono">{normalizedPhone ?? email}</span></div>
            <CandidateList candidates={candidates ?? []} onPick={pickCandidate} pickLabel="Use this" busy={pending} />
            {accountId && <p className="mt-1 text-[11px] text-muted-foreground">Account selected; now pick the person.</p>}
          </div>
          <div className="rounded-md border border-dashed p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><UserPlus className="size-3.5" aria-hidden /> {fromLead ? "Register the customer from their enquiry" : "Not listed? Register the customer"}</div>
            {fromLead && (
              <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-ai/25 bg-ai/5 px-2 py-1.5 text-xs">
                <span>
                  Creates a customer with the phone and email you entered. Confirm the inquiry on the Review step; its source and salesperson are preserved when the visit is saved.
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setFromLead(null)}>
                  Register without the enquiry
                </Button>
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input autoFocus={!(candidates && candidates.length)} className="h-9" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <DisabledHint reason={newName.trim().length < 2 && !pending ? "Enter the customer's full name first (at least 2 characters)." : undefined}>
                <Button size="sm" disabled={newName.trim().length < 2 || pending} onClick={() => createContact(false)}>Create new contact</Button>
              </DisabledHint>
              <Hint
                content={
                  fromLead
                    ? "A contact created from an enquiry is a full record, not a provisional one: the enquiry already establishes who they are. Duplicates are still queued for review."
                    : newName.trim().length < 2 && !pending
                      ? "Enter the customer's full name first (at least 2 characters)."
                      : "Creates a provisional contact and queues possible duplicates for a manager to decide in Identity Review."
                }
                focusable={newName.trim().length < 2 || !!fromLead}
              >
                <Button size="sm" variant="outline" disabled={newName.trim().length < 2 || pending || !!fromLead} onClick={() => createContact(true)}>Send to review</Button>
              </Hint>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">“Send to review” creates a provisional record and queues duplicate candidates — nothing is merged automatically.</p>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="size-4" aria-hidden /> Back</Button>
          </div>
        </Card>
      )}

      {/* Step 3 */}
      {step === 2 && contact && (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{contact.name}</span>
            {contact.lifecycle && <StatusPill map={LIFECYCLE_STATE} value={contact.lifecycle} />}
            {contact.isNew && <TonePill tone="info" label="Just created" hint="This contact was created a moment ago in this wizard. Use Change if you picked the wrong person." />}
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={() => setStep(1)}>Change</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date & time (Malaysia)" required><Input step="1" type="datetime-local" className="h-9" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
            <Field label="Showroom / location">
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Staff member">
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Customer type">
              <Select value={customerType} onValueChange={setCustomerType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="From (customer's area)"><Input className="h-9" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Cheras, Puchong" /></Field>
            <Field label="Area / renovation"><Input className="h-9" value={renovationArea} onChange={(e) => setRenovationArea(e.target.value)} placeholder="e.g. Wet kitchen, Master bath" /></Field>
            <Field label="How did they hear of us?">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{statusMeta(SOURCE_CHANNEL, s).label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Visit purpose" required>
              <ToggleGroup type="single" value={purpose} onValueChange={(v) => { if (v) { setPurpose(v); if (v === "purchase" || v === "collection") setHasPurchase(true); } }} variant="outline" size="sm" className="flex-wrap justify-start">
                {VISIT_PURPOSES.map((p) => <ToggleGroupItem key={p} value={p} className="h-7 px-2 text-xs">{titleCase(p)}</ToggleGroupItem>)}
              </ToggleGroup>
            </Field>
            <Field label="Product interest">
              <ToggleGroup type="multiple" value={interest} onValueChange={setInterest} variant="outline" size="sm" className="flex-wrap justify-start">
                {PRODUCT_INTERESTS.map((p) => <ToggleGroupItem key={p} value={p} className="h-7 px-2 text-xs">{INTEREST_LABEL[p]}</ToggleGroupItem>)}
              </ToggleGroup>
            </Field>
          </div>
          <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium">Quotation (optional)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="SQ / quotation no."><Input className="h-9 font-mono" value={sqNumber} onChange={(e) => setSqNumber(e.target.value)} placeholder="QT-000123" /></Field>
              <Field label="Quotation amount (MYR)"><Input className="h-9 tnum" inputMode="decimal" value={quotationAmount} onChange={(e) => setQuotationAmount(e.target.value)} placeholder="0.00" /></Field>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-medium">Project / opportunity</div>
            <ToggleGroup type="single" value={oppMode} onValueChange={(v) => v && setOppMode(v as typeof oppMode)} variant="outline" size="sm" className="justify-start">
              <ToggleGroupItem value="none" className="h-7 px-2 text-xs">None</ToggleGroupItem>
              <ToggleGroupItem value="create" className="h-7 px-2 text-xs">Create new</ToggleGroupItem>
              <DisabledHint reason={openOpps.length === 0 ? "This customer has no open opportunity to link. Choose Create new to start one." : undefined}>
                <ToggleGroupItem value="link" className="h-7 px-2 text-xs" disabled={openOpps.length === 0}>Link existing ({openOpps.length})</ToggleGroupItem>
              </DisabledHint>
            </ToggleGroup>
            {oppMode === "create" && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input className="h-9" placeholder="Project / site name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                <Input className="h-9" placeholder="Opportunity name (optional)" value={oppName} onChange={(e) => setOppName(e.target.value)} />
              </div>
            )}
            {oppMode === "link" && (
              <Select value={oppId} onValueChange={setOppId}>
                <SelectTrigger className="mt-2 h-9"><SelectValue placeholder="Choose an open opportunity" /></SelectTrigger>
                <SelectContent>{openOpps.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} · {titleCase(o.stage_key)}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="size-4" aria-hidden /> Back</Button>
            <DisabledHint reason={nextVisitReason}>
              <Button onClick={() => setStep(3)} disabled={!canNextVisit}>Next <ArrowRight className="size-4" aria-hidden /></Button>
            </DisabledHint>
          </div>
        </Card>
      )}

      {/* Step 4 */}
      {step === 3 && (
        <Card className="space-y-4 p-4">
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Record a purchase or collection</div>
              <div className="text-[11px] text-muted-foreground">Document number and total are enough; lines are optional.</div>
            </div>
            <Switch checked={hasPurchase} onCheckedChange={setHasPurchase} aria-label="Has purchase" />
          </div>
          {hasPurchase && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ORC / external number"><Input className="h-9 font-mono" value={orc} onChange={(e) => setOrc(e.target.value)} placeholder="ORC-000123" /></Field>
                <Field label="Total amount (MYR)" required><Input className="h-9 tnum" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-medium">
                  Payments
                  <span className={cn("tnum text-[11px]", Math.abs(remaining) < 0.005 ? "text-success" : "text-warning")}>{paidTotal > 0 ? `${formatMoney(paidTotal)} entered · ${remaining >= 0 ? "remaining" : "over by"} ${formatMoney(Math.abs(remaining))}` : "No payment split (total only)"}</span>
                </div>
                <div className="space-y-2">
                  {payments.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                      <Select value={p.method} onValueChange={(v) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, method: v as Payment["method"] } : x)))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{titleCase(m)}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="h-9 tnum" inputMode="decimal" placeholder="Amount" value={p.amount} onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                      <Input className="h-9" placeholder="Reference" value={p.reference} onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
                      <Button variant="ghost" size="icon" className="size-9" aria-label="Remove payment" onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7" onClick={() => setPayments((ps) => [...ps, { method: "card", amount: remaining > 0 ? String(remaining) : "", reference: "" }])}><Plus className="size-3.5" aria-hidden /> Add payment</Button>
                    {remaining > 0 && payments.length > 0 && <Button variant="ghost" size="sm" className="h-7" onClick={() => setPayments((ps) => ps.map((x, j) => (j === ps.length - 1 ? { ...x, amount: String((Number(x.amount) || 0) + remaining) } : x)))}>Fill remaining</Button>}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium">Line items (optional)</div>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
                      <Input className="h-9" placeholder="Description / code" value={it.description} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                      <Input className="h-9 tnum" placeholder="Qty" inputMode="decimal" value={it.quantity} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                      <Input className="h-9" placeholder="Unit" value={it.unit} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                      <Input className="h-9 tnum" placeholder="Unit price" inputMode="decimal" value={it.unit_price} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))} />
                      <Button variant="ghost" size="icon" className="size-9" aria-label="Remove item" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setItems((xs) => [...xs, { description: "", quantity: "1", unit: "pc", unit_price: "" }])}><Plus className="size-3.5" aria-hidden /> Add item</Button>
                </div>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="size-4" aria-hidden /> Back</Button>
            <DisabledHint reason={nextPurchaseReason}>
              <Button onClick={() => setStep(4)} disabled={!canNextPurchase}>Review <ArrowRight className="size-4" aria-hidden /></Button>
            </DisabledHint>
          </div>
        </Card>
      )}

      {/* Step 5 */}
      {step === 4 && contact && (
        <Card className="space-y-4 p-4">
          <InquiryLinkChoice key={`${contact.id}:${occurredAt}`} contactId={contact.id} occurredAt={`${occurredAt.length === 16 ? `${occurredAt}:00` : occurredAt}+08:00`} value={inquiryChoice} onChange={setInquiryChoice} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Row label="Customer" value={contact.name} />
            <Row label="When" value={occurredAt.replace("T", " ")} />
            <Row label="Location" value={locations.find((l) => l.id === locationId)?.name ?? "—"} />
            <Row label="Staff" value={members.find((m) => m.user_id === staffId)?.full_name ?? "—"} />
            <Row label="Type" value={titleCase(customerType)} />
            <Row label="From" value={area || "—"} />
            <Row label="Area / renovation" value={renovationArea || "—"} />
            <Row label="How they heard (reported)" value={statusMeta(SOURCE_CHANNEL, source).label} />
            <Row label="Purpose" value={titleCase(purpose)} />
            <Row label="Quotation" value={sqNumber || quotationAmount ? `${sqNumber || "—"}${quotationAmount ? ` · ${formatMoney(Number(quotationAmount))}` : ""}` : "—"} />
            <Row label="Interest" value={interest.map((i) => INTEREST_LABEL[i]).join(", ") || "—"} />
            <Row label="Opportunity" value={oppMode === "none" ? "None" : oppMode === "create" ? `Create: ${projectName}` : `Link: ${openOpps.find((o) => o.id === oppId)?.name ?? ""}`} />
            <Row label="Purchase" value={hasPurchase ? `${formatMoney(amountNum)}${orc ? ` · ${orc}` : ""}` : "None"} />
            <Row label="Payments" value={hasPurchase && paidTotal > 0 ? payments.filter((p) => Number(p.amount) > 0).map((p) => `${titleCase(p.method)} ${formatMoney(Number(p.amount))}`).join(", ") : "—"} />
          </dl>
          {notes && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{notes}</p>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="size-4" aria-hidden /> Back</Button>
            <Button size="lg" onClick={submit} disabled={pending}><Check className="size-4" aria-hidden /> {pending ? "Saving…" : "Save walk-in"}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
