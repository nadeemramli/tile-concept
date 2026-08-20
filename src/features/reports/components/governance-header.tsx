import { AlertTriangle, Database, Ruler, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { TonePill } from "@/components/patterns/status-pill";
import { formatDateTime } from "@/lib/format";
import type { MetricDefinition } from "@/server/queries/reports";
import { PII_LABEL, QUALITY_TONE, type ReportDef } from "@/features/reports/registry";

/**
 * Every governed report declares what its numbers mean before it shows any
 * (PRD §7.9): definition and formula, grain, filters in effect, source
 * lineage, freshness, PII classification, quality, and any caveat.
 */
export function GovernanceHeader({
  report,
  definitions,
  computedAt,
  filters,
}: {
  report: ReportDef;
  definitions: MetricDefinition[];
  computedAt: string;
  filters: string;
}) {
  const piiClass = definitions[0]?.pii_class ?? "aggregate";
  const grain = definitions[0]?.grain ?? "—";
  const sources = [...new Set(definitions.flatMap((d) => d.sources))];
  const caveats = definitions.filter((d) => d.caveat);

  return (
    <Card className="gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">How this report is defined</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {definitions.map((d) => (
            <TonePill key={d.key} tone={QUALITY_TONE[d.quality] ?? "info"} label={`${d.name}: ${d.quality}`} />
          ))}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 sm:col-span-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Ruler className="size-3" aria-hidden /> Metric definition
          </dt>
          <dd className="mt-0.5 space-y-1 text-sm">
            {definitions.length === 0 && <span className="text-muted-foreground">No governed definition is registered for this report.</span>}
            {definitions.map((d) => (
              <div key={d.key}>
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground"> — {d.formula}</span>
              </div>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Grain</dt>
          <dd className="mt-0.5 text-sm">One row per {grain.toLowerCase()}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Filters in effect</dt>
          <dd className="mt-0.5 text-sm">{filters}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Database className="size-3" aria-hidden /> Source lineage
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {sources.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
            {sources.map((s) => (
              <span key={s} className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">
                {s}
              </span>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">Freshness</dt>
          <dd className="mt-0.5 text-sm tnum">Computed {formatDateTime(computedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3" aria-hidden /> Privacy
          </dt>
          <dd className="mt-0.5 text-sm">{PII_LABEL[piiClass] ?? piiClass}</dd>
        </div>
      </dl>

      {report.scopeNote && <p className="text-xs text-muted-foreground">{report.scopeNote}</p>}

      {caveats.map((d) => (
        <p key={d.key} className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{d.name}:</span> {d.caveat}
          </span>
        </p>
      ))}
    </Card>
  );
}
