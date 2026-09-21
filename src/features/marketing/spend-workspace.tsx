"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { DataTable, MoneyCell } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Gated } from "@/components/patterns/explain";
import { recordSpendAction } from "@/server/commands/spend";
import type { SpendData } from "@/server/queries/funnel";
import { PLATFORM_LABELS, reportingToday, type ReportPeriod } from "@/features/reports/funnel-schema";

type Expense = SpendData["rows"][number];
const money = (n: number) => new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
function L({ title, children }: { title: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs font-medium">{title}{children}</label>; }

export function SpendWorkspace({ data, period, canWrite, canReview, canReport }: { data: SpendData; period: ReportPeriod; canWrite: boolean; canReview: boolean; canReport: boolean }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ action: "save" | "void" | "credit" | "coverage"; row?: Expense } | null>(null);
  const columns: ColumnDef<Expense, unknown>[] = [
    { accessorKey: "incurred_on", header: "Incurred on" },
    { accessorKey: "platform", header: "Cost group", cell: ({ row }) => PLATFORM_LABELS[row.original.platform ?? ""] },
    { accessorKey: "entry_key", header: "Campaign / event", cell: ({ row }) => <div><p className="font-medium">{row.original.entry_key}</p><p className="max-w-72 truncate text-xs text-muted-foreground">{row.original.description}</p></div> },
    { accessorKey: "vendor", header: "Vendor" }, { accessorKey: "reference", header: "Reference" },
    { id: "cost", header: "Invoice cost", meta: { hint: "Amount before tax plus tax. Credits reduce spend on their own incurred date; voided records are excluded." }, cell: ({ row }) => <MoneyCell value={((row.original.before_tax ?? 0) + (row.original.tax ?? 0)) * (row.original.credit_of ? -1 : 1)} /> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => row.original.status === "voided" ? "Voided · excluded" : row.original.credit_of ? "Vendor credit" : "Recorded" },
    { id: "actions", header: "Actions", cell: ({ row }) => <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setDialog({ action: "save", row: row.original })}>Details</Button>{canReview && row.original.status === "recorded" && <><Button size="sm" variant="ghost" onClick={() => setDialog({ action: "void", row: row.original })}>Void</Button>{!row.original.credit_of && <Button size="sm" variant="ghost" onClick={() => setDialog({ action: "credit", row: row.original })}>Credit</Button>}</>}</div> },
  ];
  const pageHref = (page: number) => `/marketing/spend?${new URLSearchParams({ from: period.from, to: period.to, page: String(page) })}`;
  return <PageBody><PageHeader title="Marketing spend" description="Record incurred advertising, content and other marketing costs. MER uses the full invoice cost, including tax."><div className="flex flex-wrap gap-2">{canReport && <Button variant="outline" asChild><Link href="/insights/reports/funnel">Funnel dashboard</Link></Button>}<Gated permission="marketing.spend.write"><Button onClick={() => setDialog({ action: "save" })}>Add marketing cost</Button></Gated></div></PageHeader>
    <form className="flex flex-wrap items-end gap-3" method="get"><L title="From"><Input type="date" name="from" defaultValue={period.from} required /></L><L title="To"><Input type="date" name="to" defaultValue={period.to} max={reportingToday()} required /></L><Button variant="outline">Apply period</Button><Gated permission="marketing.spend.review"><Button type="button" variant="outline" onClick={() => setDialog({ action: "coverage" })}>Confirm spending coverage</Button></Gated></form>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.totals.map(t => <MetricCard key={t.platform} label={PLATFORM_LABELS[t.platform]} value={money(t.amount)} hint={`${t.covered_days} / ${t.days} days checked`} tone={t.covered_days === t.days ? "success" : "warning"} info={{ definition: "Recorded incurred costs including tax, less dated vendor credits. Voided entries excluded.", grain: "Selected period · MYR", source: "Marketing cost ledger", caveat: "An unchecked day is missing coverage, not proof of zero spend. Changes invalidate earlier coverage checks." }} />)}</div>
    <p className="text-sm text-muted-foreground">For each platform and day, enter either one daily total or separate campaign costs. Shared content, influencer and event costs remain unallocated to a platform.</p>
    <DataTable columns={columns} data={data.rows} rowKey={r => r.id ?? ""} hidePagination searchable={false} columnToggle={false} emptyTitle="No marketing costs in this period" emptyDescription="Add the actual daily or event cost, then confirm coverage after checking the source statements." />
    <div className="flex items-center justify-between text-xs"><span>{data.total} records · page {period.page} of {Math.max(1, Math.ceil(data.total / 25))}</span><div className="flex gap-2">{period.page > 1 && <Button size="sm" variant="outline" asChild><Link href={pageHref(period.page - 1)}>Previous</Link></Button>}{period.page * 25 < data.total && <Button size="sm" variant="outline" asChild><Link href={pageHref(period.page + 1)}>Next</Link></Button>}</div></div>
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">{dialog && <SpendForm key={`${dialog.action}:${dialog.row?.id ?? "new"}`} action={dialog.action} row={dialog.row} period={period} readOnly={!canWrite || (!!dialog.row && (!canReview || dialog.row.status === "voided" || (!!dialog.row.credit_of && dialog.action === "save")))} done={() => { setDialog(null); router.refresh(); }} />}</DialogContent></Dialog>
  </PageBody>;
}
function SpendForm({ action, row, period, readOnly, done }: { action: "save" | "credit" | "void" | "coverage"; row?: Expense; period: ReportPeriod; readOnly: boolean; done: () => void }) {
  const [pending, startTransition] = useTransition(); const requestId = useRef<string | null>(null);
  const [platform, setPlatform] = useState(row?.platform ?? "tiktok");
  const [mode, setMode] = useState(row?.entry_mode ?? "daily_total");
  const isCredit = action === "credit"; const amountForm = action === "save" || isCredit;
  const title = action === "coverage" ? "Confirm spending coverage" : action === "void" ? "Void marketing cost" : isCredit ? "Record vendor credit" : row ? "Marketing cost details" : "Add marketing cost";
  function submit(form: FormData) {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const values: Record<string, unknown> = Object.fromEntries(form.entries());
    if (action === "coverage") values.complete = form.get("complete") === "on";
    if (amountForm) { values.currency = "MYR"; if (values.original_amount === "") delete values.original_amount; }
    startTransition(async () => {
      try {
        const result = await recordSpendAction({ ...values, action, request_id: requestId.current, id: row?.id ?? undefined, version: row?.version ?? undefined });
        if (!result.ok) { toast.error(result.error); return; }
        toast.success(action === "coverage" ? "Coverage confirmed" : "Marketing cost saved"); done();
      } catch { toast.error("Could not confirm the save. Retry with the same details; the request will not be recorded twice."); }
    });
  }
  return <><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{action === "coverage" ? "Confirm that every cost for this group is recorded, including days with zero spend. Any subsequent change requires a fresh check." : "Enter amounts from the source statement or invoice. Corrections retain the audit history."}</DialogDescription></DialogHeader>
    <form action={submit} className="space-y-4"><fieldset disabled={pending || readOnly} className="space-y-4">
      {action === "coverage" ? <><L title="Cost group"><select name="platform" className={selectClass}>{["tiktok", "meta", "google_ads", "shared"].map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</select></L><div className="grid grid-cols-2 gap-3"><L title="From"><Input name="date_from" type="date" defaultValue={period.from} required /></L><L title="To"><Input name="date_to" type="date" defaultValue={period.to} max={reportingToday()} required /></L></div><label className="flex gap-2 text-sm"><input type="checkbox" name="complete" required />I checked all costs and zero-spend days in this range.</label></> : amountForm ? <>
        <div className="grid gap-3 sm:grid-cols-2"><L title={isCredit ? "Credit date" : "Incurred on"}><Input name="incurred_on" type="date" defaultValue={isCredit ? reportingToday() : row?.incurred_on ?? reportingToday()} max={reportingToday()} required /></L><L title="Cost group"><select name="platform" disabled={isCredit} value={platform} onChange={e => { setPlatform(e.target.value); setMode(e.target.value === "shared" ? "event" : "daily_total"); }} className={selectClass}>{["tiktok", "meta", "google_ads", "shared"].map(p => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}</select></L></div>
        <div className="grid gap-3 sm:grid-cols-2"><L title="Entry method"><select name="entry_mode" value={isCredit ? "credit" : mode} onChange={e => setMode(e.target.value)} className={selectClass}>{isCredit ? <option value="credit">Vendor credit</option> : platform === "shared" ? <option value="event">Event / one-off cost</option> : <><option value="daily_total">Platform daily total</option><option value="campaign">Campaign detail for a day</option></>}</select></L><L title="Category"><select name="category" disabled={isCredit} defaultValue={row?.category ?? (platform === "shared" ? "content" : "platform_ads")} key={platform} className={selectClass}>{platform !== "shared" ? <option value="platform_ads">Platform advertising</option> : ["influencer", "content", "creative", "agency", "event", "other"].map(c => <option key={c}>{c}</option>)}</select></L></div>
        <L title={isCredit ? "Unique credit key" : "Campaign / event key"}><Input name="entry_key" defaultValue={isCredit ? "" : row?.entry_key ?? ""} required={isCredit || mode !== "daily_total"} placeholder={mode === "daily_total" ? "Daily total (set automatically)" : "A short, unique campaign or event identifier"} maxLength={160} /></L>
        <div className="grid gap-3 sm:grid-cols-2"><L title="Vendor"><Input name="vendor" defaultValue={row?.vendor ?? ""} required maxLength={160} /></L><L title="Invoice / statement reference"><Input name="reference" defaultValue={isCredit ? "" : row?.reference ?? ""} required maxLength={160} /></L></div>
        <L title="Description / remarks"><Textarea name="description" defaultValue={row?.description ?? ""} required maxLength={2000} /></L>
        <div className="grid grid-cols-2 gap-3"><L title={isCredit ? "Credit before tax (MYR)" : "Cost before tax (MYR)"}><Input name="before_tax" type="number" min="0" step="0.01" defaultValue={isCredit ? "" : row?.before_tax ?? ""} required /></L><L title="Tax (MYR; enter 0 if none)"><Input name="tax" type="number" min="0" step="0.01" defaultValue={isCredit ? "" : row?.tax ?? ""} required /></L></div>
        <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer">Foreign invoice conversion details (if applicable)</summary><div className="mt-3 grid gap-3"><L title="Original currency"><Input name="original_currency" defaultValue={isCredit ? "" : row?.original_currency ?? ""} placeholder="USD" maxLength={3} /></L><L title="Original invoice amount"><Input name="original_amount" type="number" min="0" step="0.01" defaultValue={isCredit ? "" : row?.original_amount ?? ""} /></L><L title="Evidence for MYR conversion"><Textarea name="conversion_note" defaultValue={isCredit ? "" : row?.conversion_note ?? ""} placeholder="Actual billed MYR amount or documented exchange rate and date" maxLength={1000} /></L></div></details>
      </> : <p className="text-sm">{row?.description} · {money((row?.before_tax ?? 0) + (row?.tax ?? 0))}. This removes the cost from spending totals and retains the record.</p>}
      {(row || action === "coverage") && <L title={action === "coverage" ? "What did you check?" : "Reason for change"}><Textarea name="reason" required minLength={5} maxLength={2000} /></L>}
      {!readOnly && <Button type="submit" disabled={pending}>{pending ? "Saving…" : action === "coverage" ? "Confirm coverage" : action === "void" ? "Void cost" : isCredit ? "Record credit" : row ? "Save correction" : "Save cost"}</Button>}
    </fieldset>{readOnly && <p className="text-sm text-muted-foreground">This record is read-only. A marketing cost reviewer can correct active costs; credits can be voided and entered again.</p>}</form></>;
}
