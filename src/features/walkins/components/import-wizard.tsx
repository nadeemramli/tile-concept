"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { AlertTriangle, Check, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TonePill } from "@/components/patterns/status-pill";
import { Field } from "@/components/patterns/field";
import { formatMoney } from "@/lib/format";
import { normalizePhone } from "@/lib/identity/normalize";
import { cn } from "@/lib/utils";
import { checkImportDuplicatesAction, commitImportAction, type ImportCommitResult } from "@/server/commands/walkins";
import type { ImportRow } from "@/features/walkins/schema";

const TARGETS = [
  { key: "date", label: "Date", required: true },
  { key: "salesperson", label: "Salesperson" },
  { key: "customer_name", label: "Customer name", required: true },
  { key: "phone", label: "Contact phone", required: true },
  { key: "origin_area", label: "Origin / area" },
  { key: "new_existing", label: "Customer status (new/existing)" },
  { key: "customer_type", label: "Customer type" },
  { key: "renovation_area", label: "Area / renovation" },
  { key: "orc_number", label: "ORC number" },
  { key: "amount", label: "Collection amount" },
  { key: "sq_number", label: "SQ / quotation number" },
  { key: "quotation_amount", label: "Quotation amount" },
  { key: "inquiry_source", label: "How customer heard" },
  { key: "online_enquiry", label: "Online enquiry? (flag)" },
  { key: "walk_in", label: "Walk in? (flag)" },
  { key: "pay_cash", label: "Payment: cash (flag/amount)" },
  { key: "pay_card", label: "Payment: card (flag/amount)" },
  { key: "pay_transfer", label: "Payment: transfer (flag/amount)" },
  { key: "pay_ewallet", label: "Payment: e-wallet (flag/amount)" },
] as const;
type TargetKey = (typeof TARGETS)[number]["key"];

const GUESS: Record<TargetKey, RegExp> = {
  date: /date|tarikh/i,
  salesperson: /^smp$|sales|staff|pic/i,
  customer_name: /customer name|name|nama/i,
  phone: /phone|contact|tel|hp|mobile/i,
  origin_area: /^from$|origin|kawasan/i,
  new_existing: /status|new|existing/i,
  customer_type: /type|category/i,
  renovation_area: /renovation|renovate|\breno\b/i,
  orc_number: /orc|receipt/i,
  amount: /collection|deposit/i,
  sq_number: /sq|quotation number|quote no|quotation no/i,
  quotation_amount: /quotation amount|quote amount|quotation.*rm|quotation \(rm\)/i,
  inquiry_source: /how.*(know|hear)|source|channel|enquiry source/i,
  online_enquiry: /online/i,
  walk_in: /walk/i,
  pay_cash: /cash/i,
  pay_card: /card/i,
  pay_transfer: /transfer|bank|tng|duitnow/i,
  pay_ewallet: /wallet|grab|boost/i,
};

type RowStatus = "valid" | "corrected" | "duplicate" | "rejected";
interface PreviewRow extends ImportRow { status: RowStatus; messages: string[] }

