import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { REPORTS, type ReportDef } from "@/features/reports/registry";

export interface MetricDefinition {
  key: string;
  name: string;
  report_key: string;
  formula: string;
  grain: string;
  sources: string[];
  pii_class: string;
  caveat: string | null;
  quality: string;
}

/** Definitions are the point of a governed report; never render a number without one. */
export const getMetricDefinitions = cache(async (): Promise<MetricDefinition[]> => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("metric_definitions").select("key, name, report_key, formula, grain, sources, pii_class, caveat, quality");
  return (data ?? []).map((d) => ({
    key: d.key ?? "",
    name: d.name ?? "",
    report_key: d.report_key ?? "",
    formula: d.formula ?? "",
    grain: d.grain ?? "",
    sources: d.sources ?? [],
    pii_class: d.pii_class ?? "aggregate",
    caveat: d.caveat,
    quality: d.quality ?? "monitored",
  }));
});

export async function getDefinitionsFor(reportKey: string): Promise<MetricDefinition[]> {
  const all = await getMetricDefinitions();
  return all.filter((d) => d.report_key === reportKey);
}

export type ReportRow = Record<string, unknown>;

export interface ReportResult {
  rows: ReportRow[];
  computedAt: string;
  error: string | null;
}

/** Runs one report RPC. Range parameters are only sent when the report accepts them. */
export async function runReport(def: ReportDef, from?: string, to?: string): Promise<ReportResult> {
  const supabase = await createServerSupabase();
  const args = def.ranged ? { p_from: from ?? undefined, p_to: to ?? undefined } : undefined;
  // The generated types give each RPC its own argument shape; the registry is
  // data-driven, so this one call site is deliberately loose.
  const { data, error } = await (supabase.rpc as unknown as (fn: string, params?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(def.rpc, args);
  return {
    rows: Array.isArray(data) ? (data as ReportRow[]) : [],
    computedAt: new Date().toISOString(),
    error: error?.message ?? null,
  };
}

export interface ReportSummary extends ReportDef {
  definitions: MetricDefinition[];
}

export async function listReports(): Promise<ReportSummary[]> {
  const defs = await getMetricDefinitions();
  return REPORTS.map((r) => ({ ...r, definitions: defs.filter((d) => d.report_key === r.metricKey) }));
}
