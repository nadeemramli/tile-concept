"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { formatDateTime } from "@/lib/format";
import type { AuditRow } from "@/server/queries/platform";
import { cn } from "@/lib/utils";

interface Props {
  rows: AuditRow[];
  tables: string[];
  members: { user_id: string; full_name: string }[];
}

export function AuditTable({ rows, tables, members }: Props) {
  const [action, setAction] = useQueryState("action", parseAsString.withDefault(""));
  const [table, setTable] = useQueryState("table", parseAsString.withDefault(""));
  const [actor, setActor] = useQueryState("actor", parseAsString.withDefault(""));
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(""));
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(""));
  const [objectId, setObjectId] = useQueryState("object", parseAsString.withDefault(""));
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      { accessorKey: "occurred_at", header: "When", cell: ({ row }) => <span className="tnum">{formatDateTime(row.original.occurred_at)}</span> },
      { accessorKey: "actor_name", header: "Actor", cell: ({ row }) => row.original.actor_name ?? <span className="text-muted-foreground">system</span> },
      { accessorKey: "action", header: "Action", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.action}</span> },
      {
        id: "object",
        header: "Object",
        accessorFn: (r) => `${r.object_table ?? ""} ${r.object_id ?? ""}`,
        cell: ({ row }) => {
          const r = row.original;
          const label = `${r.object_table ?? "—"} · ${r.object_id ? r.object_id.slice(0, 8) : "—"}`;
          return r.href ? (
            <Link href={r.href} className="inline-flex items-center gap-1 font-mono text-[12px] hover:underline" onClick={(e) => e.stopPropagation()}>
              {label} <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : (
            <span className="font-mono text-[12px] text-muted-foreground">{label}</span>
          );
        },
      },
      { accessorKey: "reason", header: "Reason", cell: ({ row }) => <span className="max-w-64 truncate text-muted-foreground" title={row.original.reason ?? ""}>{row.original.reason ?? "—"}</span> },
    ],
    [],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={action} onChange={(e) => setAction(e.target.value || null)} placeholder="Action contains…" className="h-8 w-40 text-sm" />
      <div className="w-44">
        <SimpleSelect value={table} onChange={(v) => setTable(v || null)} options={tables.map((t) => ({ value: t, label: t }))} noneLabel="All objects" />
      </div>
      <div className="w-44">
        <SimpleSelect value={actor} onChange={(v) => setActor(v || null)} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} noneLabel="All actors" />
      </div>
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value || null)} className="h-8 w-36 text-sm" aria-label="From" />
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value || null)} className="h-8 w-36 text-sm" aria-label="To" />
      <Input value={objectId} onChange={(e) => setObjectId(e.target.value || null)} placeholder="Object id" className="h-8 w-44 font-mono text-xs" />
      {(action || table || actor || from || to || objectId) && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => {
            setAction(null);
            setTable(null);
            setActor(null);
            setFrom(null);
            setTo(null);
            setObjectId(null);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );

  return (
    <>
      <DataTable columns={columns} data={rows} rowKey={(r) => r.id} onRowClick={setSelected} toolbar={toolbar} columnToggle emptyTitle="No audit events" emptyDescription="No events match these filters." pageSize={50} />
      <RecordDrawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected?.action ?? ""} description={selected ? `${selected.object_schema ?? ""}.${selected.object_table ?? ""} · ${formatDateTime(selected.occurred_at)}` : undefined} width="xl">
        {selected && (
          <>
            <DrawerSection title="Event">
              <FactList items={[{ label: "Actor", value: selected.actor_name ?? "system" }, { label: "Object id", value: selected.object_id ?? "—", mono: true }, { label: "Reason", value: selected.reason ?? "—" }, { label: "Event id", value: selected.id, mono: true }]} />
              {selected.href && (
                <Link href={selected.href} className="text-xs text-info hover:underline">
                  Open record →
                </Link>
              )}
            </DrawerSection>
            <DrawerSection title="Changes">
              <DiffView before={selected.before_data} after={selected.after_data} />
            </DrawerSection>
            {selected.metadata && Object.keys(selected.metadata).length > 0 && (
              <DrawerSection title="Metadata">
                <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px]">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </DrawerSection>
            )}
          </>
        )}
      </RecordDrawer>
    </>
  );
}

function DiffView({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">No row payload recorded for this event.</p>;
  const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const changed = keys.filter((k) => fmt(before?.[k]) !== fmt(after?.[k]));
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Field</th>
            <th className="px-2 py-1 text-left font-medium">Before</th>
            <th className="px-2 py-1 text-left font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {[...changed, ...keys.filter((k) => !changed.includes(k))].map((k) => {
            const isChanged = changed.includes(k);
            return (
              <tr key={k} className={cn("border-t", isChanged && "bg-warning/10")}>
                <td className="px-2 py-1 font-mono">{k}</td>
                <td className={cn("max-w-64 truncate px-2 py-1 font-mono", isChanged && "text-destructive")}>{fmt(before?.[k])}</td>
                <td className={cn("max-w-64 truncate px-2 py-1 font-mono", isChanged && "text-success")}>{fmt(after?.[k])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
