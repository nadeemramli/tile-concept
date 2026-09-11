"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Info, ShieldCheck } from "lucide-react";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { RecordDrawer, DrawerSection } from "@/components/patterns/record-drawer";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Hint, InfoTip } from "@/components/patterns/explain";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { AVAILABILITY_STATUS, CHANNEL_HINT, CHANNEL_LABEL, SOURCE_KIND } from "@/features/stock/status";
import { AvailabilityCell, EvidenceCell, QuantityCell } from "@/features/stock/components/quantity-cell";
import { formatDate, formatDateTime, formatNumber, titleCase } from "@/lib/format";
import { getSnapshotHistoryAction } from "@/server/commands/stock-history";
import type { AvailabilityRow, SnapshotHistoryRow } from "@/server/queries/stock";

interface Props {
  rows: AvailabilityRow[];
  categories: { id: string; label: string }[];
  brands: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}

const AVAILABILITY_OPTIONS = Object.entries(AVAILABILITY_STATUS).map(([value, meta]) => ({ value, label: meta.label }));

const COLUMN_HINTS = {
  source: "Where the figure came from. In-house mirrors SQL Account read-only; Supplier is what a supplier told a stock coordinator. The shield marks the authoritative source.",
  availability: "The state as confirmed on the date shown. States are never collapsed into a number; hover a pill for what it means.",
  quantity: "Only Available and Low carry a quantity. A dash means no quantity was given, which is not zero.",
  asOf: "When the latest figure was captured, and how that compares with the freshness policy of its source.",
  channel: "How the supplier figure reached us: a call, a message, an email, the supplier portal or a visit.",
  evidence: "A screenshot or document attached to the update. It proves the conversation happened; it is never read as a stock figure.",
  expected: "The date the supplier said stock would be replenished. Given by the supplier, not calculated by the app.",
  filters: "Source narrows to in-house (SQL Account) or supplier figures. State is the availability pill. Freshness compares the latest figure with each source's own policy: fresh, aging, stale, or never updated.",
} as const;

function ChannelLabel({ channel }: { channel: string | null }) {
  if (!channel) return <>—</>;
  return (
    <Hint content={CHANNEL_HINT[channel]} focusable>
      <span>{CHANNEL_LABEL[channel] ?? titleCase(channel)}</span>
    </Hint>
  );
}

