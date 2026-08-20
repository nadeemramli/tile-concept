"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";
import { FRESHNESS_STATUS } from "@/features/stock/status";
import { QuickEntry } from "@/features/stock/components/quick-entry";
import { BulkEntry } from "@/features/stock/components/bulk-entry";
import { useAction } from "@/features/catalog/use-action";
import { flagStaleSuppliersAction } from "@/server/commands/stock";
import { useSession } from "@/components/shell/session-context";
import type { VariantOption } from "@/features/stock/components/variant-combobox";
import type { StaleSupplierRow } from "@/server/queries/stock";

interface Props {
  stale: StaleSupplierRow[];
  suppliers: { id: string; name: string }[];
  variants: VariantOption[];
  units: { id: string; code: string; label: string }[];
}

export function SuppliersTab({ stale, suppliers, variants, units }: Props) {
  const { can } = useSession();
  const canWrite = can("stock.write");
  const [selectedSupplier, setSelectedSupplier] = useState<string | undefined>(undefined);
  const flag = useAction(flagStaleSuppliersAction);

  const columns = useMemo<ColumnDef<StaleSupplierRow, unknown>[]>(
    () => [
      { accessorKey: "supplier_name", header: "Supplier", cell: ({ row }) => <span className="font-medium">{row.original.supplier_name}</span> },
      { accessorKey: "freshness", header: "Freshness", cell: ({ row }) => <StatusPill map={FRESHNESS_STATUS} value={row.original.freshness} /> },
      {
        accessorKey: "last_update_at",
        header: "Last update",
        cell: ({ row }) => <FreshnessBadge lastSuccessAt={row.original.last_update_at} slaMinutes={row.original.fresh_hours * 60} />,
      },
      { accessorKey: "snapshot_count", header: "Snapshots", cell: ({ row }) => <span className="tnum">{row.original.snapshot_count}</span> },
      {
        id: "policy",
        header: "Policy",
        cell: ({ row }) => (
          <span className="tnum text-muted-foreground">
            fresh ≤ {row.original.fresh_hours}h · aging ≤ {row.original.aging_hours}h
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          canWrite ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedSupplier(row.original.supplier_id);
                document.getElementById("quick-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Record update
            </Button>
          ) : null,
      },
    ],
    [canWrite],
  );

  const overdue = stale.filter((s) => s.freshness === "stale" || s.freshness === "unknown");

  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <Card className="flex-row items-start gap-2 border-warning/25 bg-warning/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {overdue.length} supplier{overdue.length === 1 ? " is" : "s are"} past their freshness policy
            </p>
            <p className="text-xs text-muted-foreground">Flagging opens a data-health issue per supplier so the weekly chase has a queue. Recording an update clears it automatically.</p>
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => flag.run()} disabled={flag.pending}>
              {flag.pending ? "Flagging…" : "Flag stale suppliers"}
            </Button>
          )}
        </Card>
      )}

      <DataTable columns={columns} data={stale} rowKey={(r) => r.supplier_id} emptyTitle="No active suppliers" emptyDescription="Suppliers appear here once they exist in the catalog." pageSize={25} />

      {canWrite && (
        <div id="quick-entry" className="grid gap-4 xl:grid-cols-2">
          <QuickEntry suppliers={suppliers} variants={variants} units={units} defaultSupplierId={selectedSupplier} />
          <BulkEntry suppliers={suppliers} variants={variants} units={units} />
        </div>
      )}
    </div>
  );
}
