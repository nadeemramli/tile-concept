"use client";

import { useMemo, useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/states";
import { TonePill } from "@/components/patterns/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useAction } from "@/features/catalog/use-action";
import { exportReportAction } from "@/server/commands/reports";
import { ReportChart } from "@/features/reports/components/report-chart";
import { REPORT_TONE, type ReportColumn, type ReportDef } from "@/features/reports/registry";

const PRESETS: { key: string; label: string; days: number | "ytd" }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "ytd", label: "Year to date", days: "ytd" },
];

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Reconstruct a stored "YYYY-MM-DD" at UTC noon so day arithmetic stays on
// stable calendar days regardless of the viewer's timezone.
function dayFromIso(s: string) {
  return new Date(`${s}T12:00:00Z`);
}

export function ReportView({ report, rows, currency, error }: { report: ReportDef; rows: Record<string, unknown>[]; currency: string; error: string | null }) {
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(""));
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(""));
  const [confirming, setConfirming] = useState(false);

  const exporter = useAction(exportReportAction, {
    refresh: false,
    onSuccess: (data) => {
      // Blob download: the CSV is generated server-side, so the browser only
      // saves what the server just produced.
      const blob = new Blob([`﻿${data.csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setConfirming(false);
    },
  });

  const applyPreset = (days: number | "ytd") => {
    const today = new Date();
    const start = days === "ytd" ? new Date(today.getFullYear(), 0, 1) : new Date(today.getTime() - days * 86400000);
    setFrom(isoDay(start));
    setTo(isoDay(today));
  };

  const activePreset = useMemo(() => {
    if (!from || !to) return "";
    // Match on the shape of the selected range relative to its own end date so
    // this stays pure (no live-clock reads during render).
    const end = dayFromIso(to);
    for (const p of PRESETS) {
      const start = p.days === "ytd" ? new Date(end.getUTCFullYear(), 0, 1) : new Date(end.getTime() - p.days * 86400000);
      if (isoDay(start) === from) return p.key;
    }
    return "";
  }, [from, to]);

  const columns = useMemo<ColumnDef<Record<string, unknown>, unknown>[]>(
    () =>
      report.columns.map((c) => ({
        id: c.key,
        header: c.label,
        accessorFn: (r) => r[c.key],
        cell: ({ row }) => <Cell column={c} value={row.original[c.key]} currency={currency} />,
      })),
    [report, currency],
  );

  return (
    <div className="space-y-4">
      {report.ranged && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={activePreset === p.key ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value || null)} className="h-8 w-36 text-sm" aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value || null)} className="h-8 w-36 text-sm" aria-label="To date" />
          {(from || to) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setFrom(null);
                setTo(null);
              }}
            >
              All time
            </Button>
          )}
          <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={() => setConfirming(true)} disabled={rows.length === 0}>
            <Download className="size-3.5" aria-hidden /> Export CSV
          </Button>
        </div>
      )}
      {!report.ranged && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">This report is point-in-time; a date range does not apply.</p>
          <Button size="sm" variant="outline" className="ml-auto h-8 gap-1.5" onClick={() => setConfirming(true)} disabled={rows.length === 0}>
            <Download className="size-3.5" aria-hidden /> Export CSV
          </Button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This report could not be computed: {error}
        </p>
      )}

      {rows.length === 0 && !error ? (
        <EmptyState
          title="Nothing to report for this period"
          description={report.ranged ? "No rows fall inside the selected dates. Widen the range or clear it to see all time." : "No rows exist yet for this report."}
        />
      ) : (
        <>
          {report.chart && <ReportChart spec={report.chart} rows={rows} />}
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(r) => String(r[report.columns[0].key] ?? Math.random())}
            columnToggle
            searchable
            searchPlaceholder="Filter rows…"
            pageSize={50}
            emptyTitle="No rows"
            emptyDescription="No rows match the current filter."
          />
        </>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export {report.title}</DialogTitle>
            <DialogDescription>Review what leaves the app before downloading.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Rows</dt>
              <dd className="tnum">{rows.length.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Period</dt>
              <dd>{report.ranged ? `${from || "start"} → ${to || "today"}` : "Point-in-time"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Columns</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {report.columns.map((c) => (
                  <span key={c.key} className="rounded border bg-muted/50 px-1.5 py-0.5 text-[11px]">
                    {c.label}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
          <p className="rounded-md border border-info/25 bg-info/10 px-2.5 py-2 text-xs text-info">
            This export is aggregate-only — it contains no customer names, phone numbers or email addresses. The file is generated
            fresh on the server, so it matches the definition shown above rather than anything cached in your browser.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button disabled={exporter.pending} onClick={() => exporter.run({ slug: report.slug, from, to })}>
              {exporter.pending ? "Preparing…" : `Download ${rows.length} rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Cell({ column, value, currency }: { column: ReportColumn; value: unknown; currency: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  switch (column.format) {
    case "money":
      return <span className="tnum">{formatMoney(Number(value), currency)}</span>;
    case "number":
      return <span className="tnum">{formatNumber(Number(value))}</span>;
    case "decimal":
      return <span className="tnum">{formatNumber(Number(value), 2)}</span>;
    case "duration":
      return <span className="tnum">{formatDuration(Number(value))}</span>;
    case "date":
      return <span className="tnum">{formatDate(String(value), "MMM yyyy")}</span>;
    case "datetime":
      return <span className="tnum">{formatDateTime(String(value))}</span>;
    case "tone": {
      const v = String(value);
      return <TonePill tone={REPORT_TONE[v] ?? "neutral"} label={v.replace(/_/g, " ")} />;
    }
    case "json": {
      const obj = value as Record<string, unknown>;
      const entries = Object.entries(obj ?? {});
      if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {entries.map(([k, v]) => (
            <span key={k} className="rounded border bg-muted/50 px-1.5 py-0.5 text-[11px]">
              {k.replace(/_/g, " ")} {String(v)}
            </span>
          ))}
        </span>
      );
    }
    default:
      return <span>{String(value).replace(/_/g, " ")}</span>;
  }
}

/** Minutes → a readable response time. */
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${formatNumber(minutes, 0)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${formatNumber(hours, 1)} h`;
  return `${formatNumber(hours / 24, 1)} d`;
}
