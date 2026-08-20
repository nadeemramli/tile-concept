"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import type { ChartSpec } from "@/features/reports/registry";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * Charts are secondary to the table (PRD §12.2): restrained, themed through
 * CSS variables so both modes work, and always accompanied by the full table
 * below — the chart never carries information the table lacks.
 */
export function ReportChart({ spec, rows }: { spec: ChartSpec; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  const data = (spec.limit ? rows.slice(0, spec.limit) : rows).map((r) => {
    const out: Record<string, string | number> = { __label: label(r[spec.category]) };
    for (const s of spec.series) out[s.key] = Number(r[s.key] ?? 0);
    return out;
  });

  const axis = { stroke: "var(--muted-foreground)", fontSize: 11 } as const;
  const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;
  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--accent)", opacity: 0.4 }}
      contentStyle={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        color: "var(--popover-foreground)",
        fontSize: 12,
      }}
      formatter={(v, n) => [formatNumber(Number(v), 2), String(n)] as [string, string]}
    />
  );
  const legend = <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />;

  return (
    <Card className="gap-2 px-4 py-3">
      <figure className="space-y-2">
        <figcaption className="text-xs text-muted-foreground">{spec.caption}</figcaption>
        <div className="h-64 w-full" role="img" aria-label={spec.caption}>
          <ResponsiveContainer width="100%" height="100%">
            {spec.kind === "line" ? (
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                {grid}
                <XAxis dataKey="__label" {...axis} tickLine={false} />
                <YAxis {...axis} tickLine={false} axisLine={false} width={44} />
                {tooltip}
                {legend}
                {spec.series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            ) : spec.kind === "hbar" ? (
              <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                {grid}
                <XAxis type="number" {...axis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="__label" {...axis} tickLine={false} axisLine={false} width={150} />
                {tooltip}
                {legend}
                {spec.series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[0, 3, 3, 0]} />
                ))}
              </BarChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                {grid}
                <XAxis dataKey="__label" {...axis} tickLine={false} interval={0} angle={data.length > 6 ? -20 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 54 : 24} />
                <YAxis {...axis} tickLine={false} axisLine={false} width={44} />
                {tooltip}
                {legend}
                {spec.series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Every value plotted here appears in the table below, which is the accessible equivalent of this chart.
        </p>
      </figure>
    </Card>
  );
}

function label(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  // Cohort months arrive as dates; render them short.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s, "MMM yyyy");
  return s.replace(/_/g, " ");
}
