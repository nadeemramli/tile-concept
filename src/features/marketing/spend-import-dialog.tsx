"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/patterns/explain";
import { formatDateTime, formatMoney } from "@/lib/format";
import { importSpendBatchAction, previewSpendImportAction, verifySpendBatchAction, voidSpendBatchAction, type SpendImportPreview } from "@/server/commands/spend-import";
import type { Verification } from "@/features/marketing/spend-import/service";
import type { SpendBatchList } from "@/features/marketing/spend-schema";

function L({ title, children }: { title: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs font-medium">{title}{children}</label>; }
const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium">{value}</dd></div>;

/** Upload → preview (parsed and checked by the database) → import → verification. */
export function SpendImportDialog({ done }: { done: () => void }) {
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const requestId = useRef<string | null>(null);
  const [preview, setPreview] = useState<SpendImportPreview | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);

  function runPreview() {
    if (!form.current) return;
    const data = new FormData(form.current);
    requestId.current = null; setVerification(null);
    startTransition(async () => {
      const result = await previewSpendImportAction(data);
      if (!result.ok) { setPreview(null); toast.error(result.error); return; }
      setPreview(result.data);
    });
  }
  function runImport() {
    if (!form.current || !preview) return;
    // One request id per confirmed preview: a retry after a lost response returns the same batch.
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const data = new FormData(form.current);
    data.set("expected_entry_count", String(preview.summary.dates_with_spend));
    data.set("expected_total", preview.summary.total_myr);
    data.set("request_id", requestId.current);
    startTransition(async () => {
      try {
        const result = await importSpendBatchAction(data);
        if (!result.ok) { toast.error(result.error); return; }
        toast.success(`Imported ${preview.summary.dates_with_spend} TikTok daily totals`);
        setVerification(result.data.verification);
      } catch { toast.error("Could not confirm the import. Retry: the same request is never recorded twice."); }
    });
  }

  if (verification) return <><DialogHeader><DialogTitle>Import verified</DialogTitle><DialogDescription>The ledger was read back and compared with the report.</DialogDescription></DialogHeader>
    <VerificationSummary verification={verification} /><Button onClick={done}>Close</Button></>;

  const s = preview?.summary;
  return <><DialogHeader><DialogTitle>Import TikTok trend report</DialogTitle><DialogDescription>Campaign spend is summed per date into TikTok / Platform daily total / Platform advertising. Zero-spend dates are left out, MYR amounts are kept exactly and the report&apos;s missing tax is recorded as not reported, never as zero.</DialogDescription></DialogHeader>
    <form ref={form} className="space-y-4" onSubmit={e => { e.preventDefault(); runPreview(); }}><fieldset disabled={pending} className="space-y-4">
      <L title="Report file (CSV or Excel)"><Input name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" required onChange={() => setPreview(null)} /></L>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="declared_currency" value="MYR" onChange={() => setPreview(null)} className="mt-1" /><span>Only if the report does not state its currency: I confirm its amounts are MYR. The batch records the currency as declared, not stated.</span></label>
      <div className="grid gap-3 sm:grid-cols-2"><L title="Expected dates with spend (optional)"><Input name="expected_entry_count" inputMode="numeric" placeholder="e.g. 46" onChange={() => setPreview(null)} /></L><L title="Expected total, MYR (optional)"><Input name="expected_total" inputMode="decimal" placeholder="e.g. 3,269.40" onChange={() => setPreview(null)} /></L></div>
      <Button type="submit" variant="outline">{pending && !preview ? "Reading…" : "Preview"}</Button>
    </fieldset></form>
    {s && preview && <div className="space-y-3 rounded-md border p-3">
      <dl className="grid gap-3 sm:grid-cols-4">
        <Fact label="Dates with spend" value={s.dates_with_spend} />
        <Fact label="Total before tax" value={formatMoney(s.total_myr)} />
        <Fact label="Zero-spend dates left out" value={s.excluded_zero_spend_dates.length} />
        <Fact label="Tax" value={<span className="inline-flex items-center gap-1">Not reported<InfoTip label="Tax" content="A trend report carries spend only. Each entry is saved with its tax marked as not reported; a reviewer states it later from the invoice." /></span>} />
        <Fact label="Currency" value={s.currency ? `${s.currency} · ${s.currency_basis === "operator_declared" ? "declared by you" : "stated by report"}` : "Not stated"} />
        <Fact label="Report dates" value={s.report_dates.from ? `${s.report_dates.from} – ${s.report_dates.to}` : "—"} />
        <Fact label="Rows · campaigns" value={`${s.source_rows} · ${s.campaigns}`} />
        <Fact label="Report total row" value={s.report_total_row_myr ? formatMoney(s.report_total_row_myr) : "None"} />
      </dl>
      {preview.blockers.length > 0 && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm"><p className="font-medium">Cannot import yet</p><ul className="mt-1 list-disc pl-5">{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
      {s.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-muted-foreground">{s.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      {preview.conflicts.length > 0 && <div className="text-sm"><p className="font-medium">Already recorded on these dates</p><ul className="mt-1 space-y-1">{preview.conflicts.map(c => <li key={c.entry_id}>{c.incurred_on} · {c.entry_mode === "daily_total" ? "daily total" : `campaign ${c.entry_key}`} · {formatMoney(c.before_tax)} {c.same_amount ? "(matches the report)" : `(report: ${formatMoney(c.report_before_tax)})`}</li>)}</ul></div>}
      <details className="text-sm"><summary className="cursor-pointer">Dated entries ({s.entries.length})</summary><table className="mt-2 w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Date</th><th className="text-right">Before tax</th><th className="text-right">Campaigns</th><th className="text-right">Source rows</th></tr></thead><tbody>{s.entries.map(e => <tr key={e.incurred_on}><td>{e.incurred_on}</td><td className="text-right font-mono">{e.before_tax}</td><td className="text-right">{e.campaigns}</td><td className="text-right">{e.source_rows.join(", ")}</td></tr>)}</tbody></table></details>
      {preview.importable && <Button onClick={runImport} disabled={pending}>{pending ? "Importing…" : `Import ${s.dates_with_spend} dates · ${formatMoney(s.total_myr)}`}</Button>}
    </div>}</>;
}

function VerificationSummary({ verification: v }: { verification: Verification }) {
  return <div className="space-y-2 text-sm">
    <p className="font-medium">{v.reconciled ? "Reconciled: the ledger matches the imported report." : v.batch.status === "voided" ? "This batch was voided." : "Not reconciled: entries were corrected or voided after import."}</p>
    <dl className="grid gap-3 sm:grid-cols-4">
      <Fact label="Source" value={v.batch.source_name} />
      <Fact label="Imported" value={`${v.summary.entries} dates · ${formatMoney(v.summary.imported_before_tax)}`} />
      <Fact label="In the ledger now" value={formatMoney(v.summary.ledger_before_tax)} />
      <Fact label="Matching · edited · corrected · voided" value={`${v.summary.matching} · ${v.summary.edited} · ${v.summary.corrected} · ${v.summary.voided}`} />
    </dl>
    <p className="text-xs text-muted-foreground">Tax not yet stated on {v.summary.tax_unreported} entries. File fingerprint {v.batch.source_sha256.slice(0, 12)}…</p>
    {v.issues.length > 0 && <ul className="list-disc pl-5 text-xs">{v.issues.map(i => <li key={i}>{i}</li>)}</ul>}
  </div>;
}

export function SpendImportBatches({ batches, canReview }: { batches: SpendBatchList; canReview: boolean }) {
  const [verified, setVerified] = useState<Verification | null>(null);
  const [voiding, setVoiding] = useState<SpendBatchList[number] | null>(null);
  const [pending, startTransition] = useTransition();
  const voidRequest = useRef<string | null>(null);
  const router = useRouter();
  if (!batches.length) return null;
  const verify = (id: string) => startTransition(async () => { const r = await verifySpendBatchAction(id); if (r.ok) setVerified(r.data); else toast.error(r.error); });
  return <section className="space-y-2"><h2 className="flex items-center gap-1 text-sm font-medium">Recent imports<InfoTip label="Recent imports" content="Each imported report is one batch. Verify compares it with the ledger now; voiding a batch voids its entries (with your reason) so a corrected report can be imported." /></h2>
    <ul className="divide-y rounded-md border text-sm">{batches.map(b => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
      <div><p className="font-medium">{b.source_name}</p><p className="text-xs text-muted-foreground">{b.report_date_from} – {b.report_date_to} · {b.entry_count} dates · {formatMoney(b.total_before_tax)} · imported {formatDateTime(b.imported_at)}{b.status === "voided" ? ` · voided: ${b.void_reason}` : ""}</p></div>
      <div className="flex gap-1"><Button size="sm" variant="outline" disabled={pending} onClick={() => verify(b.id)}>Verify</Button>{canReview && b.status === "imported" && <Button size="sm" variant="ghost" onClick={() => { voidRequest.current = null; setVoiding(b); }}>Void batch</Button>}</div>
    </li>)}</ul>
    <Dialog open={!!verified} onOpenChange={o => { if (!o) setVerified(null); }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Batch verification</DialogTitle><DialogDescription>What the batch imported, compared with the ledger now.</DialogDescription></DialogHeader>{verified && <VerificationSummary verification={verified} />}</DialogContent></Dialog>
    <Dialog open={!!voiding} onOpenChange={o => { if (!o) setVoiding(null); }}><DialogContent><DialogHeader><DialogTitle>Void import batch</DialogTitle><DialogDescription>Every entry still recorded from {voiding?.source_name} is voided and kept in the history. The same file can then be imported again.</DialogDescription></DialogHeader>
      <form className="space-y-3" action={form => { if (!voiding) return; if (!voidRequest.current) voidRequest.current = crypto.randomUUID(); startTransition(async () => {
        const r = await voidSpendBatchAction({ batch_id: voiding.id, reason: form.get("reason"), request_id: voidRequest.current });
        if (!r.ok) { toast.error(r.error); return; } toast.success("Batch voided"); setVoiding(null); router.refresh();
      }); }}><L title="Reason"><Textarea name="reason" required minLength={5} maxLength={2000} /></L><Button type="submit" variant="destructive" disabled={pending}>{pending ? "Voiding…" : "Void batch"}</Button></form></DialogContent></Dialog>
  </section>;
}
