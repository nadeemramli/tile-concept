"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/patterns/field";
import { DisabledHint, InfoTip } from "@/components/patterns/explain";
import { StatusPill } from "@/components/patterns/status-pill";
import { PRODUCT_STATUS, REVIEW_STATE } from "@/lib/domain/status-maps";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { mergeProductsAction, previewProductMergeAction } from "@/server/commands/catalog-merge";
import type { MergeImpact } from "@/features/catalog/merge-schema";

const MOVE = "__move__";
const COUNT_LABELS: Record<string, string> = {
  variants_moved: "Variants moved as they are",
  variants_merged: "Variants merged into a surviving variant",
  prices: "Prices (all states, history kept)",
  stock_records: "Stock records (snapshots, movements, mappings, supplier updates)",
  sales_lines: "Purchase and quote lines",
  media: "Media attachments",
  aliases: "Aliases",
  attribute_values: "Attribute values",
  catalog_entries: "Catalogue page entries",
  certificate_scopes: "Certificate scopes",
  source_links: "Import provenance links",
};

export function ProductMergeReview({ initial, brands, categories }: { initial: MergeImpact; brands: Record<string, string>; categories: Record<string, string> }) {
  const router = useRouter();
  const [impact, setImpact] = useState(initial);
  const [map, setMap] = useState<Record<string, string | null>>(initial.variant_map ?? {});
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const s = impact.survivor, m = impact.merged;

  function repreview(next: Record<string, string | null>) {
    setMap(next);
    setConfirmed(false); // what was confirmed has changed
    start(async () => {
      const res = await previewProductMergeAction({ survivor_id: s.id, merged_id: m.id, variant_map: next });
      if (!res.ok) { toast.error(res.error); return; }
      setImpact(res.data);
    });
  }

  function merge() {
    start(async () => {
      const res = await mergeProductsAction({ survivor_id: s.id, merged_id: m.id, variant_map: map, reason, fingerprint: impact.fingerprint, confirmed: confirmed as true });
      if (!res.ok) {
        toast.error(res.error);
        // A stale preview or a new conflict: show the current state before anyone tries again.
        const fresh = await previewProductMergeAction({ survivor_id: s.id, merged_id: m.id, variant_map: map });
        if (fresh.ok) { setImpact(fresh.data); setConfirmed(false); }
        return;
      }
      toast.success(res.message ?? "Products merged");
      router.push(`/merchandise/catalog/${res.data.survivor_id}`);
    });
  }

  const rows: { label: string; a: React.ReactNode; b: React.ReactNode }[] = [
    { label: "Name", a: s.name, b: m.name },
    { label: "Code", a: <span className="font-mono">{s.code ?? "—"}</span>, b: <span className="font-mono">{m.code ?? "—"}</span> },
    { label: "Brand", a: (s.brand_id && brands[s.brand_id]) ?? "—", b: (m.brand_id && brands[m.brand_id]) ?? "—" },
    { label: "Category", a: (s.category_id && categories[s.category_id]) ?? "—", b: (m.category_id && categories[m.category_id]) ?? "—" },
    { label: "Status", a: <StatusPill map={PRODUCT_STATUS} value={s.status} />, b: <StatusPill map={PRODUCT_STATUS} value={m.status} /> },
    { label: "Review", a: <StatusPill map={REVIEW_STATE} value={s.review_state} />, b: <StatusPill map={REVIEW_STATE} value={m.review_state} /> },
    { label: "Source", a: s.source_ref ?? "Not recorded", b: m.source_ref ?? "Not recorded" },
    { label: "Variants", a: s.variants.map((v) => v.sku ?? v.name ?? "Variant").join(", ") || "None", b: m.variants.map((v) => v.sku ?? v.name ?? "Variant").join(", ") || "None" },
  ];
  const blockers = [
    impact.conflicts.length > 0 && "resolve the conflicts listed above",
    !reason.trim() && "state why these are the same product",
    !confirmed && "tick the confirmation",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <section aria-label="Compare products" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">1 · Compare and choose the survivor</h2>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => router.push(`/merchandise/catalog/merge?survivor=${m.id}&merged=${s.id}`)}>
            <ArrowLeftRight className="size-4" aria-hidden /> Keep the other product instead
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 w-32 text-xs" />
                <TableHead className="h-9 text-xs">Keep <Link className="font-medium text-foreground underline" href={`/merchandise/catalog/${s.id}`}>{s.name}</Link></TableHead>
                <TableHead className="h-9 text-xs">Duplicate (archived after merge) <Link className="font-medium text-foreground underline" href={`/merchandise/catalog/${m.id}`}>{m.name}</Link></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => <TableRow key={r.label}><TableCell className="py-1.5 text-[13px] text-muted-foreground">{r.label}</TableCell><TableCell className="py-1.5 text-[13px]">{r.a}</TableCell><TableCell className="py-1.5 text-[13px]">{r.b}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label="Variant decisions" className="space-y-2">
        <h2 className="text-sm font-medium">2 · Decide each duplicate variant <InfoTip label="Variant decisions" content="Move keeps it as its own variant under the surviving product. Merge folds it into a surviving variant: its prices, stock, sales lines and media follow it. Same SKU or supplier code is suggested, never applied without you." /></h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead className="h-9 text-xs">Duplicate variant</TableHead><TableHead className="h-9 text-xs">Prices</TableHead><TableHead className="h-9 text-xs">Stock records</TableHead><TableHead className="h-9 text-xs">Sales lines</TableHead><TableHead className="h-9 text-xs">Media</TableHead><TableHead className="h-9 w-72 text-xs">Decision</TableHead></TableRow></TableHeader>
            <TableBody>
              {m.variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="py-1.5 text-[13px]"><span className="font-mono">{v.sku ?? "—"}</span> {v.name ?? ""}</TableCell>
                  <TableCell className="tnum py-1.5 text-[13px]">{v.prices ?? 0}</TableCell>
                  <TableCell className="tnum py-1.5 text-[13px]">{v.stock_records ?? 0}</TableCell>
                  <TableCell className="tnum py-1.5 text-[13px]">{v.sales_lines ?? 0}</TableCell>
                  <TableCell className="tnum py-1.5 text-[13px]">{v.media ?? 0}</TableCell>
                  <TableCell className="py-1.5">
                    <label htmlFor={`decision-${v.id}`} className="sr-only">Decision for {v.sku ?? v.name ?? "variant"}</label>
                    <SimpleSelect
                      id={`decision-${v.id}`}
                      value={map[v.id] ?? MOVE}
                      allowNone={false}
                      disabled={pending}
                      onChange={(value) => repreview({ ...map, [v.id]: value === MOVE ? null : value })}
                      options={[{ value: MOVE, label: "Move to the surviving product" }, ...s.variants.map((t) => ({ value: t.id, label: `Merge into ${t.sku ?? t.name ?? "variant"}${t.id === v.suggested_target ? " (same code)" : ""}` }))]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label="Impact" className="space-y-2">
        <h2 className="text-sm font-medium">3 · What will change</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2" data-testid="merge-impact">
          {Object.entries(COUNT_LABELS).map(([k, label]) => <li key={k} className="flex justify-between gap-3 rounded border px-2 py-1"><span>{label}</span><span className="tnum font-medium">{impact.counts[k] ?? 0}</span></li>)}
        </ul>
        <p className="text-xs text-muted-foreground">Everything listed moves to the surviving product in one transaction. Identical duplicate facts are removed and kept in the merge record; the duplicate product stays, archived, pointing at the survivor, and its name and code become aliases.</p>
        {impact.conflicts.length > 0 ? (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-destructive"><AlertTriangle className="size-4" aria-hidden /> Merge blocked</p>
            <ul className="list-disc pl-5">{impact.conflicts.map((c, i) => <li key={`${c.code}-${i}`}>{c.message}</li>)}</ul>
          </div>
        ) : null}
      </section>

      <section aria-label="Confirm" className="space-y-2">
        <h2 className="text-sm font-medium">4 · Confirm</h2>
        <Field label="Why are these the same product?" htmlFor="merge-reason" required hint="Kept in the merge record and the audit trail.">
          <Textarea id="merge-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={confirmed} disabled={pending} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>I compared both products and confirm they are the same product. Archive &ldquo;{m.name}&rdquo; and move its records to &ldquo;{s.name}&rdquo; as shown.</span>
        </label>
        <DisabledHint reason={blockers.length ? `Not yet: ${blockers.join(", ")}.` : null}>
          <Button variant="destructive" disabled={pending || blockers.length > 0} onClick={merge}>{pending ? "Working…" : "Merge products"}</Button>
        </DisabledHint>
      </section>
    </div>
  );
}
