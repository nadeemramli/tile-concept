/**
 * The governed report catalogue (PRD §7.9). One entry per report: what it
 * answers, which RPC produces it, which columns it renders, and which chart —
 * if any — earns its place. Metric definitions (formula, grain, lineage, PII
 * class, caveat) live in the database and are joined on `metricKey`.
 *
 * Pure data: imported by both server queries and client components.
 */

export type ReportSlug =
  | "pipeline"
  | "lead-source"
  | "quotes"
  | "walkins"
  | "cohorts"
  | "demand"
  | "price"
  | "stock"
  | "data-quality"
  | "content";

export type ColumnFormat = "text" | "number" | "money" | "decimal" | "percent" | "date" | "datetime" | "duration" | "tone" | "json";

export interface ReportColumn {
  key: string;
  label: string;
  format?: ColumnFormat;
  /** Right-align and use tabular numerals. Defaults to true for numeric formats. */
  numeric?: boolean;
  description?: string;
}

export interface ChartSpec {
  kind: "bar" | "line" | "hbar";
  /** Row field used for the category axis. */
  category: string;
  /** Row fields plotted, in order. */
  series: { key: string; label: string; color: string }[];
  /** Cap the number of rows charted (the table always shows everything). */
  limit?: number;
  caption: string;
}

export interface ReportDef {
  slug: ReportSlug;
  title: string;
  /** The operational question this report answers, in one sentence. */
  question: string;
  /** RPC name in the api schema. */
  rpc: string;
  /** `report_key` in reporting.metric_definitions. */
  metricKey: string;
  /** Whether the RPC accepts p_from / p_to. */
  ranged: boolean;
  /** Permission needed on top of report.read, if any. */
  columns: ReportColumn[];
  chart?: ChartSpec;
  /** Shown under the governance header when the data has a known boundary. */
  scopeNote?: string;
}

