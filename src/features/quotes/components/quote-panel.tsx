"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { Gated, InfoTip } from "@/components/patterns/explain";
import { StatusPill } from "@/components/patterns/status-pill";
import { QUOTE_CHANNEL, QUOTE_EVIDENCE_STATE, QUOTE_LIFECYCLE, QUOTE_SEND_EVIDENCE, QUOTE_SEND_KIND, QUOTE_VERSION_STATE, VISIT_QUOTE_RESOLUTION } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { loadQuoteContextAction, quoteCommandAction } from "@/server/commands/quotes";
import { QUOTE_CHANNELS, QUOTE_SEND_EVIDENCES, type QuoteAction } from "../schema";
import type { QuoteAnchor, QuoteContext, QuoteSendView, QuoteVersionView, QuoteView, VisitEvidenceView } from "../types";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/** Current showroom time for a datetime-local input. */
function nowLocal() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16);
}

type Dialogs =
  | { kind: "new" }
  | { kind: "revise"; quote: QuoteView }
  | { kind: "issue"; quote: QuoteView; version: QuoteVersionView }
  | { kind: "send"; quote: QuoteView }
  | { kind: "outcome"; quote: QuoteView; action: "accept" | "reject" | "expire" }
  | { kind: "reopen"; quote: QuoteView }
  | { kind: "void"; quote: QuoteView; send: QuoteSendView }
  | { kind: "evidence"; item: VisitEvidenceView };

const ORIGIN: Record<string, "inbox" | "visit" | "pipeline"> = { lead_id: "inbox", visit_id: "visit", opportunity_id: "pipeline" };

/**
 * Quotations for one pursuit, recorded from wherever staff already are: the
 * inquiry drawer, the visit drawer or the opportunity. Preparing, issuing and
 * sending are separate steps; the database keeps every version and send.
 */
