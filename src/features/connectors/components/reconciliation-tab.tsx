"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DataTable } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { ReconciliationRow } from "@/server/queries/connectors";

/**
 * Reconciliation answers one question (PRD §11.1): did everything a provider
 * sent become either a lead or a documented duplicate? Anything unlinked is a
 * silent loss and is called out as such.
 */
export function ReconciliationTab({ rows }: { rows: ReconciliationRow[] }) {
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          received: acc.received + r.received,
          processed: acc.processed + r.processed,
          deduplicated: acc.deduplicated + r.deduplicated,
          failed: acc.failed + r.failed,
          unlinked: acc.unlinked + r.unlinked,
        }),
        { received: 0, processed: 0, deduplicated: 0, failed: 0, unlinked: 0 },
      ),
    [rows],
  );

  const chartData = useMemo(() => {
    const byDay = new Map<string, { day: string; processed: number; deduplicated: number; failed: number; unlinked: number }>();
    for (const r of [...rows].reverse()) {
      const entry = byDay.get(r.day) ?? { day: r.day, processed: 0, deduplicated: 0, failed: 0, unlinked: 0 };
      entry.processed += r.processed;
      entry.deduplicated += r.deduplicated;
      entry.failed += r.failed;
      entry.unlinked += r.unlinked;
      byDay.set(r.day, entry);
    }
    return [...byDay.values()].slice(-30).map((d) => ({ ...d, label: formatDate(d.day, "d MMM") }));
  }, [rows]);

  const columns = useMemo<ColumnDef<ReconciliationRow, unknown>[]>(
    () => [
      { accessorKey: "day", header: "Day", cell: ({ row }) => <span className="tnum">{formatDate(row.original.day)}</span> },
      { accessorKey: "provider", header: "Provider" },
      { accessorKey: "source_channel", header: "Channel" },
      { accessorKey: "received", header: "Received", cell: ({ row }) => <span className="tnum">{row.original.received}</span> },
      { accessorKey: "processed", header: "Became leads", cell: ({ row }) => <span className="tnum text-success">{row.original.processed}</span> },
      { accessorKey: "deduplicated", header: "Deduplicated", cell: ({ row }) => <span className="tnum">{row.original.deduplicated}</span> },
      { accessorKey: "failed", header: "Failed", cell: ({ row }) => <span className={row.original.failed ? "tnum text-destructive" : "tnum"}>{row.original.failed}</span> },
      { accessorKey: "unlinked", header: "Unlinked", cell: ({ row }) => <span className={row.original.unlinked ? "tnum text-warning" : "tnum"}>{row.original.unlinked}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <MetricCard compact label="Received" value={totals.received} info={{ definition: "Submissions accepted from any provider, including retries.", grain: "Intake event", source: "sales.intake_events" }} />
        <MetricCard compact label="Became leads" value={totals.processed} tone="success" info={{ definition: "Submissions that produced a lead in the inbox.", grain: "Intake event", source: "sales.intake_events" }} />
        <MetricCard compact label="Deduplicated" value={totals.deduplicated} info={{ definition: "Retries or repeat submissions collapsed onto an existing lead. Expected, not an error.", grain: "Intake event", source: "sales.intake_events" }} />
        <MetricCard compact label="Failed" value={totals.failed} tone={totals.failed ? "destructive" : "neutral"} info={{ definition: "Submissions that errored during acceptance. The raw payload is retained so they can be replayed.", grain: "Intake event", source: "sales.intake_events" }} />
        <MetricCard compact label="Unlinked" value={totals.unlinked} tone={totals.unlinked ? "warning" : "neutral"} info={{ definition: "Accepted but never linked to a lead — the one number that means something was lost.", grain: "Intake event", source: "sales.intake_events", caveat: "Any value above zero should be replayed from the intake log." }} />
      </div>

      {chartData.length > 0 && (
        <Card className="gap-2 px-4 py-3">
          <figure className="space-y-2">
            <figcaption className="text-xs text-muted-foreground">Daily intake outcome across all providers (last 30 days with activity).</figcaption>
            <div className="h-56 w-full" role="img" aria-label="Daily intake outcome">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={36} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--popover-foreground)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
                  <Bar dataKey="processed" name="Leads" stackId="a" fill="var(--success)" />
                  <Bar dataKey="deduplicated" name="Deduplicated" stackId="a" fill="var(--chart-1)" />
                  <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--destructive)" />
                  <Bar dataKey="unlinked" name="Unlinked" stackId="a" fill="var(--warning)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground">The table below carries the same values per provider and channel.</p>
          </figure>
        </Card>
      )}

      <DataTable columns={columns} data={rows} rowKey={(r) => `${r.day}-${r.provider}-${r.source_channel}`} emptyTitle="No intake yet" emptyDescription="Nothing has arrived from a connector. Send a test submission from the Connectors tab to prove the path." pageSize={30} />
    </div>
  );
}
