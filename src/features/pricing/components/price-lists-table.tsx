"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { PRICE_LIST_STATUS } from "@/lib/domain/status-maps";
import type { PriceListRow } from "@/server/queries/pricing";

export function PriceListsTable({ rows }: { rows: PriceListRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<PriceListRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Price list", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "price_type", header: "Type", meta: { hint: "Retail, trade, project or another price type. A variant can carry one current price per list, basis and minimum quantity." } },
      { accessorKey: "currency", header: "Currency", meta: { hint: "Stated on the list and never converted. Incl. tax means the amounts include tax." }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.currency}{row.original.tax_inclusive ? " · incl. tax" : ""}</span> },
      { id: "scope", header: "Scope", meta: { hint: "Which supplier, brand or category the list covers. All products means no restriction." }, cell: ({ row }) => [row.original.supplier, row.original.brand, row.original.category].filter(Boolean).join(" · ") || "All products" },
      { id: "current", header: "Current", meta: { hint: "Prices in force today." }, accessorFn: (r) => r.counts.current, cell: ({ row }) => <span className="tnum">{row.original.counts.current}</span> },
      { id: "draft", header: "Draft / scheduled", meta: { hint: "Entered but not yet in force: drafts wait for publishing, scheduled ones wait for their start date." }, accessorFn: (r) => r.counts.draft + r.counts.scheduled, cell: ({ row }) => <span className="tnum">{row.original.counts.draft + row.original.counts.scheduled}</span> },
      {
        id: "conflicted",
        header: "Conflicted",
        meta: { hint: "Prices blocked because another current or scheduled price overlaps the same scope. Resolve with an audited override or a date change." },
        accessorFn: (r) => r.counts.conflicted,
        cell: ({ row }) => (row.original.counts.conflicted ? <TonePill tone="destructive" label={String(row.original.counts.conflicted)} hint="Blocked prices in this list. Open the list to resolve them." /> : <span className="tnum text-muted-foreground">0</span>),
      },
      { accessorKey: "owner_name", header: "Owner", cell: ({ row }) => row.original.owner_name ?? "—" },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={PRICE_LIST_STATUS} value={row.original.status} /> },
    ],
    [],
  );
  return <DataTable columns={columns} data={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/merchandise/pricing/${r.id}`)} emptyTitle="No price lists" emptyDescription="Create a price list to start publishing effective-dated prices." />;
}
