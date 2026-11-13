import "server-only";

import { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { FORECAST_PAGE_SIZE, type ExceptionQueue, type ForecastMode, type ForecastQueue } from "@/features/forecast/schema";

export interface BandTotal {
  band: "high" | "medium" | "low" | "unknown";
  currency: string;
  count: number;
  /** Plain sum of the known values; null when none is known. Never weighted. */
  value: number | null;
  value_unknown: number;
}

export interface ForecastWeek {
  mode: ForecastMode;
  as_of: string;
  timezone: string;
  today: string;
  week_start: string;
  week_end: string;
  stale_days: number;
  history_started_at: string | null;
  week_count: number;
  active_count: number;
  not_recorded: number;
  bands: BandTotal[];
  excluded: { won: number; lost: number; deferred: number; archived: number };
  queues: Record<ExceptionQueue, number>;
  next_four_weeks: (BandTotal & { week_start: string })[];
  confirmed_sales: { currency: string; net: number; events: number }[];
}

export interface ForecastRow {
  id: string;
  name: string;
  account_id: string | null;
  account_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  owner_id: string | null;
  stage_key: string | null;
  status: string | null;
  expected_close_date: string | null;
  probability_band: string | null;
  estimated_value: number | null;
  currency: string;
  evidence: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  version: number;
  recorded: boolean;
}

export interface ForecastHistoryEntry {
  id: string;
  recorded_at: string;
  actor_id: string | null;
  kind: string;
  review_context: string | null;
  stage_key: string;
  status: string;
  archived: boolean;
  expected_close_date: string | null;
  probability_band: string | null;
  estimated_value: number | null;
  currency: string;
  evidence: string | null;
}

export interface ForecastParams {
  weekStart: string;
  mode: ForecastMode;
  ownerId: string | null;
  staleDays: number;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapBand(b: Record<string, unknown>): BandTotal {
  return { band: b.band as BandTotal["band"], currency: String(b.currency), count: Number(b.count), value: num(b.value), value_unknown: Number(b.value_unknown) };
}

/** The selected week's summary, computed in the database over the caller's whole scope. */
export async function getForecastWeek(p: ForecastParams): Promise<{ data: ForecastWeek } | { error: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("forecast_week", { p_week_start: p.weekStart, p_mode: p.mode, p_owner_id: p.ownerId ?? undefined, p_stale_days: p.staleDays });
  if (error || !data) return { error: error?.message ?? "Forecast unavailable" };
  const j = data as Record<string, Json>;
  const arr = (v: Json | undefined) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    data: {
      mode: j.mode as ForecastMode,
      as_of: String(j.as_of),
      timezone: String(j.timezone),
      today: String(j.today),
      week_start: String(j.week_start),
      week_end: String(j.week_end),
      stale_days: Number(j.stale_days),
      history_started_at: (j.history_started_at as string | null) ?? null,
      week_count: Number(j.week_count),
      active_count: Number(j.active_count),
      not_recorded: Number(j.not_recorded),
      bands: arr(j.bands).map(mapBand),
      excluded: j.excluded as ForecastWeek["excluded"],
      queues: j.queues as ForecastWeek["queues"],
      next_four_weeks: arr(j.next_four_weeks).map((b) => ({ ...mapBand(b), week_start: String(b.week_start) })),
      confirmed_sales: arr(j.confirmed_sales).map((s) => ({ currency: String(s.currency), net: Number(s.net), events: Number(s.events) })),
    },
  };
}

/** One page of a forecast list plus that list's complete count. */
export async function getForecastQueue(p: ForecastParams & { queue: ForecastQueue; page: number }): Promise<{ rows: ForecastRow[]; total: number; error?: string }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("forecast_queue", {
    p_queue: p.queue,
    p_week_start: p.weekStart,
    p_mode: p.mode,
    p_owner_id: p.ownerId ?? undefined,
    p_stale_days: p.staleDays,
    p_limit: FORECAST_PAGE_SIZE,
    p_offset: (Math.max(1, p.page) - 1) * FORECAST_PAGE_SIZE,
  });
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []).map(
    (r): ForecastRow => ({
      id: r.id,
      name: r.name ?? "",
      account_id: r.account_id,
      account_name: r.account_name,
      contact_id: r.contact_id,
      contact_name: r.contact_name,
      owner_id: r.owner_id,
      stage_key: r.stage_key,
      status: r.status,
      expected_close_date: r.expected_close_date,
      probability_band: r.probability_band,
      estimated_value: num(r.estimated_value),
      currency: r.currency ?? "MYR",
      evidence: r.evidence,
      next_action: r.next_action,
      next_action_due_at: r.next_action_due_at,
      reviewed_at: r.reviewed_at,
      reviewed_by: r.reviewed_by,
      created_at: r.created_at,
      version: Number(r.version),
      recorded: !!r.recorded,
    }),
  );
  return { rows, total: data?.[0] ? Number(data[0].total_count) : 0 };
}

export async function getForecastHistory(opportunityId: string, limit = 20): Promise<ForecastHistoryEntry[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("opportunity_forecast_history")
    .select("id, recorded_at, actor_id, kind, review_context, stage_key, status, archived, expected_close_date, probability_band, estimated_value, currency, evidence")
    .eq("opportunity_id", opportunityId)
    .order("recorded_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(limit);
  return (data ?? []).map((h) => ({
    id: h.id!,
    recorded_at: h.recorded_at!,
    actor_id: h.actor_id,
    kind: h.kind!,
    review_context: h.review_context,
    stage_key: h.stage_key!,
    status: h.status!,
    archived: !!h.archived,
    expected_close_date: h.expected_close_date,
    probability_band: h.probability_band,
    estimated_value: num(h.estimated_value),
    currency: h.currency ?? "MYR",
    evidence: h.evidence,
  }));
}
