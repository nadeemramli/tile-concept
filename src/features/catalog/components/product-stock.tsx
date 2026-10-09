"use client";

import { Suspense, use, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/patterns/status-pill";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { InfoTip } from "@/components/patterns/explain";
import { EmptyState, ErrorState, PermissionDenied, SkeletonTable } from "@/components/patterns/states";
import { useSession } from "@/components/shell/session-context";
import { SOURCE_KIND } from "@/features/stock/status";
import { AvailabilityCell, QuantityCell } from "@/features/stock/components/quantity-cell";
import { formatNumber } from "@/lib/format";
import type { AvailabilityRow, ProductStockResult } from "@/server/queries/stock";

type Variant = { id: string; sku: string | null; name: string | null };

/**
 * The product's slice of the Stock module: in-house balances per variant and
 * warehouse plus supplier evidence, each with its source and age. A variant
 * with no record says so; it is never shown as zero.
 */
export function ProductStock({ stock, variants, productCode }: { stock: Promise<ProductStockResult> | null; variants: Variant[]; productCode: string | null }) {
  const { session } = useSession();
  if (!stock) return <PermissionDenied permission="stock.read" roleLabel={session.roleLabel} />;
  return (
    <Suspense fallback={<div className="space-y-2"><p className="text-sm text-muted-foreground">Loading stock…</p><SkeletonTable rows={3} cols={6} /></div>}>
      <StockLines stock={stock} variants={variants} productCode={productCode} />
    </Suspense>
  );
}

function StockLines({ stock, variants, productCode }: { stock: Promise<ProductStockResult>; variants: Variant[]; productCode: string | null }) {
  const result = use(stock);
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const moduleHref = productCode ? `/merchandise/stock?q=${encodeURIComponent(productCode)}` : "/merchandise/stock";

  if (!result.ok) {
    return (
      <div className="space-y-3">
        <ErrorState title="Stock could not be loaded" description={`${result.error} Nothing is shown rather than a possibly wrong figure.`} />
        <Button size="sm" variant="outline" disabled={retrying} onClick={() => startRetry(() => router.refresh())}><RotateCw className="size-3.5" aria-hidden /> {retrying ? "Retrying…" : "Retry"}</Button>
      </div>
    );
  }

  if (result.rows.length === 0 && variants.length === 0) {
    return <EmptyState icon={Boxes} title="No stock recorded" description="This product has no variants and no in-house or supplier stock lines yet." action={{ label: "Open the Stock module", href: moduleHref }} />;
  }

  const label = (id: string | null) => (id ? variants.find((v) => v.id === id)?.sku ?? variants.find((v) => v.id === id)?.name ?? "Variant" : "Whole product");
  const groups = new Map<string, AvailabilityRow[]>();
  for (const v of variants) groups.set(v.id, []);
  for (const row of result.rows) {
    const key = row.variant_id ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const inHouseTotal = (rows: AvailabilityRow[]) => {
    const inHouse = rows.filter((r) => r.source_kind === "in_house");
    const units = new Set(inHouse.map((r) => r.unit_code));
    // Only add up figures that are all numeric and share a unit; otherwise no total is truer than a wrong one.
    if (inHouse.length < 2 || units.size !== 1 || inHouse.some((r) => r.quantity === null && r.availability !== "out")) return null;
    return { value: inHouse.reduce((sum, r) => sum + (r.quantity ?? 0), 0), unit: [...units][0] };
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          In-house figures mirror SQL Account per warehouse; supplier lines are dated evidence. <InfoTip label="How stock lines work" content="Each line is the latest snapshot for that variant and warehouse (or supplier). Its age is shown; stale figures should be checked before quoting." />
        </p>
        <Button asChild size="sm" variant="outline"><Link href={moduleHref}>Open in Stock module</Link></Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-label="Stock by variant and warehouse">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 text-xs">Variant</TableHead>
              <TableHead className="h-9 text-xs">Source</TableHead>
              <TableHead className="h-9 text-xs">Warehouse / supplier</TableHead>
              <TableHead className="h-9 text-xs">Availability</TableHead>
              <TableHead className="h-9 text-right text-xs">Available</TableHead>
              <TableHead className="h-9 text-right text-xs">On hand</TableHead>
              <TableHead className="h-9 text-right text-xs">Allocated</TableHead>
              <TableHead className="h-9 text-xs">As of</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...groups.entries()].map(([variantId, rows]) => {
              const total = inHouseTotal(rows);
              if (rows.length === 0) {
                return (
                  <TableRow key={variantId || "product"}>
                    <TableCell className="font-mono text-xs">{label(variantId || null)}</TableCell>
                    <TableCell colSpan={2} className="text-xs text-muted-foreground">No stock record for this variant</TableCell>
                    <TableCell><AvailabilityCell state="unknown" /></TableCell>
                    <TableCell className="text-right"><QuantityCell state="unknown" quantity={null} unit={null} /></TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                );
              }
              return [
                ...rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{label(r.variant_id)}</TableCell>
                    <TableCell><StatusPill map={SOURCE_KIND} value={r.source_kind} /></TableCell>
                    <TableCell className="text-sm">{r.source_kind === "in_house" ? (r.location_name ?? "Unassigned warehouse") : (r.supplier_name ?? r.source_name)}</TableCell>
                    <TableCell><AvailabilityCell state={r.availability} /></TableCell>
                    <TableCell className="text-right"><QuantityCell state={r.availability} quantity={r.quantity} unit={r.unit_code} /></TableCell>
                    <TableCell className="text-right tnum">{r.on_hand === null ? <span className="text-muted-foreground">—</span> : formatNumber(r.on_hand, 2)}</TableCell>
                    <TableCell className="text-right tnum">{r.allocated === null ? <span className="text-muted-foreground">—</span> : formatNumber(r.allocated, 2)}</TableCell>
                    <TableCell><FreshnessBadge lastSuccessAt={r.as_of} slaMinutes={r.sla_minutes} /></TableCell>
                  </TableRow>
                )),
                total ? (
                  <TableRow key={`${variantId}-total`} className="bg-muted/40">
                    <TableCell className="font-mono text-xs">{label(variantId || null)}</TableCell>
                    <TableCell colSpan={3} className="text-xs font-medium">In-house total across warehouses</TableCell>
                    <TableCell className="text-right font-medium tnum">{formatNumber(total.value, 2)}{total.unit && <span className="ml-1 text-[11px] text-muted-foreground">{total.unit}</span>}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                ) : null,
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