export function QuotePanel({ anchor, suggestedNumber, defaultAmount, defaultCurrency = "MYR" }: {
  anchor: QuoteAnchor; suggestedNumber?: string; defaultAmount?: number | null; defaultCurrency?: string;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<QuoteContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const anchorKey = JSON.stringify(anchor);

  useEffect(() => {
    let active = true;
    loadQuoteContextAction(JSON.parse(anchorKey) as QuoteAnchor)
      .then((r) => { if (!active) return; if (r.ok) { setCtx(r.data); setLoadError(""); } else setLoadError(r.error); })
      .catch(() => { if (active) setLoadError("Could not load quotations."); });
    return () => { active = false; };
  }, [anchorKey, revision]);

  const saved = useCallback(() => { setDialog(null); setRevision((n) => n + 1); router.refresh(); }, [router]);

  if (loadError) return <div role="alert" className="space-y-2 text-sm"><p>{loadError}</p><Button size="sm" variant="outline" onClick={() => setRevision((n) => n + 1)}>Reload quotations</Button></div>;
  if (!ctx) return <p role="status" className="text-sm text-muted-foreground">Loading quotations…</p>;

  return (
    <div className="space-y-3" data-testid="quote-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Preparing, issuing and sending are recorded separately. Nothing here messages the customer.</p>
        <Gated permission="sales.write"><Button size="sm" onClick={() => setDialog({ kind: "new" })}>Record quote</Button></Gated>
      </div>
      {ctx.quotes.length === 0 && <p className="text-sm text-muted-foreground">No quotations recorded for this pursuit yet.</p>}
      <ul className="space-y-3">
        {ctx.quotes.map((q) => <QuoteCard key={q.id} quote={q} anchor={anchor} onOpen={setDialog} />)}
      </ul>
      {ctx.evidence.length > 0 && (
        <div className="space-y-2 rounded-md border p-3" data-testid="visit-quote-evidence">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium">Visit quotation evidence</p>
            <InfoTip label="Visit quotation evidence" content="SQ numbers, amounts and files noted on a visit point at a quote or wait for review. They never count as a quotation sent on their own." />
          </div>
          <ul className="space-y-2">
            {ctx.evidence.map((e) => {
              const quote = ctx.quotes.find((q) => q.id === e.quote_id);
              return (
                <li key={e.evidence_key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="break-all">{e.evidence_kind === "file" ? `File: ${e.file_name}` : `Note: ${e.reference_text ?? "no SQ number"}${e.amount !== null ? ` · ${formatMoney(e.amount)}` : ""}`}</p>
                    <p className="text-xs text-muted-foreground">
                      <StatusPill map={VISIT_QUOTE_RESOLUTION} value={e.resolution} />
                      {quote ? ` → ${quote.quote_number ?? "quote without number"}` : ""}
                      {e.decision_reason ? ` · “${e.decision_reason}”` : ""}
                      {e.changed_since_decision ? " · the visit note changed after this review" : ""}
                    </p>
                  </div>
                  <Gated permission="sales.write"><Button size="sm" variant="outline" onClick={() => setDialog({ kind: "evidence", item: e })}>Review evidence</Button></Gated>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {dialog && <QuoteDialog dialog={dialog} anchor={anchor} ctx={ctx} suggestedNumber={suggestedNumber} defaultAmount={defaultAmount} defaultCurrency={defaultCurrency} onClose={() => setDialog(null)} onSaved={saved} />}
    </div>
  );
}

function QuoteCard({ quote, anchor, onOpen }: { quote: QuoteView; anchor: QuoteAnchor; onOpen: (d: Dialogs) => void }) {
  const closed = ["accepted", "rejected", "expired"].includes(quote.status);
  const current = quote.versions[0];
  const ref = quote.versions.find((v) => v.external_ref)?.external_ref;
  return (
    <li className="space-y-2 rounded-md border p-3" data-testid="quote-card" aria-label={`Quote ${quote.quote_number ?? ref ?? "without number"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[12px] tnum">{quote.quote_number ?? "No quote number"}</span>
        {ref && <span className="font-mono text-[11px] text-muted-foreground">SQL {ref}</span>}
        <StatusPill map={QUOTE_LIFECYCLE} value={quote.lifecycle} />
        <QuoteLinks quote={quote} anchor={anchor} />
      </div>
      {quote.first_sent_at && <p className="text-xs text-muted-foreground">First sent as v{quote.first_sent_version_no} on {formatDateTime(quote.first_sent_at)}</p>}
      <div className="flex flex-wrap gap-2">
        {!closed && <Gated permission="sales.write"><Button size="sm" variant="outline" onClick={() => onOpen({ kind: "revise", quote })}>Revise</Button></Gated>}
        {!closed && current && <Gated permission="sales.write"><Button size="sm" variant="outline" onClick={() => onOpen({ kind: "send", quote })}>Mark sent</Button></Gated>}
        {!closed && quote.versions.some((v) => v.issued_at) && (["accept", "reject", "expire"] as const).map((a) => (
          <Gated key={a} permission="sales.write"><Button size="sm" variant="ghost" onClick={() => onOpen({ kind: "outcome", quote, action: a })}>{a === "accept" ? "Accepted" : a === "reject" ? "Rejected" : "Expired"}</Button></Gated>
        ))}
        {closed && <Gated permission="sales.write"><Button size="sm" variant="outline" onClick={() => onOpen({ kind: "reopen", quote })}>Reopen</Button></Gated>}
      </div>
      <ul className="space-y-2 border-l pl-3">
        {quote.versions.map((v) => (
          <li key={v.id} className="space-y-1 text-xs" data-testid="quote-version">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">v{v.version_no}</span>
              <span className="tnum">{v.total_amount !== null ? formatMoney(v.total_amount, v.currency) : `${v.currency} amount not stated`}</span>
              <StatusPill map={QUOTE_VERSION_STATE} value={v.issued_at ? "issued" : "prepared"} />
              {v.evidence_state !== "staff_entered" && <StatusPill map={QUOTE_EVIDENCE_STATE} value={v.evidence_state} />}
              <span className="text-muted-foreground">prepared {formatDate(v.prepared_at)}{v.issued_at ? ` · issued ${formatDate(v.issued_at)}` : ""}{v.valid_until ? ` · valid until ${formatDate(v.valid_until)}` : ""}{v.external_ref ? ` · ref ${v.external_ref}` : ""}</span>
              {!v.issued_at && !closed && <Gated permission="sales.write"><Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onOpen({ kind: "issue", quote, version: v })}>Issue v{v.version_no}</Button></Gated>}
            </div>
            {v.sends.map((s) => (
              <div key={s.id} className={`flex flex-wrap items-center gap-2 pl-3 ${s.voided ? "text-muted-foreground line-through" : ""}`} data-testid="quote-send">
                <span>Sent {formatDateTime(s.sent_at)}</span>
                <StatusPill map={QUOTE_CHANNEL} value={s.channel} />
                {s.kind && <StatusPill map={QUOTE_SEND_KIND} value={s.kind} />}
                <span className="text-muted-foreground">by {s.sent_by_name ?? "unknown"} · <StatusPill map={QUOTE_SEND_EVIDENCE} value={s.evidence} />{s.evidence_ref ? ` ${s.evidence_ref}` : ""}</span>
                {s.voided ? <span className="no-underline">voided: {s.voided.reason}</span> : <Gated permission="sales.write"><Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onOpen({ kind: "void", quote, send: s })}>Void</Button></Gated>}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {quote.events.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">History ({quote.events.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {quote.events.map((e) => <li key={e.id} className="tnum">{formatDateTime(e.occurred_at)} · {titleCase(e.event_type)} · {e.actor_name ?? "system"}{e.reason ? ` · “${e.reason}”` : ""}{e.recorded_at.slice(0, 16) !== e.occurred_at.slice(0, 16) ? ` (recorded ${formatDateTime(e.recorded_at)})` : ""}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}

/** Canonical links to the other records of the pursuit, in this workspace. */
function QuoteLinks({ quote, anchor }: { quote: QuoteView; anchor: QuoteAnchor }) {
  const links: { href: string; label: string }[] = [];
  if (quote.lead_id && !("lead_id" in anchor && anchor.lead_id === quote.lead_id)) links.push({ href: `/sales/inbox?lead=${quote.lead_id}`, label: "Inquiry" });
  if (quote.visit_id && !("visit_id" in anchor && anchor.visit_id === quote.visit_id)) links.push({ href: `/sales/walk-ins?visit=${quote.visit_id}`, label: "Visit" });
  if (quote.opportunity_id && !("opportunity_id" in anchor && anchor.opportunity_id === quote.opportunity_id)) links.push({ href: `/sales/pipeline?opportunity=${quote.opportunity_id}`, label: "Opportunity" });
  return <>{links.map((l) => <Link key={l.href} href={l.href} className="text-xs hover:underline">{l.label}</Link>)}</>;
}

function QuoteDialog({ dialog, anchor, ctx, suggestedNumber, defaultAmount, defaultCurrency, onClose, onSaved }: {
  dialog: Dialogs; anchor: QuoteAnchor; ctx: QuoteContext; suggestedNumber?: string; defaultAmount?: number | null; defaultCurrency: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState("");
  const [stage, setStage] = useState<"prepared" | "issued" | "sent">("prepared");
  const [resolution, setResolution] = useState<"link" | "create_prepared" | "unresolved" | "not_a_quote">("link");
  const [evidence, setEvidence] = useState("staff_attested");
  // One request id per distinct submission: an unchanged retry replays, an edited form is a new request.
  const retry = useRef<{ key: string; id: string } | null>(null);

  function run(action: QuoteAction, input: Record<string, unknown>) {
    const key = JSON.stringify([action, input]);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    start(async () => {
      try {
        const r = await quoteCommandAction({ action, request_id, input });
        if (r.ok) { toast.success(r.message ?? "Saved"); onSaved(); return; }
        setErrors(r.fieldErrors ?? {}); setFailed(r.error); toast.error(r.error);
      } catch {
        setFailed("The connection dropped before the app confirmed the save. Retry: the same request is never recorded twice.");
      }
    });
  }

  const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const err = (k: string) => errors[k]?.join(", ");

  let title = ""; let description = ""; let body: React.ReactNode = null; let submitLabel = "Save";
  let onSubmit: (fd: FormData) => void = () => {};

  if (dialog.kind === "new" || dialog.kind === "revise") {
    const revising = dialog.kind === "revise" ? dialog.quote : null;
    const latest = revising?.versions[0];
    title = revising ? `Revise ${revising.quote_number ?? "quote"} (v${revising.current_version_no + 1})` : "Record quote";
    description = revising ? "A revision is a new version. Earlier versions stay exactly as they were issued." : "Record what was prepared. Mark it issued or sent only if that actually happened.";
    submitLabel = stage === "prepared" ? "Save as prepared" : stage === "issued" ? "Save and issue" : "Save, issue and record send";
    onSubmit = (fd) => {
      const v = fields(fd);
      const input = revising ? { quote_id: revising.id, base_version_no: revising.current_version_no, ...v, stage } : { ...anchor, origin: ORIGIN[Object.keys(anchor)[0]], ...v, stage };
      run(revising ? "revise" : "prepare", input);
    };
    body = <>
      <div className="grid grid-cols-2 gap-3">
        {!revising && <Field label="Quote number" htmlFor="quote_number" error={err("quote_number")} tip="Optional. The app number for this quote; it stays with every revision."><Input id="quote_number" name="quote_number" className="font-mono" defaultValue={suggestedNumber ?? ""} /></Field>}
        <Field label="SQL Account SQ number" htmlFor="external_ref" error={err("external_ref")} tip="The same SQ number always points at one quote. A number already used by another quote is refused."><Input id="external_ref" name="external_ref" className="font-mono" defaultValue={latest?.external_ref ?? ""} /></Field>
        <Field label="Total amount" htmlFor="total_amount" error={err("total_amount")}><Input id="total_amount" name="total_amount" type="number" min="0" step="0.01" className="tnum" defaultValue={latest?.total_amount ?? defaultAmount ?? ""} /></Field>
        <Field label="Currency" htmlFor="currency" required error={err("currency")}><Input id="currency" name="currency" maxLength={3} className="font-mono uppercase" defaultValue={latest?.currency ?? defaultCurrency} required /></Field>
        <Field label="Prepared" htmlFor="prepared_at" error={err("prepared_at")}><Input id="prepared_at" name="prepared_at" type="datetime-local" defaultValue={nowLocal()} /></Field>
        <Field label="Valid until" htmlFor="valid_until" error={err("valid_until")}><Input id="valid_until" name="valid_until" type="date" /></Field>
      </div>
      <Field label="What has happened" htmlFor="stage" tip="Prepared: drafted only. Issued: finalised, not yet with the customer. Sent: it reached the customer.">
        <select id="stage" className={selectClass} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
          <option value="prepared">Prepared only</option><option value="issued">Issued, not sent yet</option><option value="sent">Issued and sent to the customer</option>
        </select>
      </Field>
      {stage !== "prepared" && <Field label="Issued" htmlFor="issued_at" error={err("issued_at")} hint={stage === "sent" ? "Leave blank if it was issued when it was sent." : undefined}><Input id="issued_at" name="issued_at" type="datetime-local" defaultValue={stage === "issued" ? nowLocal() : ""} /></Field>}
      {stage === "sent" && <SendFields err={err} evidence={evidence} setEvidence={setEvidence} noteName="send_note" />}
      <Field label="Notes" htmlFor="notes" error={err("notes")}><Textarea id="notes" name="notes" rows={2} /></Field>
    </>;
  } else if (dialog.kind === "issue") {
    title = `Issue v${dialog.version.version_no}`; description = "Issuing finalises this version. After this it cannot change."; submitLabel = "Issue version";
    onSubmit = (fd) => run("issue", { version_id: dialog.version.id, issued_at: fields(fd).issued_at });
    body = <Field label="Issued" htmlFor="issued_at" required error={err("issued_at")}><Input id="issued_at" name="issued_at" type="datetime-local" defaultValue={nowLocal()} required /></Field>;
  } else if (dialog.kind === "send") {
    const versions = dialog.quote.versions;
    title = `Record a send of ${dialog.quote.quote_number ?? "this quote"}`; description = "Record the version that actually went out, when, how and by whom. The app does not message the customer."; submitLabel = "Record send";
    onSubmit = (fd) => { const { version_id, issue_if_prepared, ...v } = fields(fd); run("send", { version_id, ...v, issue_if_prepared: issue_if_prepared === "on" }); };
    body = <>
      <Field label="Version sent" htmlFor="version_id" required>
        <select id="version_id" name="version_id" className={selectClass} defaultValue={versions[0]?.id}>
          {versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} · {v.total_amount !== null ? formatMoney(v.total_amount, v.currency) : "amount not stated"} · {v.issued_at ? "issued" : "prepared only"}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="issue_if_prepared" /> If this version is only prepared, issue it at the send time</label>
      <SendFields err={err} evidence={evidence} setEvidence={setEvidence} noteName="note" />
    </>;
  } else if (dialog.kind === "outcome") {
    const label = dialog.action === "accept" ? "accepted" : dialog.action === "reject" ? "rejected" : "expired";
    title = `Mark quote ${label}`; description = "This records the customer's answer on the quote only. It is not a sale and does not move the opportunity."; submitLabel = `Mark ${label}`;
    onSubmit = (fd) => run(dialog.action, { quote_id: dialog.quote.id, reason: fields(fd).reason });
    body = <Field label="Reason" htmlFor="reason" required={dialog.action === "reject"} error={err("reason")}><Textarea id="reason" name="reason" rows={2} required={dialog.action === "reject"} /></Field>;
  } else if (dialog.kind === "reopen") {
    title = "Reopen quote"; description = "The earlier outcome stays in the history."; submitLabel = "Reopen";
    onSubmit = (fd) => run("reopen", { quote_id: dialog.quote.id, reason: fields(fd).reason });
    body = <Field label="Reason" htmlFor="reason" required error={err("reason")}><Textarea id="reason" name="reason" rows={2} required /></Field>;
  } else if (dialog.kind === "void") {
    title = "Void this send record"; description = `Sent ${formatDateTime(dialog.send.sent_at)}. The record is kept and marked void; counts exclude it.`; submitLabel = "Void send record";
    onSubmit = (fd) => run("void_send", { delivery_id: dialog.send.id, reason: fields(fd).reason });
    body = <Field label="Reason" htmlFor="reason" required error={err("reason")}><Textarea id="reason" name="reason" rows={2} required /></Field>;
  } else if (dialog.kind === "evidence") {
    const item = dialog.item;
    const candidates = ctx.quotes;
    title = item.evidence_kind === "file" ? `Review ${item.file_name}` : `Review visit note ${item.reference_text ?? ""}`;
    description = "Say which quote this is. A new record made from evidence is prepared and unverified: it is never counted as sent.";
    submitLabel = "Save review";
    onSubmit = (fd) => {
      const v = fields(fd);
      run("resolve_evidence", { visit_id: item.visit_id, file_id: item.file_id ?? "", expected_decision_id: item.decision_id ?? "", resolution, ...v });
    };
    body = <>
      <Field label="This evidence is" htmlFor="resolution">
        <select id="resolution" className={selectClass} value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)}>
          <option value="link">An existing quote</option>
          {!(item.evidence_kind === "reference" && item.resolution === "matched") && <option value="create_prepared">A quote not recorded yet (create an unverified prepared record)</option>}
          <option value="unresolved">Unclear: keep it unresolved</option>
          <option value="not_a_quote">Not a quotation</option>
        </select>
      </Field>
      {resolution === "link" && <>
        <Field label="Quote" htmlFor="quote_id" required error={err("quote_id")}>
          <select id="quote_id" name="quote_id" className={selectClass} defaultValue={item.quote_id ?? candidates[0]?.id ?? ""}>
            {candidates.length === 0 && <option value="">No quote on this pursuit yet</option>}
            {candidates.map((q) => <option key={q.id} value={q.id}>{q.quote_number ?? q.versions.find((v) => v.external_ref)?.external_ref ?? "Quote without number"} · {QUOTE_LIFECYCLE[q.lifecycle]?.label ?? q.lifecycle}</option>)}
          </select>
        </Field>
        {item.evidence_kind === "file" && <Field label="Version (if known)" htmlFor="version_id" hint="Leave as unknown when the file does not say which version it is.">
          <select id="version_id" name="version_id" className={selectClass} defaultValue="">
            <option value="">Unknown version</option>
            {candidates.flatMap((q) => q.versions.map((v) => <option key={v.id} value={v.id}>{q.quote_number ?? "Quote"} v{v.version_no}</option>))}
          </select>
        </Field>}
      </>}
      {resolution === "create_prepared" && <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" htmlFor="currency" required error={err("currency")} tip="Stated by the reviewer. Nothing is assumed from the visit."><Input id="currency" name="currency" maxLength={3} className="font-mono uppercase" defaultValue="" /></Field>
        <Field label="Quote number" htmlFor="quote_number" error={err("quote_number")}><Input id="quote_number" name="quote_number" className="font-mono" /></Field>
      </div>}
      {(resolution === "unresolved" || resolution === "not_a_quote") && <Field label="Reason" htmlFor="reason" required error={err("reason")}><Textarea id="reason" name="reason" rows={2} required /></Field>}
    </>;
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }} className="space-y-4">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
          <div className="space-y-3">{body}</div>
          {failed && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{failed}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : failed ? `Retry: ${submitLabel.toLowerCase()}` : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SendFields({ err, evidence, setEvidence, noteName }: { err: (k: string) => string | undefined; evidence: string; setEvidence: (v: string) => void; noteName: string }) {
  return <>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Sent" htmlFor="sent_at" required error={err("sent_at")} tip="When it actually reached the customer, in showroom time. It may be days after it was issued."><Input id="sent_at" name="sent_at" type="datetime-local" defaultValue={nowLocal()} required /></Field>
      <Field label="Channel" htmlFor="channel" required error={err("channel")}>
        <select id="channel" name="channel" className={selectClass} defaultValue="whatsapp">{QUOTE_CHANNELS.map((c) => <option key={c} value={c}>{QUOTE_CHANNEL[c].label}</option>)}</select>
      </Field>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Evidence" htmlFor="evidence" required error={err("evidence")}>
        <select id="evidence" name="evidence" className={selectClass} value={evidence} onChange={(e) => setEvidence(e.target.value)}>{QUOTE_SEND_EVIDENCES.map((c) => <option key={c} value={c}>{QUOTE_SEND_EVIDENCE[c].label}</option>)}</select>
      </Field>
      {evidence === "message_reference" && <Field label="Message reference" htmlFor="evidence_ref" required error={err("evidence_ref")} hint="A message or email id. No phone numbers or addresses."><Input id="evidence_ref" name="evidence_ref" required /></Field>}
    </div>
    <Field label="Send note" htmlFor={noteName} error={err(noteName)}><Input id={noteName} name={noteName} /></Field>
  </>;
}
