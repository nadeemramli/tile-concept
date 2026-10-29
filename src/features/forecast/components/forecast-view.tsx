"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { DisabledHint, Hint, InfoTip } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { FORECAST_BAND, FORECAST_QUEUE, STAGE_GROUP_TONE } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addWeeks, currentWeekStart, formatWeek } from "@/features/forecast/week";
import { FORECAST_PAGE_SIZE, STALE_DAY_OPTIONS, type ExceptionQueue, type ForecastQueue } from "@/features/forecast/schema";
import type { BandTotal, ForecastParams, ForecastRow, ForecastWeek } from "@/server/queries/forecast";
import type { ProfileRef, StageRef } from "@/server/queries/reference";
import { ForecastReviewDialog, type ReviewTarget } from "./review-dialog";

const EXCEPTION_QUEUES: ExceptionQueue[] = ["missing_date", "missing_band", "overdue_date", "stale_review", "never_reviewed", "missing_value"];
const BAND_ORDER = ["high", "medium", "low", "unknown"] as const;

const MODE_HINT =
  "Current applies today's forecast to the selected week: corrections show immediately. As recorded rebuilds the forecast from history as it stood at the end of that week (Sunday 23:59, Kuala Lumpur), so later corrections do not change it.";
const POPULATION_HINT =
  "Every open, unarchived opportunity you are allowed to see, counted in the database. Won, lost, deferred and archived work is excluded from the forecast and counted separately below.";
const NEXT_WEEKS_HINT =
  "An alternative view with its own definition: active work grouped by the Monday-to-Sunday week of its expected close date, for the selected week and the three after it. Same unweighted values; overlaps nothing above except the first row.";

/** "RM 1,000.00 + 2 unknown" for each currency in a band. */
function bandValue(rows: BandTotal[]): string {
  if (rows.length === 0) return "No value";
  return rows
    .map((r) => [r.value !== null ? formatMoney(r.value, r.currency) : null, r.value_unknown ? `${r.value_unknown} value${r.value_unknown === 1 ? "" : "s"} unknown` : null].filter(Boolean).join(" + "))
    .join(" · ");
}

