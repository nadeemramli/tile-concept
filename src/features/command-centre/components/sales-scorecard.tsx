"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { formatMoney } from "@/lib/format";
import { setSalesTargetAction } from "@/server/commands/scorecard";
import type { SalesScorecard as Scorecard } from "@/server/queries/command-centre";

const SEGMENTS: Record<string, { label: string; color: string }> = {
  institutional: { label: "Institutional / Gov", color: "#1E40AF" },
  residential: { label: "Residential", color: "#2563EB" },
  fnb: { label: "F&B / Retail", color: "#D97706" },
  hospitality: { label: "Hospitality", color: "#16A34A" },
  commercial: { label: "Commercial", color: "#7C3AED" },
  other: { label: "Other", color: "#6B7280" },
};
const seg = (k: string) => SEGMENTS[k] ?? SEGMENTS.other;

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function SalesScorecard({ data, canManage }: { data: Scorecard; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const cur = data.currency;
  const target = data.target ?? 0;
  const covered = data.collected + data.pipeline;
  const gap = Math.max(0, target - covered);

  // Bar widths as a share of target: collected first, then pipeline up to the
  // target, gap fills the remainder.
  const collectedW = target ? Math.min(data.collected / target, 1) : 0;
  const pipelineW = target ? Math.min(data.pipeline / target, Math.max(0, 1 - data.collected / target)) : 0;

  const segTotal = useMemo(() => data.segments.reduce((s, x) => s + x.value, 0), [data.segments]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>Annual target coverage · {data.year}</span>
          {canManage && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-normal text-info hover:underline">
              <Pencil className="size-3" aria-hidden /> {data.target === null ? "Set target" : "Edit target"}
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.target === null ? (
          <p className="text-sm text-muted-foreground">
            No annual target set for {data.year}. {canManage ? "Set one to track collection and pipeline against the goal." : "Ask an administrator to set the annual target."}
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
            {/* Coverage */}
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                <Stat label="Annual target" value={formatMoney(target, cur)} tone="text-warning" />
                <Stat label="YTD collected" value={formatMoney(data.collected, cur)} tone="text-success" sub={target ? pct(data.collected / target) : undefined} />
                <Stat label="Open pipeline" value={formatMoney(data.pipeline, cur)} tone="text-info" sub={target ? pct(data.pipeline / target) : undefined} />
                <Stat label="Coverage" value={target ? pct(covered / target) : "—"} tone="text-ai" sub="collected + pipeline" />
                <Stat label="Remaining gap" value={formatMoney(gap, cur)} tone="text-destructive" />
              </div>

              <div className="flex h-4 overflow-hidden rounded-md bg-muted" role="img" aria-label={`Coverage ${target ? pct(covered / target) : ""}`}>
                <div className="bg-success" style={{ width: `${collectedW * 100}%` }} />
                <div className="bg-info" style={{ width: `${pipelineW * 100}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <Legend swatch="bg-success" label="Collected" value={formatMoney(data.collected, cur)} />
                <Legend swatch="bg-info" label="Pipeline" value={formatMoney(data.pipeline, cur)} />
                <Legend swatch="bg-muted-foreground/30" label="Gap" value={formatMoney(gap, cur)} />
              </div>
              <p className="text-[11px] text-muted-foreground">Collection is app-recorded purchases (not reconciled with SQL Account); pipeline is unweighted open opportunity value in your scope.</p>
            </div>

            {/* Pipeline by segment */}
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pipeline by segment</div>
              {segTotal === 0 ? (
                <p className="text-xs text-muted-foreground">No open pipeline to break down.</p>
              ) : (
                <>
                  <div className="mx-auto h-32 w-32" role="img" aria-label="Pipeline by segment">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.segments} dataKey="value" nameKey="segment" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
                          {data.segments.map((s) => (
                            <Cell key={s.segment} fill={seg(s.segment).color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--popover-foreground)", fontSize: 12 }}
                          formatter={(v, n) => [`${formatMoney(Number(v), cur)} · ${pct(Number(v) / segTotal)}`, seg(String(n)).label] as [string, string]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {data.segments.map((s) => (
                      <li key={s.segment} className="flex items-center gap-2 text-[11.5px]">
                        <span className="size-2 shrink-0 rounded-sm" style={{ background: seg(s.segment).color }} />
                        <span className="flex-1 truncate text-muted-foreground">{seg(s.segment).label}</span>
                        <span className="tnum font-medium">{formatMoney(s.value, cur)}</span>
                        <span className="tnum w-11 text-right text-muted-foreground">{pct(s.value / segTotal)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>

      {canManage && editing && <TargetDialog open={editing} onOpenChange={setEditing} year={data.year} current={data.target} />}
    </Card>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={`tnum text-base font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-sm ${swatch}`} />
      {label} <span className="tnum font-medium text-foreground">{value}</span>
    </span>
  );
}

function TargetDialog({ open, onOpenChange, year, current }: { open: boolean; onOpenChange: (o: boolean) => void; year: number; current: number | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(current !== null ? String(current) : "");
  const [pending, start] = useTransition();
  const n = Number(amount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Annual sales target · {year}</DialogTitle>
          <DialogDescription>Sets the target the Command Centre measures collection and pipeline against. Admin only; the change is audited.</DialogDescription>
        </DialogHeader>
        <Field label="Target amount (MYR)" required>
          <Input className="h-9 tnum" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000000" autoFocus />
        </Field>
        <DialogFooter>
          <Button
            disabled={pending || Number.isNaN(n) || n < 0 || amount === ""}
            onClick={() =>
              start(async () => {
                const r = await setSalesTargetAction({ year, amount: n });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.message);
                onOpenChange(false);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save target"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
