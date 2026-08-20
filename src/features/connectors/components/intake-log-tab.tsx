"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill } from "@/components/patterns/status-pill";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { useAction } from "@/features/catalog/use-action";
import { replayIntakeAction } from "@/server/commands/connectors";
import { INTAKE_STATUS } from "@/features/connectors/status";
import type { IntakeEventRow } from "@/server/queries/connectors";

export function IntakeLogTab({ rows, canReplay }: { rows: IntakeEventRow[]; canReplay: boolean }) {
  const [selected, setSelected] = useState<IntakeEventRow | null>(null);
  const replay = useAction(replayIntakeAction, { onSuccess: () => setSelected(null) });

  const columns = useMemo<ColumnDef<IntakeEventRow, unknown>[]>(
    () => [
      { accessorKey: "received_at", header: "Received", cell: ({ row }) => <span className="tnum">{formatDateTime(row.original.received_at)}</span> },
      { accessorKey: "provider", header: "Provider", cell: ({ row }) => row.original.provider ?? <span className="text-muted-foreground">manual</span> },
      { accessorKey: "source_channel", header: "Channel" },
      { accessorKey: "external_id", header: "Provider id", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.external_id || "—"}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={INTAKE_STATUS} value={row.original.status} /> },
      {
        id: "lead",
        header: "Lead",
        accessorFn: (r) => r.lead_id ?? "",
        cell: ({ row }) =>
          row.original.lead_id ? (
            <Link href={`/sales/inbox?lead=${row.original.lead_id}`} className="font-mono text-[12px] text-info hover:underline" onClick={(e) => e.stopPropagation()}>
              open
            </Link>
          ) : (
            <span className="text-warning">none</span>
          ),
      },
    ],
    [],
  );

  const replayable = selected && !selected.lead_id && selected.status !== "duplicate";

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Every submission is kept as raw evidence, whether or not it became a lead. An event with no lead can be replayed here without asking the
        provider to send it again.
      </p>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        onRowClick={setSelected}
        searchable
        searchPlaceholder="Filter by provider, id, channel…"
        columnToggle
        pageSize={50}
        emptyTitle="No submissions yet"
        emptyDescription="Nothing has arrived from a connector or manual capture."
      />

      <RecordDrawer
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? `${selected.provider ?? "manual"} · ${selected.source_channel}` : ""}
        description={selected ? formatDateTime(selected.received_at) : undefined}
        width="lg"
        actions={
          canReplay && replayable ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={replay.pending} onClick={() => selected && replay.run(selected.id)}>
              <RotateCcw className="size-3.5" aria-hidden /> {replay.pending ? "Replaying…" : "Replay"}
            </Button>
          ) : undefined
        }
      >
        {selected && (
          <>
            <DrawerSection title="Submission">
              <FactList
                items={[
                  { label: "Status", value: <StatusPill map={INTAKE_STATUS} value={selected.status} /> },
                  { label: "Provider id", value: selected.external_id ?? "—", mono: true },
                  { label: "Idempotency key", value: selected.idempotency_key, mono: true },
                  { label: "Occurred at", value: selected.occurred_at ? formatDateTime(selected.occurred_at) : "—" },
                  { label: "Lead", value: selected.lead_id ? <Link href={`/sales/inbox?lead=${selected.lead_id}`} className="text-info hover:underline">Open in inbox</Link> : "Not linked" },
                  { label: "Event id", value: selected.id, mono: true },
                ]}
              />
            </DrawerSection>
            {selected.raw_text && (
              <DrawerSection title="Message">
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{selected.raw_text}</p>
              </DrawerSection>
            )}
            <DrawerSection title="Raw payload">
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">{JSON.stringify(selected.payload, null, 2)}</pre>
              {Boolean((selected.payload as { __unmapped?: Record<string, unknown> }).__unmapped) && (
                <p className="mt-2 text-xs text-warning">
                  This submission contained questions with no mapping. They are preserved above under <code className="font-mono">__unmapped</code> — add a
                  mapping so future submissions capture them.
                </p>
              )}
            </DrawerSection>
          </>
        )}
      </RecordDrawer>
    </div>
  );
}