export function ForecastView({ week, list, params, members, stages }: {
  week: ForecastWeek;
  list: { queue: ForecastQueue; page: number; rows: ForecastRow[]; total: number; error?: string };
  params: ForecastParams;
  members: ProfileRef[];
  stages: StageRef[];
}) {
  const { can, session } = useSession();
  const [, setQuery] = useQueryStates(
    { week: parseAsString, mode: parseAsString, owner: parseAsString, list: parseAsString, page: parseAsInteger, stale: parseAsString },
    { shallow: false },
  );
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null);
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const stageByKey = useMemo(() => new Map(stages.map((s) => [s.key, s])), [stages]);
  const recorded = week.mode === "recorded";
  const thisWeek = currentWeekStart();
  /** Changing what is shown starts again from the first page. */
  const go = (patch: Partial<Record<"week" | "mode" | "owner" | "list" | "stale", string | null>>) => setQuery({ ...patch, page: null });

  const byBand = (band: string) => week.bands.filter((b) => b.band === band);
  const count = (band: string) => byBand(band).reduce((a, b) => a + b.count, 0);
  const listCount = (q: ForecastQueue) => (q === "week" ? week.week_count : q === "not_recorded" ? week.not_recorded : week.queues[q]);
  const excluded = Object.entries(week.excluded).filter(([, n]) => n > 0);

  const cols = useMemo<ColumnDef<ForecastRow, unknown>[]>(() => {
    const canReview = (r: ForecastRow) => can("sales.write") && (can("sales.read_all") || !r.owner_id || r.owner_id === session.userId);
    return [
      {
        id: "review",
        header: () => <span className="sr-only">Review</span>,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const button = (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setReviewing({ id: r.id, name: r.name, version: r.version, expected_close_date: r.expected_close_date, probability_band: r.probability_band, estimated_value: r.estimated_value, currency: r.currency, evidence: r.evidence, next_action: r.next_action, next_action_due_at: r.next_action_due_at, reviewed_at: r.reviewed_at, reviewed_by_name: names.get(r.reviewed_by ?? "") ?? null });
              }}
            >
              Review
            </Button>
          );
          if (recorded) return <DisabledHint reason="This row shows the forecast as it was recorded. Switch to Current to review today's forecast.">{<Button size="sm" variant="outline" disabled>Review</Button>}</DisabledHint>;
          if (!can("sales.write")) return <DisabledHint reason="Reviewing a forecast needs the sales.write permission (sales staff and sales managers).">{<Button size="sm" variant="outline" disabled>Review</Button>}</DisabledHint>;
          if (!canReview(r)) return <DisabledHint reason={`Only ${names.get(r.owner_id ?? "") ?? "its owner"}, a sales manager or an administrator can review this forecast.`}>{<Button size="sm" variant="outline" disabled>Review</Button>}</DisabledHint>;
          return button;
        },
      },
      {
        accessorKey: "name",
        header: "Opportunity",
        cell: ({ row }) => (
          <Link href={`/sales/pipeline?opportunity=${row.original.id}`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      { id: "who", header: "Account / contact", cell: ({ row }) => <span className="text-xs">{[row.original.account_name, row.original.contact_name].filter(Boolean).join(" · ") || "—"}</span> },
      {
        accessorKey: "stage_key",
        header: "Stage",
        cell: ({ row }) => {
          const s = stageByKey.get(row.original.stage_key ?? "");
          return row.original.recorded ? <TonePill tone={STAGE_GROUP_TONE[s?.reporting_group ?? "open"] ?? "info"} label={s?.label ?? row.original.stage_key ?? "—"} /> : "—";
        },
      },
      {
        accessorKey: "probability_band",
        header: "Likelihood",
        meta: { hint: "The owner's band. Not a percentage; values are never weighted by it." },
        cell: ({ row }) => (row.original.recorded ? <StatusPill map={FORECAST_BAND} value={row.original.probability_band ?? "unknown"} /> : "—"),
      },
      {
        accessorKey: "expected_close_date",
        header: "Expected close",
        meta: { hint: "Stated by the owner. A passed date stays as it was until someone reviews it." },
        cell: ({ row }) => {
          const d = row.original.expected_close_date;
          if (!d) return <span className="text-xs text-warning">Unknown</span>;
          return <span className={cn("tnum text-xs", d < week.today && row.original.status === "open" && "text-destructive")}>{formatDate(d)}</span>;
        },
      },
      {
        accessorKey: "estimated_value",
        header: "Value",
        meta: { hint: "Estimated value, unweighted. Not a quotation total and not a sale." },
        cell: ({ row }) => (row.original.estimated_value === null ? <span className="text-xs text-warning">Unknown</span> : <span className="tnum text-xs">{formatMoney(row.original.estimated_value, row.original.currency)}</span>),
      },
      {
        accessorKey: "evidence",
        header: "Evidence",
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          return v ? (
            <Hint content={v} focusable>
              <span className="line-clamp-2 max-w-56 text-xs">{v}</span>
            </Hint>
          ) : (
            <span className="text-xs text-muted-foreground">None recorded</span>
          );
        },
      },
      { accessorKey: "next_action", header: "Next step", cell: ({ row }) => <span className="text-xs">{row.original.next_action ?? "—"}{row.original.next_action_due_at ? ` · ${formatDate(row.original.next_action_due_at)}` : ""}</span> },
      {
        accessorKey: "reviewed_at",
        header: "Last review",
        meta: { hint: "When the forecast was last reviewed, and by whom. Edits made elsewhere do not count as a review." },
        cell: ({ row }) =>
          row.original.reviewed_at ? (
            <span className="text-xs">
              <span className="tnum">{formatDate(row.original.reviewed_at)}</span>
              <span className="block text-muted-foreground">{names.get(row.original.reviewed_by ?? "") ?? "—"}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Never</span>
          ),
      },
      { accessorKey: "owner_id", header: "Owner", cell: ({ getValue }) => <span className="text-xs">{names.get(getValue<string | null>() ?? "") ?? "Unassigned"}</span> },
    ];
  }, [names, stageByKey, recorded, week.today, can, session.userId]);

  const pages = Math.max(1, Math.ceil(list.total / FORECAST_PAGE_SIZE));
  const first = list.total === 0 ? 0 : (list.page - 1) * FORECAST_PAGE_SIZE + 1;
  const last = Math.min(list.total, list.page * FORECAST_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Forecast week">
          <Button variant="outline" size="icon" className="size-8" aria-label="Previous week" onClick={() => go({ week: addWeeks(params.weekStart, -1) })}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-44 text-center text-sm font-medium tnum" data-testid="forecast-week">
            {formatWeek(params.weekStart)}
          </span>
          <Button variant="outline" size="icon" className="size-8" aria-label="Next week" onClick={() => go({ week: addWeeks(params.weekStart, 1) })}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" disabled={params.weekStart === thisWeek} onClick={() => go({ week: null })}>
            This week
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <ToggleGroup type="single" value={week.mode} onValueChange={(v) => v && go(list.queue === "not_recorded" ? { mode: v === "current" ? null : v, list: null } : { mode: v === "current" ? null : v })} variant="outline" size="sm" aria-label="Forecast view">
            <ToggleGroupItem value="current">Current</ToggleGroupItem>
            <ToggleGroupItem value="recorded">As recorded at week end</ToggleGroupItem>
          </ToggleGroup>
          <InfoTip label="Current or as recorded" content={MODE_HINT} />
        </div>
        {can("sales.read_all") && (
          <Select value={params.ownerId ?? "__all__"} onValueChange={(v) => go({ owner: v === "__all__" ? null : v })}>
            <SelectTrigger className="h-8 w-48" aria-label="Owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Everyone in scope</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1">
          <Select value={String(params.staleDays)} onValueChange={(v) => go({ stale: v === "14" ? null : v })}>
            <SelectTrigger className="h-8 w-40" aria-label="Stale review threshold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STALE_DAY_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Stale after {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <InfoTip label="Stale review" content="A reviewed forecast is listed as stale when its last review is older than this. It is a review prompt, not a business rule; pick what suits your meeting rhythm." />
        </div>
      </div>

      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="forecast-declaration">
        {recorded ? (
          <>
            <strong className="text-foreground">As recorded</strong> at {formatDateTime(week.as_of)} ({week.timezone}). Later corrections are not applied.{" "}
            {week.history_started_at ? `Forecast history began ${formatDateTime(week.history_started_at)}.` : "No forecast history yet."}
            {week.not_recorded > 0 && ` ${formatNumber(week.not_recorded)} opportunit${week.not_recorded === 1 ? "y has" : "ies have"} no recorded state at that time and ${week.not_recorded === 1 ? "is" : "are"} listed as Not recorded.`}
          </>
        ) : (
          <>
            <strong className="text-foreground">Current</strong> forecast as of {formatDateTime(week.as_of)} ({week.timezone}), applied to {formatWeek(week.week_start)}. Corrections show immediately.
          </>
        )}{" "}
        Population: {formatNumber(week.active_count)} active opportunities in your scope{params.ownerId ? ` owned by ${names.get(params.ownerId) ?? "the selected owner"}` : ""}.
        <InfoTip label="Population" content={POPULATION_HINT} className="ml-1 align-middle" />
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="forecast-bands">
        {BAND_ORDER.map((band) => (
          <MetricCard
            key={band}
            label={`${FORECAST_BAND[band].label} likelihood`}
            value={formatNumber(count(band))}
            hint={bandValue(byBand(band))}
            tone={count(band) > 0 && band === "unknown" ? "warning" : "neutral"}
            info={{
              definition: `${FORECAST_BAND[band].hint} Count of active opportunities with this band and an expected close date in the selected week; value is the plain sum of their known estimated values, per currency.`,
              grain: "Opportunity, expected close date in a Monday-to-Sunday Kuala Lumpur week",
              source: "Opportunity forecast fields (reviewed or edited)",
              caveat: "Not weighted by likelihood and not confirmed sales.",
            }}
          />
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
        <MetricCard
          label="Confirmed net sales this week"
          value={week.confirmed_sales.length ? week.confirmed_sales.map((s) => formatMoney(s.net, s.currency)).join(" · ") : formatMoney(0)}
          hint={`${formatNumber(week.confirmed_sales.reduce((a, s) => a + s.events, 0))} documented sale events · not part of the forecast`}
          info={{
            definition: "Documented sales confirmed, credited or voided in the selected week: the signed sum of net revenue (before separately stated tax) by event date.",
            grain: "Sale event, Kuala Lumpur week",
            source: "Sales, receipts & payments (confirmed documents)",
            caveat: "Shown beside the forecast for comparison only. A won opportunity is a pursuit outcome; only a documented sale is revenue.",
          }}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2.5 text-xs" data-testid="forecast-excluded">
          <span className="font-medium text-muted-foreground">Not in the forecast:</span>
          {excluded.length === 0 ? (
            <span className="text-muted-foreground">nothing closed or archived is dated in this week</span>
          ) : (
            excluded.map(([k, n]) => (
              <span key={k} className="tnum">
                {formatNumber(n)} {k}
              </span>
            ))
          )}
          <InfoTip label="Not in the forecast" content="Won, lost, deferred and archived opportunities whose expected close date falls in this week. They are excluded from every count above." />
        </div>
      </div>

      <Tabs value={list.queue} onValueChange={(v) => go({ list: v === "week" ? null : v })}>
        <TabsList className="h-auto flex-wrap">
          {(["week", ...EXCEPTION_QUEUES, ...(recorded ? (["not_recorded"] as const) : [])] as ForecastQueue[]).map((q) => (
            <Hint key={q} content={q === "stale_review" ? `${FORECAST_QUEUE[q].hint} Threshold: ${params.staleDays} days.` : FORECAST_QUEUE[q].hint}>
              <TabsTrigger value={q} className="gap-1.5">
                {FORECAST_QUEUE[q].label}
                <span className={cn("tnum rounded px-1 text-[10px]", q !== "week" && listCount(q) > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>{formatNumber(listCount(q))}</span>
              </TabsTrigger>
            </Hint>
          ))}
        </TabsList>
      </Tabs>

      {list.error ? (
        <p className="text-sm text-destructive">{list.error}</p>
      ) : (
        <DataTable
          columns={cols}
          data={list.rows}
          rowKey={(r) => r.id}
          hidePagination
          columnToggle
          emptyTitle={list.queue === "week" ? "Nothing expected to close this week" : `No opportunities: ${FORECAST_QUEUE[list.queue].label.toLowerCase()}`}
          emptyDescription={list.queue === "week" ? "Open work appears here when its expected close date falls in the selected week." : "Every active opportunity in your scope passes this check."}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tnum" data-testid="forecast-range">
          {formatNumber(first)}–{formatNumber(last)} of {formatNumber(list.total)}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={list.page <= 1} onClick={() => setQuery({ page: list.page - 1 === 1 ? null : list.page - 1 })}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={list.page >= pages} onClick={() => setQuery({ page: list.page + 1 })}>
            Next
          </Button>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="next-four-weeks">
        <h2 id="next-four-weeks" className="flex items-center gap-1 text-sm font-medium">
          Next four weeks by expected close
          <InfoTip label="Next four weeks" content={NEXT_WEEKS_HINT} />
        </h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Week</th>
                {BAND_ORDER.map((b) => (
                  <th key={b} className="px-3 py-2 text-right font-medium">
                    {FORECAST_BAND[b].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => {
                const ws = addWeeks(params.weekStart, i);
                const rows = week.next_four_weeks.filter((r) => r.week_start === ws);
                return (
                  <tr key={ws} className="border-t">
                    <td className="px-3 py-2">{formatWeek(ws)}</td>
                    {BAND_ORDER.map((b) => {
                      const cell = rows.filter((r) => r.band === b);
                      const n = cell.reduce((a, r) => a + r.count, 0);
                      return (
                        <td key={b} className="tnum px-3 py-2 text-right">
                          {n === 0 ? "—" : (
                            <>
                              {formatNumber(n)}
                              <span className="block text-muted-foreground">{bandValue(cell)}</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {reviewing && <ForecastReviewDialog key={reviewing.id} open onOpenChange={(o) => !o && setReviewing(null)} target={reviewing} />}
    </div>
  );
}
