"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { useSession } from "@/components/shell/session-context";
import { formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { saleCommandAction, prepareSaleReceiptAction } from "@/server/commands/sales";
import type { SaleWorkspace } from "@/server/queries/sales";
import type { SaleCommand } from "./schema";

const kl = (date: string) => new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0, 19);
const inputClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

export function SaleWorkbench({ data, leadId, visitId }: { data: SaleWorkspace; leadId?: string; visitId?: string }) {
  const { can } = useSession();
  const router = useRouter();
  const sale = data.sale;
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const uploadRetry = useRef<{ file: File; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState(sale?.external_ref ?? "");
  const [documentType, setDocumentType] = useState(sale?.document_type ?? "invoice");
  const [gross, setGross] = useState(sale?.gross_before_discount?.toString() ?? "");
  const [discount, setDiscount] = useState(sale?.discount_amount?.toString() ?? "0");
  const [tax, setTax] = useState(sale?.tax_amount?.toString() ?? "");
  const [date, setDate] = useState(() => kl(sale?.purchased_at ?? new Date().toISOString()));
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [action, setAction] = useState<SaleCommand["action"]>("collection");
  const [eventDate, setEventDate] = useState(() => kl(new Date().toISOString()));
  const [amount, setAmount] = useState("");
  const [creditTax, setCreditTax] = useState("0");
  const [method, setMethod] = useState<"cash" | "card" | "bank_transfer" | "ewallet" | "cheque" | "other">("bank_transfer");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [linkedLead, setLinkedLead] = useState(sale?.lead_id ?? leadId ?? "");
  const [parentSale, setParentSale] = useState("");
  const legacy = sale?.financial_state === "legacy_unclassified" || (sale?.financial_state === "collection_only" && !sale.collection_parent_id);
  const editable = !sale || sale.financial_state === "pending_evidence" || legacy;
  const ready = sale?.financial_state === "confirmed" || sale?.financial_state === "collection_only";
  const canWrite = can("purchase.write");
  const canCorrect = can("purchase.correct");

  function run(next: SaleCommand["action"], values: SaleCommand["input"] = {}) {
    if (busy.current) return;
    const input = { ...(sale?.id ? { purchase_id: sale.id, version: sale.version ?? 1 } : {}), ...values };
    const payload = JSON.stringify({ action: next, input });
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    busy.current = true; setError(null);
    start(async () => {
      try {
        const result = await saleCommandAction({ action: next, input, request_id });
        if (!result.ok) { setError(result.error); return; }
        retry.current = null;
        toast.success(result.message);
        router.replace(`/sales/record-sale?id=${result.data}`);
        router.refresh();
      } catch { setError("The result could not be confirmed. Retry with the same details; it will not be recorded twice."); }
      finally { busy.current = false; }
    });
  }

  function save() {
    if (!gross || !tax || !date || !discount) { setError("Enter the sale value, discount and tax explicitly. Enter zero if no discount or tax applies."); return; }
    const parsed = new Date(`${date}+08:00`);
    if (!Number.isFinite(parsed.getTime())) { setError("Choose a valid sale date."); return; }
    run("save", { lead_id: sale?.lead_id ?? leadId, visit_id: sale?.visit_id ?? visitId,
      occurred_at: parsed.toISOString(), external_ref: ref, document_type: documentType as "invoice" | "receipt" | "sales_order",
      gross_before_discount: Number(gross), discount_amount: Number(discount), tax_amount: Number(tax), reason });
  }

  function recordEvent() {
    const parsed = new Date(`${eventDate}+08:00`);
    if (!Number.isFinite(parsed.getTime())) { setError("Choose a valid event date."); return; }
    run(action, { occurred_at: parsed.toISOString(), reason, amount: amount === "" ? undefined : Number(amount), tax_amount: Number(creditTax),
      method, reference, evidence_id: evidence || undefined, payment_id: paymentId || undefined, lead_id: action === "link" ? linkedLead || undefined : undefined });
  }

  function upload() {
    if (!sale?.id || !file || busy.current) return;
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) { setError("Choose a PDF, JPG or PNG up to 5 MB."); return; }
    if (uploadRetry.current?.file !== file) uploadRetry.current = { file, id: crypto.randomUUID() };
    const receiptId = uploadRetry.current.id;
    busy.current = true; setError(null);
    start(async () => {
      try {
        const prepared = await prepareSaleReceiptAction({ purchase_id: sale.id, receipt_id: receiptId, name: file.name, type: file.type, size: file.size });
        if (!prepared.ok) { setError(prepared.error); return; }
        if (!prepared.data) { setError("Could not prepare the upload. Retry."); return; }
        const storage = getBrowserSupabase().storage.from("sales-receipts");
        const { error: uploadError } = await storage.upload(prepared.data, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          // A response can be lost after upload succeeded. Verify that the same immutable path exists.
          const check = await storage.info(prepared.data);
          if (check.error) { setError("Upload did not finish. Your sale is saved; retry this file before confirming."); return; }
        }
        uploadRetry.current = null; setFile(null); toast.success("Evidence uploaded privately."); router.refresh();
      } catch { setError("Upload result could not be confirmed. Retry the same file; your sale remains saved."); }
      finally { busy.current = false; }
    });
  }

  const context = sale?.lead_id ?? leadId ?? data.visit?.lead_id;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-3 text-sm">
      <Link className="underline" href="/sales/walk-ins?tab=purchases">Walk-ins & purchases</Link>
      {context && <Link className="underline" href={`/sales/inbox?view=all&lead=${context}`}>Back to inquiry</Link>}
      {data.contactId && <Link className="underline" href={`/sales/contacts/${data.contactId}`}>{data.customerName} · customer history</Link>}
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {(sale || leadId || visitId) && <section className="space-y-4 rounded-lg border p-4">
      <div><h2 className="text-lg font-semibold">{data.customerName}</h2><p className="text-sm text-muted-foreground">{sale?.external_ref ? `${sale.external_ref} · ` : ""}{sale ? titleCase(sale.financial_state) : "New sale draft"}{sale?.status === "voided" ? " · Voided" : ""} · {sale?.currency ?? "MYR"}</p></div>
      {legacy && <p className="rounded-md bg-muted p-3 text-sm">Historical amount: {formatMoney(sale?.amount ?? 0)}. A manager can review or change this record’s classification as a full sale or collection-only; historical payments require separate review.</p>}
      {sale?.financial_state === "pending_evidence" && <p className="text-sm text-muted-foreground">Saved and recoverable. Upload evidence, then confirm. This draft does not count as a closed inquiry or recorded revenue.</p>}
      {ready && <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Net sales (excl. tax)", data.balance?.net_sales], ["Sales tax", data.balance?.sales_tax], ["Collections (net)", data.balance?.collections], ["Balance / refund due", data.balance?.balance_due]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-mono text-lg">{formatMoney(Number(value ?? 0))}</dd></div>)}
      </dl>}
      {ready && <p className="text-xs text-muted-foreground">Negative balance means money may need to be refunded. A sales credit does not claim cash was refunded. {Number(data.balance?.unreviewed_payments ?? 0)} historical payments await review.</p>}
      {editable && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Document type"><select aria-label="Document type" className={inputClass} value={documentType} onChange={e => setDocumentType(e.target.value)}><option value="invoice">Invoice</option><option value="receipt">Sales receipt</option><option value="sales_order">Confirmed sales order</option></select></Field>
          <Field label="Document number"><Input aria-label="Document number" value={ref} onChange={e => setRef(e.target.value)} placeholder="Exact invoice / receipt number" /></Field>
          <Field label="Sale date & time (Malaysia)"><Input aria-label="Sale date & time (Malaysia)" type="datetime-local" step="1" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Sale before discount, excluding tax (MYR)"><Input aria-label="Sale before discount, excluding tax (MYR)" type="number" min="0.01" step="0.01" value={gross} onChange={e => setGross(e.target.value)} /></Field>
          <Field label="Discount (MYR)"><Input aria-label="Discount (MYR)" type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></Field>
          <Field label="Separately stated tax (MYR)"><Input aria-label="Separately stated tax (MYR)" type="number" min="0" step="0.01" value={tax} onChange={e => setTax(e.target.value)} placeholder="Enter 0 when no tax applies" /></Field>
        </div>
        <p className="text-sm">Net revenue: {formatMoney(Number(gross) - Number(discount))} · Document total: {formatMoney(Number(gross) - Number(discount) + Number(tax))}</p>
        {legacy && <Field label="Historical classification reason"><Textarea aria-label="Historical classification reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="How did you verify this was the full sale value?" /></Field>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !canWrite || (legacy && !canCorrect)} onClick={save}>Save sale details</Button>
          {legacy && <Button variant="outline" disabled={pending || !canCorrect} onClick={() => run("collection_only", { reason, collection_parent_id: parentSale || undefined })}>Classify as collection-only</Button>}
        </div>
        {!data.contactId && <p className="text-sm text-muted-foreground">Confirm the customer identity on the inquiry before saving a sale.</p>}
      </div>}
      {sale && <div className="space-y-3 border-t pt-4">
        <h3 className="font-medium">Private receipts & supporting documents</h3>
        <ul className="space-y-2 text-sm">{data.receipts.map(r => <li key={r.id}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.file_name}</a> : <span>{r.file_name} · Upload incomplete, retry the file</span>}</li>)}</ul>
        {data.receipts.length === 0 && <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p>}
        <div className="flex flex-wrap gap-2"><Input aria-label="Receipt file" className="max-w-sm" type="file" accept="application/pdf,image/jpeg,image/png" disabled={pending || !canWrite} onChange={e => setFile(e.target.files?.[0] ?? null)} /><Button variant="outline" disabled={!file || pending || !canWrite} onClick={upload}>Upload evidence</Button></div>
        <p className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 5 MB. Evidence is private to authorized sales staff. Reload to renew expired document links.</p>
        {sale.financial_state === "pending_evidence" && <Button disabled={pending || !canWrite || !data.receipts.some(r => r.url)} onClick={() => run("confirm")}>Confirm documented sale & close inquiry</Button>}
      </div>}
    </section>}
    {sale && (legacy || sale.financial_state === "collection_only") && canCorrect && <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">Link a historical collection to its full sale</h2>
      {sale.collection_parent_id ? <Link className="underline text-sm" href={`/sales/record-sale?id=${sale.collection_parent_id}`}>Open linked full sale to review or record payments</Link> : <>
        <Field label="Full sale"><select aria-label="Full sale" className={inputClass} value={parentSale} onChange={e => setParentSale(e.target.value)}><option value="">Choose an existing confirmed sale</option>{data.history.filter(p => p.financial_state === "confirmed" && p.status !== "voided" && p.id !== sale.id).map(p => <option key={p.id} value={p.id ?? ""}>{p.external_ref}</option>)}</select></Field>
        <Field label="Classification / linking reason"><Textarea aria-label="Classification / linking reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">This moves unreviewed payment rows to the full sale for verification. It does not count the historical document amount as another payment. Only the customer records on the current page are shown.</p>
        <Button variant="outline" disabled={pending || !parentSale} onClick={() => run("collection_only", { reason, collection_parent_id: parentSale })}>Link collection record</Button>
      </>}
    </section>}
    {sale && ready && !sale.collection_parent_id && <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">Record a payment or adjustment</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Action"><select aria-label="Financial action" className={inputClass} value={action} onChange={e => setAction(e.target.value as SaleCommand["action"])}>
          <option value="collection">Payment collected</option>
          {canCorrect && <><option value="refund">Cash refunded</option><option value="credit">Sales credit / return</option><option value="void">Void remaining sale</option><option value="review_payment">Confirm historical payment</option><option value="link">Correct inquiry link</option></>}
        </select></Field>
        <Field label="Event date & time (Malaysia)"><Input aria-label="Event date & time (Malaysia)" type="datetime-local" step="1" value={eventDate} onChange={e => setEventDate(e.target.value)} /></Field>
        {["collection", "refund", "credit"].includes(action) && <Field label={action === "credit" ? "Credit excluding tax (MYR)" : "Actual payment amount (MYR)"}><Input aria-label="Payment or credit amount" type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></Field>}
        {action === "credit" && <Field label="Tax credit (MYR)"><Input aria-label="Tax credit (MYR)" type="number" step="0.01" min="0" value={creditTax} onChange={e => setCreditTax(e.target.value)} /></Field>}
        {["collection", "refund"].includes(action) && <><Field label="Payment method"><select aria-label="Payment method" className={inputClass} value={method} onChange={e => setMethod(e.target.value as typeof method)}>{["cash", "card", "bank_transfer", "ewallet", "cheque", "other"].map(m => <option key={m} value={m}>{titleCase(m)}</option>)}</select></Field><Field label="Payment reference"><Input aria-label="Payment reference" value={reference} onChange={e => setReference(e.target.value)} /></Field></>}
        {action === "review_payment" && <Field label="Historical payment"><select aria-label="Historical payment" className={inputClass} value={paymentId} onChange={e => setPaymentId(e.target.value)}><option value="">Choose an unreviewed payment</option>{data.payments.filter(p => p.review_state === "legacy_unclassified").map(p => <option key={p.id} value={p.id ?? ""}>{formatMoney(p.amount ?? 0)} · {p.method} · {p.reference}</option>)}</select></Field>}
        {["credit", "void", "refund"].includes(action) && <Field label="Supporting document"><select aria-label="Supporting document" className={inputClass} value={evidence} onChange={e => setEvidence(e.target.value)}><option value="">Choose uploaded evidence</option>{data.receipts.filter(r => r.url).map(r => <option key={r.id} value={r.id ?? ""}>{r.file_name}</option>)}</select></Field>}
        {action === "link" && <Field label="Original inquiry"><select aria-label="Original inquiry" className={inputClass} value={linkedLead} onChange={e => setLinkedLead(e.target.value)}><option value="">Choose customer inquiry</option>{data.inquiries.map(l => <option key={l.id} value={l.id ?? ""}>{l.raw_name} · {l.source_channel} · {formatDateTime(l.created_at)}</option>)}</select></Field>}
      </div>
      <Field label="Reason / payment details"><Textarea aria-label="Reason / payment details" value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain the payment or adjustment (at least 5 characters)" /></Field>
      <p className="text-xs text-muted-foreground">A payment changes collections only. A credit changes revenue only. Record both events if a return also involved a cash refund. Review existing payments below before adding another.</p>
      <Button disabled={pending || !canWrite} onClick={recordEvent}>Record {titleCase(action)}</Button>
    </section>}
    {sale && <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">Payment & sale history</h2>
      {data.payments.map(p => <div key={p.id} className="border-b pb-2 text-sm"><p>{titleCase(p.direction)} · {formatMoney(p.amount ?? 0)} · {titleCase(p.method)} · {p.review_state === "confirmed" ? "Confirmed" : "Unreviewed — excluded from collections"}</p><p className="text-xs text-muted-foreground">{formatDateTime(p.paid_at)} · {p.reference} · {p.reason}</p></div>)}
      {data.events.map(e => <div key={e.id} className="text-sm"><p>{titleCase(e.kind)} · {formatDateTime(e.occurred_at)}{e.net_delta ? ` · Revenue ${formatMoney(e.net_delta)}` : ""}</p><p className="text-xs text-muted-foreground">{e.reason}</p></div>)}
    </section>}
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">{data.contactId ? "This customer’s sale records" : "Sale records"} · {data.total}</h2>
      <p className="text-sm text-muted-foreground">Open an existing document to record its balance payment. Reuse historical records through review; do not enter the same document twice.</p>
      {data.history.map(p => <Link className="flex flex-wrap justify-between gap-2 rounded-md border p-3 text-sm hover:bg-muted" key={p.id} href={`/sales/record-sale?id=${p.id}`}><span>{p.external_ref ?? "No document number"} · {formatDateTime(p.purchased_at)}</span><span>{titleCase(p.financial_state)}{p.status === "voided" ? " · Voided" : ""}</span></Link>)}
      <div className="flex gap-2">{data.page > 1 && <Button asChild variant="outline"><Link href={`?${new URLSearchParams({ ...(sale?.id ? { id: sale.id } : leadId ? { lead: leadId } : visitId ? { visit: visitId } : {}), page: String(data.page - 1) })}`}>Previous</Link></Button>}{data.total > data.page * 25 && <Button asChild variant="outline"><Link href={`?${new URLSearchParams({ ...(sale?.id ? { id: sale.id } : leadId ? { lead: leadId } : visitId ? { visit: visitId } : {}), page: String(data.page + 1) })}`}>Next</Link></Button>}</div>
    </section>
  </div>;
}
