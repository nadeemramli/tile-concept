"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Plus, UserPlus, UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuotationFilePicker } from "./quotation-file-picker";
import { VisitQuotationFiles } from "./visit-quotation-files";
import type { QueuedQuotation } from "../quotation-files";
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
import { createWalkInContactAction, getOpenOpportunitiesAction, recordWalkInAction } from "@/server/commands/walkins";
import { CUSTOMER_TYPES, PRODUCT_INTERESTS, VISIT_PURPOSES, walkInSchema, type WalkInInput } from "@/features/walkins/schema";
import { RENOVATION_AREA_PRESETS } from "@/features/walkins/presets";
import { EMPTY_MALAYSIA_AREA, formatMalaysiaArea } from "@/lib/location/malaysia";
import { searchShowroomCustomersAction } from "@/server/commands/showroom-search";
import { MalaysiaAreaFields } from "./malaysia-area-fields";
import type { IdentityCandidate } from "@/features/inbox/types";
import type { OpenOpportunityRef, WalkInResult } from "@/features/walkins/types";
import type { ProfileRef } from "@/server/queries/reference";

const SOURCES = ["walk_in", "tiktok", "meta", "website", "whatsapp", "dm", "call", "email", "referral", "other"] as const;
const INTEREST_LABEL: Record<string, string> = { wall_panel: "Wall panel", tile: "Tile", cut_tile: "Cut tile", mosaic: "Mosaic", finishing: "Finishing", accessory: "Accessory" };
const STEPS = ["Search", "Customer", "Visit", "Purchase", "Review"] as const;


function localNow() {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 19);
}

