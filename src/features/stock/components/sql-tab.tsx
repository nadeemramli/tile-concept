"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { FactList } from "@/components/patterns/record-drawer";
import { CONNECTOR_STATUS } from "@/lib/domain/status-maps";
import { MAPPING_STATUS } from "@/features/stock/status";
import { VariantCombobox, type VariantOption } from "@/features/stock/components/variant-combobox";
import { useAction } from "@/features/catalog/use-action";
import { mapInventoryItemAction, simulateConnectorPullAction } from "@/server/commands/stock";
import { useSession } from "@/components/shell/session-context";
import { publicEnv } from "@/lib/env";
import { formatDateTime, formatNumber, titleCase } from "@/lib/format";
import type { InHouseSnapshotRow, MappingRow, SqlConnector } from "@/server/queries/stock";

interface Props {
  connector: SqlConnector | null;
  mappings: MappingRow[];
  snapshots: InHouseSnapshotRow[];
  variants: VariantOption[];
}

export function SqlTab({ connector, mappings, snapshots, variants }: Props) {
  const { can } = useSession();
  const canWrite = can("stock.write");
  const canSimulate = can("settings.manage") && publicEnv.appMode === "demo";
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({});
  const map = useAction(mapInventoryItemAction);
  const simulate = useAction(simulateConnectorPullAction);

  const unmapped = mappings.filter((m) => m.status === "unmapped");

  const mappingColumns = useMemo<ColumnDef<MappingRow, unknown>[]>(
    () => [
      { accessorKey: "external_item_code", header: "Item code", cell: ({ row }) => <MonoCell value={row.original.external_item_code} /> },
      { accessorKey: "source_name", header: "Source" },
      { accessorKey: "snapshot_count", header: "Snapshots", cell: ({ row }) => <span className="tnum">{row.original.snapshot_count}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={MAPPING_STATUS} value={row.original.status} /> },
      {
        id: "map",
        header: "Product",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === "mapped") return <span className="truncate">{r.variant_label ?? "—"}</span>;
          if (r.status === "ignored") return <span className="text-muted-foreground">Ignored</span>;
          if (!canWrite) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex items-center gap-1.5">
              <div className="w-64">
                <VariantCombobox variants={variants} value={pendingMap[r.id] ?? ""} onChange={(v) => setPendingMap((p) => ({ ...p, [r.id]: v }))} placeholder="Match a product…" />
              </div>
              <Button size="sm" className="h-8 px-2 text-xs" disabled={!pendingMap[r.id] || map.pending} onClick={() => map.run({ mapping_id: r.id, variant_id: pendingMap[r.id], ignore: false })}>
                Map
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={map.pending} onClick={() => map.run({ mapping_id: r.id, variant_id: "", ignore: true })}>
                Ignore
              </Button>
            </div>
          );
        },
      },
    ],
    [canWrite, map, pendingMap, variants],
  );

  const snapshotColumns = useMemo<ColumnDef<InHouseSnapshotRow, unknown>[]>(
    () => [
      { accessorKey: "location_name", header: "Location", cell: ({ row }) => row.original.location_name ?? "—" },
      { accessorKey: "external_item_code", header: "Item code", cell: ({ row }) => <MonoCell value={row.original.external_item_code} /> },
      { accessorKey: "product_label", header: "Product", cell: ({ row }) => row.original.product_label ?? <span className="text-muted-foreground">Unmapped</span> },
      { accessorKey: "on_hand", header: "On hand", cell: ({ row }) => <span className="tnum">{formatNumber(row.original.on_hand, 2)}</span> },
      { accessorKey: "allocated", header: "Allocated", cell: ({ row }) => <span className="tnum">{formatNumber(row.original.allocated, 2)}</span> },
      { accessorKey: "available", header: "Available", cell: ({ row }) => <span className="tnum font-medium">{formatNumber(row.original.available, 2)}</span> },
      { accessorKey: "unit_code", header: "Unit", cell: ({ row }) => row.original.unit_code ?? "—" },
      { accessorKey: "source_timestamp", header: "Source time", cell: ({ row }) => <span className="tnum">{formatDateTime(row.original.source_timestamp)}</span> },
      { accessorKey: "checkpoint", header: "Checkpoint", cell: ({ row }) => <MonoCell value={row.original.checkpoint} /> },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{connector?.name ?? "SQL Account"}</h3>
              <StatusPill map={CONNECTOR_STATUS} value={connector?.status ?? "not_configured"} />
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                <Lock className="size-3" aria-hidden /> Read-only
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              SQL Account is the authority for in-house stock. This app mirrors it and <span className="font-medium text-foreground">never writes back</span>. It also never subtracts a quotation on its own:
              whether a quotation, sales order or delivery order moves available stock is an open discovery gate (PRD §11.3), so nothing is inferred until that behaviour is tested and agreed.
            </p>
          </div>
          <FreshnessBadge lastSuccessAt={connector?.last_success_at ?? null} slaMinutes={connector?.sla_minutes ?? 240} label="Last success" />
        </div>

        <FactList
          items={[
            { label: "Environment", value: titleCase(connector?.environment ?? "demo") },
            { label: "Direction", value: titleCase(connector?.direction ?? "pull") },
            { label: "Last attempt", value: connector?.last_attempt_at ? formatDateTime(connector.last_attempt_at) : "Never" },
            { label: "Checkpoint", value: connector?.checkpoint ?? "None", mono: true },
            { label: "Purpose", value: connector?.business_purpose ?? "—" },
            { label: "Last error", value: connector?.last_error ?? "None" },
          ]}
        />

        {canSimulate && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => simulate.run()} disabled={simulate.pending}>
              <PlayCircle className="size-3.5" aria-hidden /> {simulate.pending ? "Running…" : "Simulate a connector pull"}
            </Button>
            <span className="text-xs text-muted-foreground">Demo mode only — writes synthetic snapshots for mapped items so the mapping and freshness path can be exercised. No connector is attached.</span>
          </div>
        )}
      </Card>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Item mapping</h3>
          <span className="text-xs text-muted-foreground">{unmapped.length} unmapped — snapshots arrive but cannot reach a product until mapped</span>
        </div>
        <DataTable
          columns={mappingColumns}
          data={mappings}
          rowKey={(r) => r.id}
          emptyTitle="No item codes yet"
          emptyDescription="Item codes appear the first time the connector delivers a snapshot."
          searchable
          searchPlaceholder="Filter item codes…"
          pageSize={25}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">In-house snapshots</h3>
        <DataTable
          columns={snapshotColumns}
          data={snapshots}
          rowKey={(r) => r.id}
          emptyTitle="No snapshots"
          emptyDescription="Nothing has been mirrored from SQL Account yet."
          pageSize={25}
        />
      </section>
    </div>
  );
}