function truthy(v: unknown) {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  const s = String(v ?? "").trim().toLowerCase();
  return ["y", "yes", "x", "✓", "true", "1", "ya"].includes(s) || (Number(s) > 0);
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}
function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0)).toISOString();
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function ImportWizard({ locations }: { locations: { id: string; name: string }[] }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetKey, string>>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [pending, start] = useTransition();
  const wbRef = useRef<XLSX.WorkBook | null>(null);

  function loadSheet(name: string) {
    const wb = wbRef.current;
    if (!wb || !wb.Sheets[name]) return;
    const ws = wb.Sheets[name];
    // Daily Tracker sheets carry a title row above the real header row, so find
    // the header row (first row that looks like column headers) rather than
    // assuming row 1.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
    let headerIdx = matrix.findIndex((r) => r.some((c) => /customer|nama|posting date|description/i.test(String(c))) && r.some((c) => /date|tarikh|^no$|document/i.test(String(c))));
    if (headerIdx < 0) headerIdx = 0;
    const hdrs = (matrix[headerIdx] ?? []).map((c, i) => String(c).trim() || `Column ${i + 1}`);
    const json = matrix.slice(headerIdx + 1).map((r) => Object.fromEntries(hdrs.map((h, i) => [h, r[i] ?? ""])));
    setHeaders(hdrs);
    setRows(json);
    setPreview(null);
    setResult(null);
    const guess: Partial<Record<TargetKey, string>> = {};
    for (const t of TARGETS) {
      const hit = hdrs.find((h) => GUESS[t.key].test(h) && !Object.values(guess).includes(h));
      if (hit) guess[t.key] = hit;
    }
    setMapping(guess);
    setSheetName(name);
    toast.success(`Read ${json.length} rows from ${name}.`);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array", cellDates: true });
        wbRef.current = wb;
        setSheetNames(wb.SheetNames);
        setFileName(file.name);
        loadSheet(wb.SheetNames[0]);
      } catch {
        toast.error("Could not read that file. Use .xlsx, .xls or .csv.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const missingRequired = TARGETS.filter((t) => "required" in t && t.required && !mapping[t.key]);

  function buildPreview() {
    const get = (r: Record<string, unknown>, k: TargetKey) => (mapping[k] ? r[mapping[k]!] : undefined);
    const out: PreviewRow[] = rows.map((r, i) => {
      const messages: string[] = [];
      let status: RowStatus = "valid";
      const date = toIsoDate(get(r, "date"));
      const name = String(get(r, "customer_name") ?? "").trim();
      const rawPhone = String(get(r, "phone") ?? "").trim();
      const phone = normalizePhone(rawPhone);
      const amount = num(get(r, "amount"));
      if (!date) { status = "rejected"; messages.push("Bad or missing date"); }
      if (!name) { status = "rejected"; messages.push("Missing customer name"); }
      if (!phone) { status = "rejected"; messages.push("Missing/invalid phone"); }
      else if (phone !== rawPhone) { if (status === "valid") status = "corrected"; messages.push(`Phone normalized to ${phone}`); }
      if (get(r, "amount") !== undefined && get(r, "amount") !== "" && amount === null) { status = "rejected"; messages.push("Amount is not a number"); }
      const payments: ImportRow["payments"] = [];
      const flagAmount = (k: TargetKey, method: ImportRow["payments"][number]["method"]) => {
        const v = get(r, k);
        if (v === undefined || v === "" || v === null) return;
        if (truthy(v)) {
          const n = typeof v === "number" ? v : num(v);
          payments.push({ method, amount: n && n > 1 ? n : 0 });
        }
      };
      flagAmount("pay_cash", "cash"); flagAmount("pay_card", "card"); flagAmount("pay_transfer", "bank_transfer"); flagAmount("pay_ewallet", "ewallet");
      if (amount !== null && payments.length === 1 && payments[0].amount === 0) payments[0].amount = amount;
      if (payments.some((p) => p.amount === 0)) { payments.length = 0; messages.push("Payment flags without amounts — split not imported"); if (status === "valid") status = "corrected"; }
      const sourceFlagOnline = truthy(get(r, "online_enquiry"));
      const inquiry = String(get(r, "inquiry_source") ?? "").trim() || (sourceFlagOnline ? "website" : "walk_in");
      return {
        row_no: i + 2,
        date: date ?? "",
        salesperson: String(get(r, "salesperson") ?? "").trim(),
        customer_name: name,
        phone: rawPhone,
        origin_area: String(get(r, "origin_area") ?? "").trim(),
        new_existing: String(get(r, "new_existing") ?? "").trim(),
        customer_type: String(get(r, "customer_type") ?? "").trim(),
        renovation_area: String(get(r, "renovation_area") ?? "").trim(),
        orc_number: String(get(r, "orc_number") ?? "").trim(),
        amount,
        quotation_ref: String(get(r, "sq_number") ?? "").trim(),
        quotation_amount: num(get(r, "quotation_amount")),
        inquiry_source: inquiry,
        payments,
        status,
        messages,
      };
    });
    setPreview(out);
    start(async () => {
      const r = await checkImportDuplicatesAction(out.filter((x) => x.status !== "rejected").map((x) => ({ row_no: x.row_no, orc_number: x.orc_number, phone: x.phone, date: x.date })));
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const dup = new Set(r.data.duplicate_rows);
      setPreview((p) => (p ?? []).map((x) => (dup.has(x.row_no) ? { ...x, status: "duplicate", messages: [...x.messages, r.data.reasons[x.row_no] ?? "Duplicate"] } : x)));
    });
  }

  const stats = useMemo(() => {
    const s = { valid: 0, corrected: 0, duplicate: 0, rejected: 0 };
    for (const p of preview ?? []) s[p.status] += 1;
    return s;
  }, [preview]);
  const commitRows = (preview ?? []).filter((p) => p.status === "valid" || p.status === "corrected");

  function commit() {
    start(async () => {
      const r = await commitImportAction(commitRows.slice(0, 500).map((p) => ({ row_no: p.row_no, date: p.date, salesperson: p.salesperson, customer_name: p.customer_name, phone: p.phone, origin_area: p.origin_area, new_existing: p.new_existing, customer_type: p.customer_type, renovation_area: p.renovation_area, orc_number: p.orc_number, amount: p.amount, quotation_ref: p.quotation_ref, quotation_amount: p.quotation_amount, inquiry_source: p.inquiry_source, payments: p.payments })), { location_id: locationId || undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setResult(r.data);
    });
  }

  if (result) {
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-base font-semibold"><Check className="size-4 text-success" aria-hidden /> Import committed</div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[["Visits", result.visits], ["Purchases", result.purchases], ["Contacts created", result.contacts_created], ["Contacts reused", result.contacts_reused], ["Skipped", result.skipped]].map(([l, v]) => (
            <div key={String(l)}><dt className="text-[11px] text-muted-foreground">{l}</dt><dd className="tnum text-xl font-semibold">{v}</dd></div>
          ))}
        </dl>
        {result.errors.length > 0 && (
          <ul className="max-h-48 overflow-y-auto rounded-md border text-xs">
            {result.errors.map((e) => <li key={e.row_no} className="flex gap-2 border-b px-2 py-1 last:border-b-0"><span className="tnum w-12 text-muted-foreground">row {e.row_no}</span><span>{e.error}</span></li>)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Every imported row is audited. Keep the workbook as a read-only archive; from now on, record walk-ins in the app.</p>
        <div className="flex gap-2">
          <Button asChild><Link href="/sales/walk-ins">Open walk-ins</Link></Button>
          <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setRows([]); setHeaders([]); setFileName(null); setSheetNames([]); setSheetName(""); wbRef.current = null; }}>Import another file</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-card px-3 text-sm hover:bg-accent/50">
            <Upload className="size-4" aria-hidden /> Choose .xlsx / .csv
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {fileName && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" aria-hidden /> {fileName} · {rows.length} rows · {headers.length} columns</span>}
          {sheetNames.length > 1 && (
            <div className="w-44">
              <Select value={sheetName} onValueChange={loadSheet}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Sheet" /></SelectTrigger>
                <SelectContent>{sheetNames.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="ml-auto w-56">
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Default location" /></SelectTrigger>
              <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Pick the month sheet to import; it is read in the browser and nothing is uploaded until you commit. The title row above the headers is skipped automatically. Boolean columns (Online enquiry?, Walk in?, payment flags) are normalized into channel and payment records — they are not copied as schema.</p>
      </Card>

      {headers.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="text-sm font-medium">Column mapping</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TARGETS.map((t) => (
              <Field key={t.key} label={t.label} required={"required" in t && !!t.required}>
                <Select value={mapping[t.key] ?? "__none"} onValueChange={(v) => setMapping((m) => ({ ...m, [t.key]: v === "__none" ? undefined : v }))}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Not mapped" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not mapped</SelectItem>
                    {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex items-center justify-between">
            {missingRequired.length > 0 ? <span className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" aria-hidden /> Map {missingRequired.map((m) => m.label).join(", ")}</span> : <span className="text-xs text-muted-foreground">Required columns mapped.</span>}
            <Button size="sm" onClick={buildPreview} disabled={missingRequired.length > 0 || rows.length === 0}>Preview rows</Button>
          </div>
        </Card>
      )}

      {preview && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <TonePill tone="success" label={`${stats.valid} valid`} size="md" />
            <TonePill tone="info" label={`${stats.corrected} corrected`} size="md" />
            <TonePill tone="warning" label={`${stats.duplicate} duplicate (skipped)`} size="md" />
            <TonePill tone="destructive" label={`${stats.rejected} rejected`} size="md" />
            <Button className="ml-auto" size="sm" disabled={pending || commitRows.length === 0} onClick={commit}>
              {pending ? "Working…" : `Commit ${Math.min(commitRows.length, 500)} row${commitRows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
          {commitRows.length > 500 && <p className="text-xs text-warning">Only the first 500 committable rows are imported per commit. Re-run for the rest.</p>}
          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="h-8 text-xs">Row</TableHead>
                  <TableHead className="h-8 text-xs">Status</TableHead>
                  <TableHead className="h-8 text-xs">Date</TableHead>
                  <TableHead className="h-8 text-xs">Customer</TableHead>
                  <TableHead className="h-8 text-xs">Phone</TableHead>
                  <TableHead className="h-8 text-xs">ORC</TableHead>
                  <TableHead className="h-8 text-xs">Amount</TableHead>
                  <TableHead className="h-8 text-xs">Payments</TableHead>
                  <TableHead className="h-8 text-xs">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((p) => (
                  <TableRow key={p.row_no} className={cn(p.status === "rejected" && "opacity-60")}>
                    <TableCell className="tnum py-1 text-xs">{p.row_no}</TableCell>
                    <TableCell className="py-1"><TonePill tone={p.status === "valid" ? "success" : p.status === "corrected" ? "info" : p.status === "duplicate" ? "warning" : "destructive"} label={p.status} /></TableCell>
                    <TableCell className="tnum py-1 text-xs">{p.date ? p.date.slice(0, 10) : "—"}</TableCell>
                    <TableCell className="py-1 text-xs">{p.customer_name || "—"}<div className="text-[10px] text-muted-foreground">{[p.customer_type, p.origin_area, p.renovation_area].filter(Boolean).join(" · ")}</div></TableCell>
                    <TableCell className="py-1 font-mono text-xs">{p.phone || "—"}</TableCell>
                    <TableCell className="py-1 font-mono text-xs">{p.orc_number || "—"}</TableCell>
                    <TableCell className="tnum py-1 text-xs">{p.amount !== null ? formatMoney(p.amount) : "—"}</TableCell>
                    <TableCell className="py-1 text-xs">{p.payments.map((x) => x.method).join(", ") || "—"}</TableCell>
                    <TableCell className="py-1 text-[11px] text-muted-foreground">{p.messages.join("; ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