export function WalkInWizard({ locations, members }: { locations: { id: string; name: string }[]; members: ProfileRef[] }) {
  const { session } = useSession();
  const renovationInputId = useId();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const saving = useRef(false);
  const selectedCustomer = useRef<string | null>(null);
  const retry = useRef<{ payload: string; id: string } | null>(null);

  // step 1
  const [searchQuery, setSearchQuery] = useState("");
  const [contactCompanies, setContactCompanies] = useState<NonNullable<IdentityCandidate["companies"]>>([]);
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
  const [customerArea, setCustomerArea] = useState(EMPTY_MALAYSIA_AREA);
  const area = formatMalaysiaArea(customerArea);
  const [renovationArea, setRenovationArea] = useState("");
  const [source, setSource] = useState<string>("walk_in");
  const [purpose, setPurpose] = useState<string>("browse");
  const [sqNumber, setSqNumber] = useState("");
  const [quotationAmount, setQuotationAmount] = useState("");
  const [quotationFiles, setQuotationFiles] = useState<QueuedQuotation[]>([]);
  const [attachmentsPending, setAttachmentsPending] = useState(false);
  const [notes, setNotes] = useState("");
  const [interest, setInterest] = useState<string[]>([]);
  const [oppMode, setOppMode] = useState<"none" | "create" | "link">("none");
  const [oppId, setOppId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [oppName, setOppName] = useState("");

  const [result, setResult] = useState<WalkInResult | null>(null);

  const normalizedPhone = normalizePhone(phone);

  function search() {
    if (searchQuery.trim().length < 2) {
      toast.error("Enter a telephone, company name, PIC name or email (at least two characters).");
      return;
    }
    start(async () => {
      const r = await searchShowroomCustomersAction(searchQuery);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setCandidates(r.data);
      setCompany(""); setContactCompanies([]);
      setPhone(/^[+\d\s().-]+$/.test(searchQuery.trim()) && !r.data.some((c) => c.entity_type === "account") ? normalizePhone(searchQuery) ?? "" : "");
      setEmail(searchQuery.includes("@") ? searchQuery.trim() : "");
      setFromLead(null);
      setContact(null);
      selectedCustomer.current = null;
      setAccountId("");
      setStep(1);
    });
  }

  function pickCandidate(c: IdentityCandidate) {
    if (c.entity_type === "account") {
      start(async () => {
        const result = await searchShowroomCustomersAction("", c.entity_id);
        if (!result.ok) { toast.error(result.error); return; }
        setAccountId(c.entity_id); setCompany(c.display_name); setCandidates(result.data);
        setPhone(""); setEmail(""); setNewName("");
        toast.info("Choose a linked contact or register a new PIC for this company.");
      });
      return;
    }
    if (c.entity_type === "lead") {
      // They enquired before but were never registered: register them now from
      // the enquiry; saving uses the same safe automatic matching as other visits.
      setFromLead(c);
      setContact(null); selectedCustomer.current = null;
      setOppId(""); setOppMode("none"); setOpenOpps([]);
      if (c.display_name && c.display_name !== "Enquiry") setNewName(c.display_name);
      toast.info("Register the customer below. The visit will be matched to an earlier inquiry automatically when possible.");
      return;
    }
    setContactCompanies(c.companies ?? []);
    if (accountId && !c.companies?.some((a) => a.id === accountId)) { setAccountId(""); setCompany(""); }
    setContact({ id: c.entity_id, name: c.display_name, lifecycle: c.lifecycle_state, isNew: false });
    selectedCustomer.current = c.entity_id;
    setFromLead(null);
    setOppId(""); setOppMode("none"); setOpenOpps([]);
    start(async () => {
      const r = await getOpenOpportunitiesAction(c.entity_id);
      if (r.ok && selectedCustomer.current === c.entity_id) setOpenOpps(r.data);
    });
    setStep(2);
  }

  function createContact(provisional: boolean) {
    start(async () => {
      const r = await createWalkInContactAction({ display_name: newName, phone, email, customer_type: newType, provisional, account_id: accountId || undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setContact({ id: r.data.contact_id, name: newName.trim(), lifecycle: "new", isNew: true });
      selectedCustomer.current = r.data.contact_id;
      setCustomerType(newType);
      setContactCompanies(accountId ? [{ id: accountId, name: company, role: null }] : []);
      setOpenOpps([]);
      setOppId(""); setOppMode("none");
      setStep(2);
    });
  }

  function submit() {
    if (!contact || saving.current) return;
    const input: WalkInInput = {
      request_id: retry.current?.id ?? crypto.randomUUID(),
      inquiry_mode: "automatic",
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
      purchase: null,
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
        setAttachmentsPending(quotationFiles.length > 0);
        setResult(r.data);
      } catch {
        toast.error("The save result could not be confirmed. Retry with the same details; the visit will not be recorded twice.");
      } finally { saving.current = false; }
    });
  }

  function reset() {
    retry.current = null; selectedCustomer.current = null; setFromLead(null);
    setSearchQuery(""); setContactCompanies([]);
    setStep(0); setPhone(""); setEmail(""); setCompany(""); setCandidates(null); setContact(null); setNewName(""); setAccountId(""); setOpenOpps([]);
    setOccurredAt(localNow()); setCustomerArea(EMPTY_MALAYSIA_AREA); setRenovationArea(""); setSource("walk_in"); setPurpose("browse"); setSqNumber(""); setQuotationAmount(""); setNotes(""); setInterest([]); setOppMode("none"); setOppId(""); setProjectName(""); setOppName("");
    setQuotationFiles([]); setAttachmentsPending(false);
    setResult(null);
  }

  const canNextVisit = !!purpose && (oppMode !== "link" || !!oppId) && (oppMode !== "create" || projectName.trim().length > 1);
  const nextVisitReason = !purpose ? "Choose a visit purpose first." : oppMode === "link" && !oppId ? "Choose which open opportunity to link, or switch to None." : oppMode === "create" && projectName.trim().length <= 1 ? "Give the new project a name (at least 2 characters)." : undefined;

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
        <div className="space-y-2"><h2 className="text-sm font-semibold">Quotation files</h2><VisitQuotationFiles key={result.visit_id} visitId={result.visit_id} canWrite initialFiles={quotationFiles} onPendingChange={setAttachmentsPending} /></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/sales/record-sale?visit=${result.visit_id}`}>Sales & receipts</Link></Button>
          <DisabledHint reason={attachmentsPending ? "Finish or remove the queued quotation files first." : undefined}><Button onClick={reset} disabled={attachmentsPending}><Plus className="size-3.5" aria-hidden /> Record another walk-in</Button></DisabledHint>
          <Button asChild variant="outline"><Link href={`/sales/contacts/${contact?.id}`}>Go to contact</Link></Button>
          <Button asChild variant="outline"><Link href={`/sales/feedback/new?visit=${result.visit_id}`}>Customer feedback & Google review</Link></Button>
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
          <Field label="Telephone, company or PIC" htmlFor="showroom-search" hint="Search a customer/PIC number, company telephone, company name, contact name or email.">
            <Input id="showroom-search" autoFocus className="h-12 text-base" value={searchQuery} maxLength={200} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Telephone / PIC number / company name" />
          </Field>
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
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{accountId ? "Contacts at" : "Matches for"} <span>{company || searchQuery}</span></div>
            <CandidateList candidates={candidates ?? []} onPick={pickCandidate} pickLabel="Use this" busy={pending} />
            {accountId && <p className="mt-1 text-[11px] text-muted-foreground">Company selected. Choose its contact below, or register a new PIC.</p>}
          </div>
          <div className="rounded-md border border-dashed p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><UserPlus className="size-3.5" aria-hidden /> {fromLead ? "Register the customer from their enquiry" : "Not listed? Register the customer"}</div>
            {fromLead && (
              <p className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-ai/25 bg-ai/5 px-2 py-1.5 text-xs">
                <span>
                  Creates a customer with the phone and email you entered. Earlier inquiries are matched automatically when the visit is saved; uncertain matches are kept for later review.
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setFromLead(null)}>
                  Register without the enquiry
                </Button>
              </p>
            )}
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              <Field label="PIC / customer telephone" htmlFor="new-contact-phone" hint={normalizedPhone ? `Normalized: ${normalizedPhone}` : "Enter the person's own number, not the company switchboard."}><Input id="new-contact-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label="Email (optional)" htmlFor="new-contact-email"><Input id="new-contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
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
            {contactCompanies.length > 0 && <Field label="Company for this visit" hint="Choose the company this person represents for this visit, or keep it personal.">
              <Select value={accountId || "personal"} onValueChange={(id) => { setAccountId(id === "personal" ? "" : id); setCompany(contactCompanies.find((a) => a.id === id)?.name ?? ""); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="personal">Personal visit / no company</SelectItem>{contactCompanies.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>}
            <Field label="Customer type">
              <Select value={customerType} onValueChange={setCustomerType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <MalaysiaAreaFields value={customerArea} onChange={setCustomerArea} />
            <Field label="Area / renovation" htmlFor={renovationInputId} hint="Choose a preset or type another renovation area.">
              <Input id={renovationInputId} list={`${renovationInputId}-presets`} aria-describedby={`${renovationInputId}-hint`} className="h-9" value={renovationArea} onChange={(e) => setRenovationArea(e.target.value)} placeholder="Select or type a renovation area" maxLength={200} autoComplete="off" />
              <datalist id={`${renovationInputId}-presets`}>
                {RENOVATION_AREA_PRESETS.map((option) => <option key={option} value={option} />)}
              </datalist>
            </Field>
            <Field label="How did they hear of us?">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{statusMeta(SOURCE_CHANNEL, s).label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Visit purpose" required>
              <ToggleGroup type="single" value={purpose} onValueChange={(v) => { if (v) { setPurpose(v);  } }} variant="outline" size="sm" className="flex-wrap justify-start">
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
            <Tabs defaultValue="details">
              <TabsList aria-label="Quotation"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="files">Upload file{quotationFiles.length ? ` (${quotationFiles.length})` : ""}</TabsTrigger></TabsList>
              <TabsContent value="details">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="SQ / quotation no."><Input className="h-9 font-mono" value={sqNumber} onChange={(e) => setSqNumber(e.target.value)} placeholder="QT-000123" /></Field>
                  <Field label="Quotation amount (MYR)"><Input className="h-9 tnum" inputMode="decimal" value={quotationAmount} onChange={(e) => setQuotationAmount(e.target.value)} placeholder="0.00" /></Field>
                </div>
              </TabsContent>
              <TabsContent value="files"><QuotationFilePicker files={quotationFiles} onChange={setQuotationFiles} /></TabsContent>
            </Tabs>
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
      {step === 3 && <Card className="space-y-4 p-4">
        <h2 className="font-semibold">Sales & payments</h2>
        <p className="text-sm text-muted-foreground">Save the visit first. Then open Sales & receipts to record a documented sale or add a payment to an existing sale. A deposit is kept separate from the full sale value.</p>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)}>Review visit</Button></div>
      </Card>}

      {step === 4 && contact && (
        <Card className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Row label="Customer" value={contact.name} />
            <Row label="Company" value={company || "Personal visit"} />
            <Row label="When" value={occurredAt.replace("T", " ")} />
            <Row label="Location" value={locations.find((l) => l.id === locationId)?.name ?? "—"} />
            <Row label="Staff" value={members.find((m) => m.user_id === staffId)?.full_name ?? "—"} />
            <Row label="Type" value={titleCase(customerType)} />
            <Row label="From" value={area || "—"} />
            <Row label="Area / renovation" value={renovationArea || "—"} />
            <Row label="How they heard (reported)" value={statusMeta(SOURCE_CHANNEL, source).label} />
            <Row label="Purpose" value={titleCase(purpose)} />
            <Row label="Quotation" value={sqNumber || quotationAmount ? `${sqNumber || "—"}${quotationAmount ? ` · ${formatMoney(Number(quotationAmount))}` : ""}` : "—"} />
            <Row label="Quotation files" value={quotationFiles.map((q) => q.file.name).join(", ") || "—"} />
            <Row label="Interest" value={interest.map((i) => INTEREST_LABEL[i]).join(", ") || "—"} />
            <Row label="Opportunity" value={oppMode === "none" ? "None" : oppMode === "create" ? `Create: ${projectName}` : `Link: ${openOpps.find((o) => o.id === oppId)?.name ?? ""}`} />
            <Row label="Sale / payment" value="Record after saving this visit" />
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