export function OverviewTab({ rows, categories, brands, suppliers }: Props) {
  const [category, setCategory] = useQueryState("category");
  const [brand, setBrand] = useQueryState("brand");
  const [supplier, setSupplier] = useQueryState("supplier");
  const [sourceKind, setSourceKind] = useQueryState("sourceKind");
  const [freshness, setFreshness] = useQueryState("freshness");
  const [availability, setAvailability] = useQueryState("availability");
  const [q, setQ] = useQueryState("q");
  const [variantId, setVariantId] = useQueryState("variant");

  const [history, setHistory] = useState<SnapshotHistoryRow[]>([]);
  const [loadingHistory, startHistory] = useTransition();

  const selected = rows.filter((r) => r.variant_id && r.variant_id === variantId);
  const selectedName = selected[0]?.product_name ?? "";

  const openVariant = (row: AvailabilityRow) => {
    if (!row.variant_id) return;
    void setVariantId(row.variant_id);
    setHistory([]);
    startHistory(async () => {
      const res = await getSnapshotHistoryAction(row.variant_id!);
      if (res.ok) setHistory(res.data);
    });
  };

  const columns = useMemo<ColumnDef<AvailabilityRow, unknown>[]>(
    () => [
      {
        accessorKey: "product_code",
        header: "Code",
        cell: ({ row }) =>
          row.original.product_id ? (
            <Link href={`/merchandise/catalog/${row.original.product_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              <MonoCell value={row.original.product_code} />
            </Link>
          ) : (
            <MonoCell value={row.original.product_code} />
          ),
      },
      { accessorKey: "product_name", header: "Product", cell: ({ row }) => <span className="font-medium">{row.original.product_name}</span> },
      {
        id: "source",
        header: "Source",
        meta: { hint: COLUMN_HINTS.source },
        accessorFn: (r) => r.supplier_name ?? r.location_name ?? r.source_name,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="inline-flex items-center gap-1.5">
              <StatusPill map={SOURCE_KIND} value={r.source_kind} />
              <span className="truncate">{r.supplier_name ?? r.location_name ?? r.source_name}</span>
              {r.is_authoritative && (
                <Hint content="SQL Account is the authority for in-house stock. This app mirrors it read-only and never writes back." focusable>
                  <ShieldCheck className="size-3.5 shrink-0 text-info" aria-label="Authoritative source" />
                </Hint>
              )}
            </span>
          );
        },
      },
      { accessorKey: "availability", header: "Availability", meta: { hint: COLUMN_HINTS.availability }, cell: ({ row }) => <AvailabilityCell state={row.original.availability} /> },
      {
        id: "quantity",
        header: "Quantity",
        meta: { hint: COLUMN_HINTS.quantity },
        accessorFn: (r) => r.quantity ?? -1,
        cell: ({ row }) => <QuantityCell state={row.original.availability} quantity={row.original.quantity} unit={row.original.unit_code} />,
      },
      {
        accessorKey: "as_of",
        header: "As of",
        meta: { hint: COLUMN_HINTS.asOf },
        cell: ({ row }) => <FreshnessBadge lastSuccessAt={row.original.as_of} slaMinutes={row.original.sla_minutes} />,
      },
      {
        accessorKey: "source_channel",
        header: "Channel",
        meta: { hint: COLUMN_HINTS.channel },
        cell: ({ row }) => <ChannelLabel channel={row.original.source_channel} />,
      },
      { id: "evidence", header: "Evidence", meta: { hint: COLUMN_HINTS.evidence }, enableSorting: false, cell: ({ row }) => <EvidenceCell path={row.original.evidence_storage_path} /> },
      {
        accessorKey: "expected_replenishment",
        header: "Expected",
        meta: { hint: COLUMN_HINTS.expected },
        cell: ({ row }) => (row.original.expected_replenishment ? formatDate(row.original.expected_replenishment) : "—"),
      },
    ],
    [],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40">
        <SimpleSelect value={category} onChange={(v) => setCategory(v || null)} options={categories.map((c) => ({ value: c.id, label: c.label }))} noneLabel="All categories" placeholder="Category" />
      </div>
      <div className="w-36">
        <SimpleSelect value={brand} onChange={(v) => setBrand(v || null)} options={brands.map((b) => ({ value: b.id, label: b.name }))} noneLabel="All brands" placeholder="Brand" />
      </div>
      <div className="w-44">
        <SimpleSelect value={supplier} onChange={(v) => setSupplier(v || null)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} noneLabel="All suppliers" placeholder="Supplier" />
      </div>
      <div className="w-36">
        <SimpleSelect value={sourceKind} onChange={(v) => setSourceKind(v || null)} options={[{ value: "in_house", label: "In-house" }, { value: "supplier", label: "Supplier" }]} noneLabel="Both sources" placeholder="Source" />
      </div>
      <div className="w-36">
        <SimpleSelect value={availability} onChange={(v) => setAvailability(v || null)} options={AVAILABILITY_OPTIONS} noneLabel="Any state" placeholder="Availability" />
      </div>
      <div className="w-36">
        <SimpleSelect
          value={freshness}
          onChange={(v) => setFreshness(v || null)}
          options={[
            { value: "fresh", label: "Fresh" },
            { value: "aging", label: "Aging" },
            { value: "stale", label: "Stale" },
            { value: "unknown", label: "Never updated" },
          ]}
          noneLabel="Any freshness"
          placeholder="Freshness"
        />
      </div>
      <InfoTip label="Filters" content={COLUMN_HINTS.filters} />
      <Input value={q ?? ""} onChange={(e) => setQ(e.target.value || null)} placeholder="Search code, product, supplier…" className="h-8 w-56 text-sm" aria-label="Search availability" />
    </div>
  );

  return (
    <div className="space-y-3">
      <StateLegend />
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.key}
        onRowClick={openVariant}
        toolbar={toolbar}
        columnToggle
        emptyTitle="No availability recorded"
        emptyDescription="Nothing matches these filters. In-house stock arrives from the SQL Account connector; supplier figures are entered on the Supplier updates tab."
        pageSize={50}
      />

      <RecordDrawer
        open={!!variantId}
        onOpenChange={(o) => {
          if (!o) void setVariantId(null);
        }}
        title={selectedName || "Availability"}
        description="Every source for this product, side by side, with the full snapshot history."
        width="xl"
      >
        <DrawerSection title="By source">
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">No current availability for this product.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {selected.map((s) => (
                <Card key={s.key} className="gap-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{s.supplier_name ?? s.location_name ?? s.source_name}</span>
                    <StatusPill map={SOURCE_KIND} value={s.source_kind} />
                  </div>
                  <div className="flex items-center gap-2">
                    <AvailabilityCell state={s.availability} />
                    <QuantityCell state={s.availability} quantity={s.quantity} unit={s.unit_code} />
                  </div>
                  <FreshnessBadge lastSuccessAt={s.as_of} slaMinutes={s.sla_minutes} className="w-fit" />
                  {s.source_kind === "in_house" && (
                    <div className="tnum text-[11px] text-muted-foreground">
                      On hand {formatNumber(s.on_hand, 2)} · allocated {formatNumber(s.allocated, 2)}
                    </div>
                  )}
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </Card>
              ))}
            </div>
          )}
        </DrawerSection>

        <DrawerSection title="Snapshot history">
          {loadingHistory ? (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Captured</th>
                    <th className="px-2 py-1.5 font-medium">Source</th>
                    <th className="px-2 py-1.5 font-medium">State</th>
                    <th className="px-2 py-1.5 font-medium">Quantity</th>
                    <th className="px-2 py-1.5 font-medium">By</th>
                    <th className="px-2 py-1.5 font-medium">Channel</th>
                    <th className="px-2 py-1.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t align-top">
                      <td className="tnum whitespace-nowrap px-2 py-1.5">{formatDateTime(h.captured_at)}</td>
                      <td className="px-2 py-1.5">{h.source}</td>
                      <td className="px-2 py-1.5">
                        <AvailabilityCell state={h.availability} />
                      </td>
                      <td className="px-2 py-1.5">
                        <QuantityCell state={h.availability} quantity={h.quantity} unit={h.unit_code} />
                      </td>
                      <td className="px-2 py-1.5">{h.submitted_by_name ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        <ChannelLabel channel={h.source_channel} />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-muted-foreground">{h.notes ?? "—"}</span>
                        {h.evidence_storage_path && <EvidenceCell path={h.evidence_storage_path} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DrawerSection>
      </RecordDrawer>
    </div>
  );
}

/** Spelling out what each state means, and what a supplier figure is not. */
export function StateLegend() {
  return (
    <Card className="gap-2 px-3.5 py-2.5">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs text-muted-foreground">
          In-house figures mirror <span className="font-medium text-foreground">SQL Account</span>, the authority, read-only. Supplier figures are{" "}
          <span className="font-medium text-foreground">evidence with an age</span> — what someone was told, on the date shown — not a live feed. States stay distinct: none of them means zero unless it says so.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(AVAILABILITY_STATUS).map((key) => (
          <StatusPill key={key} map={AVAILABILITY_STATUS} value={key} />
        ))}
      </div>
    </Card>
  );
}