export const REPORTS: ReportDef[] = [
  {
    slug: "pipeline",
    title: "Sales pipeline and aging",
    question: "Where is the open work sitting, how old is it, and what is overdue?",
    rpc: "report_pipeline",
    metricKey: "pipeline",
    ranged: true,
    columns: [
      { key: "stage_label", label: "Stage" },
      { key: "reporting_group", label: "Group", format: "tone" },
      { key: "opportunities", label: "Opportunities", format: "number" },
      { key: "open_value", label: "Value", format: "money" },
      { key: "avg_age_days", label: "Avg age (days)", format: "decimal" },
      { key: "overdue", label: "Overdue next action", format: "number" },
    ],
    chart: {
      kind: "bar",
      category: "stage_label",
      series: [
        { key: "opportunities", label: "Opportunities", color: "var(--chart-1)" },
        { key: "overdue", label: "Overdue", color: "var(--destructive)" },
      ],
      caption: "Opportunity count per stage, with the overdue subset.",
    },
    scopeNote: "Stages are the workspace's configured stages; custom stages map to their reporting group.",
  },
  {
    slug: "lead-source",
    title: "Lead source and response",
    question: "Which sources produce enquiries, and how fast do we answer them?",
    rpc: "report_lead_source",
    metricKey: "lead_source",
    ranged: true,
    columns: [
      { key: "source_channel", label: "Source" },
      { key: "leads", label: "Leads", format: "number" },
      { key: "responded", label: "Responded", format: "number" },
      { key: "median_response_minutes", label: "Median response", format: "duration" },
      { key: "qualified", label: "Qualified", format: "number" },
      { key: "converted", label: "Converted", format: "number" },
      { key: "disqualified", label: "Disqualified", format: "number" },
    ],
    chart: {
      kind: "bar",
      category: "source_channel",
      series: [
        { key: "leads", label: "Leads", color: "var(--chart-1)" },
        { key: "converted", label: "Converted", color: "var(--success)" },
      ],
      caption: "Leads received and converted per source.",
    },
  },
  {
    slug: "quotes",
    title: "Quote conversion and revisions",
    question: "How often do issued quotes close, and how many revisions do they take?",
    rpc: "report_quotes",
    metricKey: "quote",
    ranged: true,
    columns: [
      { key: "bucket", label: "Source" },
      { key: "quotes", label: "Quotes", format: "number" },
      { key: "revisions", label: "Avg versions", format: "decimal" },
      { key: "total_value", label: "Quoted value", format: "money" },
      { key: "won", label: "Won", format: "number" },
      { key: "lost", label: "Lost", format: "number" },
      { key: "open", label: "Open", format: "number" },
    ],
    chart: {
      kind: "bar",
      category: "bucket",
      series: [
        { key: "won", label: "Won", color: "var(--success)" },
        { key: "lost", label: "Lost", color: "var(--destructive)" },
        { key: "open", label: "Open", color: "var(--chart-1)" },
      ],
      caption: "Outcome of opportunities that received a quote, per source.",
    },
  },
  {
    slug: "walkins",
    title: "Walk-ins and purchases",
    question: "How many people walked in, how many bought, and how did they pay?",
    rpc: "report_walkins",
    metricKey: "walkin",
    ranged: true,
    columns: [
      { key: "bucket", label: "Location" },
      { key: "visits", label: "Visits", format: "number" },
      { key: "new_customers", label: "New customers", format: "number" },
      { key: "purchases", label: "Purchases", format: "number" },
      { key: "amount", label: "Amount", format: "money" },
      { key: "payment_mix", label: "Payment mix", format: "json" },
    ],
    chart: {
      kind: "bar",
      category: "bucket",
      series: [
        { key: "visits", label: "Visits", color: "var(--chart-1)" },
        { key: "purchases", label: "Purchases", color: "var(--success)" },
      ],
      caption: "Visits and the purchases recorded against them, per location.",
    },
  },
  {
    slug: "cohorts",
    title: "Customer repeat and cohorts",
    question: "Do customers come back, and how long do they take?",
    rpc: "report_cohorts",
    metricKey: "cohort",
    ranged: true,
    columns: [
      { key: "cohort_month", label: "First purchase month", format: "date" },
      { key: "customers", label: "Customers", format: "number" },
      { key: "repeat_customers", label: "Repeat customers", format: "number" },
      { key: "purchases", label: "Purchases", format: "number" },
      { key: "amount", label: "Amount", format: "money" },
      { key: "median_days_between", label: "Median gap (days)", format: "decimal" },
    ],
    chart: {
      kind: "line",
      category: "cohort_month",
      series: [
        { key: "customers", label: "Customers", color: "var(--chart-1)" },
        { key: "repeat_customers", label: "Repeat", color: "var(--ai)" },
      ],
      caption: "Customers acquired each month and how many bought again.",
    },
    scopeNote: "A cohort is the month of a customer's first recorded purchase.",
  },
  {
    slug: "demand",
    title: "Product and brand demand",
    question: "What are people asking for, and what are they actually buying?",
    rpc: "report_demand",
    metricKey: "demand",
    ranged: true,
    columns: [
      { key: "product_code", label: "Code" },
      { key: "product_name", label: "Product" },
      { key: "brand_name", label: "Brand" },
      { key: "category_label", label: "Category" },
      { key: "quoted_qty", label: "Quoted qty", format: "decimal" },
      { key: "quoted_value", label: "Quoted value", format: "money" },
      { key: "purchased_qty", label: "Purchased qty", format: "decimal" },
      { key: "purchased_value", label: "Purchased value", format: "money" },
    ],
    chart: {
      kind: "hbar",
      category: "product_name",
      series: [
        { key: "purchased_value", label: "Purchased", color: "var(--success)" },
        { key: "quoted_value", label: "Quoted", color: "var(--chart-1)" },
      ],
      limit: 12,
      caption: "Top products by purchased value; the table below lists them all.",
    },
  },
  {
    slug: "price",
    title: "Price coverage and conflicts",
    question: "Which products can we quote from confidently, and which cannot?",
    rpc: "report_price_health",
    metricKey: "price",
    ranged: false,
    columns: [
      { key: "bucket", label: "Brand" },
      { key: "products", label: "Active products", format: "number" },
      { key: "with_current_price", label: "With current price", format: "number" },
      { key: "conflicted", label: "Conflicted", format: "number" },
      { key: "expiring_30d", label: "Expiring in 30d", format: "number" },
      { key: "unreviewed", label: "Unreviewed", format: "number" },
    ],
    chart: {
      kind: "bar",
      category: "bucket",
      series: [
        { key: "with_current_price", label: "Priced", color: "var(--success)" },
        { key: "products", label: "Active", color: "var(--chart-1)" },
      ],
      caption: "Active products against those carrying a current approved price.",
    },
    scopeNote: "Point-in-time, not a period: this is the state of the catalogue right now.",
  },
  {
    slug: "stock",
    title: "Stock freshness and compliance",
    question: "Which suppliers have gone quiet, and how stale is what we are showing?",
    rpc: "report_stock_freshness",
    metricKey: "stock",
    ranged: false,
    columns: [
      { key: "supplier_name", label: "Supplier" },
      { key: "freshness", label: "Freshness", format: "tone" },
      { key: "last_update_at", label: "Last update", format: "datetime" },
      { key: "snapshot_count", label: "Snapshots", format: "number" },
      { key: "open_cases", label: "Open reconciliation cases", format: "number" },
    ],
    scopeNote: "Point-in-time. Freshness bands come from each supplier's policy, not a global rule.",
  },
  {
    slug: "data-quality",
    title: "Data quality and throughput",
    question: "What is wrong with the data, and is anyone clearing it?",
    rpc: "report_data_quality",
    metricKey: "data_quality",
    ranged: false,
    columns: [
      { key: "bucket", label: "Issue type" },
      { key: "open_issues", label: "Open", format: "number" },
      { key: "high_severity", label: "High severity", format: "number" },
      { key: "resolved_30d", label: "Resolved (30d)", format: "number" },
      { key: "pending_reviews", label: "Pending imports", format: "number" },
      { key: "duplicates_open", label: "Duplicates waiting", format: "number" },
    ],
    chart: {
      kind: "hbar",
      category: "bucket",
      series: [
        { key: "open_issues", label: "Open", color: "var(--warning)" },
        { key: "high_severity", label: "High severity", color: "var(--destructive)" },
      ],
      caption: "Open data-quality issues by type.",
    },
    scopeNote: "Point-in-time. Pending imports and duplicates are workspace totals, repeated on each row.",
  },
  {
    slug: "content",
    title: "Customer-project content pipeline",
    question: "How many customer projects reach a usable asset, and where do they stall?",
    rpc: "report_content_pipeline",
    metricKey: "content",
    ranged: false,
    columns: [
      { key: "status", label: "Status", format: "tone" },
      { key: "opportunities", label: "Opportunities", format: "number" },
      { key: "permission_approved", label: "Permission approved", format: "number" },
      { key: "shoots_confirmed", label: "Shoots confirmed", format: "number" },
      { key: "shoots_completed", label: "Shoots completed", format: "number" },
      { key: "usable_assets", label: "Usable assets", format: "number" },
    ],
    chart: {
      kind: "bar",
      category: "status",
      series: [
        { key: "opportunities", label: "Opportunities", color: "var(--chart-1)" },
        { key: "permission_approved", label: "Permission approved", color: "var(--success)" },
      ],
      caption: "Content opportunities by status, and how many have customer permission.",
    },
    scopeNote: "Point-in-time. Permission is the current state of each project's permission record.",
  },
];

export function reportBySlug(slug: string): ReportDef | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

export const REPORT_SLUGS = REPORTS.map((r) => r.slug);

/** Tone mapping for the qualitative values these reports return. */
export const REPORT_TONE: Record<string, "neutral" | "success" | "warning" | "destructive" | "info" | "ai"> = {
  // reporting groups
  open: "info",
  won: "success",
  lost: "destructive",
  deferred: "neutral",
  // freshness
  fresh: "success",
  aging: "warning",
  stale: "destructive",
  unknown: "neutral",
  // content statuses
  nominated: "info",
  under_review: "info",
  needs_info: "warning",
  accepted: "success",
  scheduled: "ai",
  completed: "success",
  declined: "neutral",
  cancelled: "neutral",
};

/** Quality of a metric definition, as a tone. */
export const QUALITY_TONE: Record<string, "success" | "info" | "warning"> = {
  trusted: "success",
  monitored: "info",
  degraded: "warning",
};

export const PII_LABEL: Record<string, string> = {
  aggregate: "Aggregate only — no customer identifiers",
  masked: "Masked identifiers",
  personal: "Contains personal data",
};
