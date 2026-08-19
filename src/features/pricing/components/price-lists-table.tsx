"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { TonePill } from "@/components/patterns/status-pill";
import type { PriceListRow } from "@/server/queries/pricing";

const STATUS_TONE = { draft: "neutral", active: "success", archived: "neutral" } as const;

export function PriceListsTable({ rows }: { rows: PriceListRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<PriceListRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Price list", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "price_type", header: "Type" },
      { accessorKey: "currency", header: "Currency", cell: ({ row }) => <span className="font-mono text-xs">{row.original.currency}{row.original.tax_inclusive ? " · incl. tax" : ""}</span> },
      { id: "scope", header: "Scope", cell: ({ row }) => [row.original.supplier, row.original.brand, row.original.category].filter(Boolean).join(" · ") || "All products" },
      { id: "current", header: "Current", accessorFn: (r) => r.counts.current, cell: ({ row }) => <span className="tnum">{row.original.counts.current}</span> },
      { id: "draft", header: "Draft / scheduled", accessorFn: (r) => r.counts.draft + r.counts.scheduled, cell: ({ row }) => <span className="tnum">{row.original.counts.draft + row.original.counts.scheduled}</span> },
      { id: "conflicted", header: "Conflicted", accessorFn: (r) => r.counts.conflicted, cell: ({ row }) => (row.original.counts.conflicted ? <TonePill tone="destructive" label={String(row.original.counts.conflicted)} /> : <span className="tnum text-muted-foreground">0</span>) },
      { accessorKey: "owner_name", header: "Owner", cell: ({ row }) => row.original.owner_name ?? "—" },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <TonePill tone={STATUS_TONE[row.original.status as keyof typeof STATUS_TONE] ?? "neutral"} label={row.original.status} /> },
    ],
    [],
  );
  return <DataTable columns={columns} data={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/merchandise/pricing/${r.id}`)} emptyTitle="No price lists" emptyDescription="Create a price list to start publishing effective-dated prices." />;
}
