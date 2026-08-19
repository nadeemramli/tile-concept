import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { requireSession } from "@/server/session";
import { getCommandCentreSummary, getMyWork, getRecentActivity } from "@/server/queries/command-centre";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { MetricCard } from "@/components/patterns/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timeline, type TimelineItem } from "@/components/patterns/timeline";
import { StatusPill } from "@/components/patterns/status-pill";
import { TASK_PRIORITY } from "@/lib/domain/status-maps";
import { formatDateTime, formatMoney, formatRelative, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/patterns/states";

export default async function CommandCentrePage() {
  const session = await requireSession();
  const canSales = session.permissions.includes("sales.read");
  const [summary, work, activity] = await Promise.all([
    canSales ? getCommandCentreSummary() : Promise.resolve(null),
    canSales ? getMyWork(session.userId) : Promise.resolve({ tasks: [], opportunities: [] }),
    canSales ? getRecentActivity() : Promise.resolve([]),
  ]);

  const freshness = summary ? `Computed ${formatRelative(summary.generated_at)} from live tables` : "—";
  const scope = session.permissions.includes("sales.read_all") ? "All sales records" : "Your records";

  return (
    <PageBody>
      <PageHeader title="Command Centre" description={`Morning brief for ${session.fullName.split(" ")[0]} · ${scope} · ${session.workspaceName}`} />

      {!canSales && (
        <EmptyState
          title="No sales scope on this role"
          description="Your role does not include sales visibility. Use the navigation for the modules available to you."
        />
      )}

      {summary && (
        <>
          {/* Morning brief — exception first (PRD §2.2 #8, §7.1) */}
          <section className="space-y-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Morning brief · exceptions</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <MetricCard label="Aging leads" value={summary.aging_leads} tone={summary.aging_leads ? "warning" : "neutral"} href="/sales/inbox?view=aging" info={{ definition: "Leads still New or Contact attempted more than 2 days after creation.", grain: "Lead", source: "sales.leads", freshness }} />
              <MetricCard label="Overdue follow-ups" value={summary.overdue_followups} tone={summary.overdue_followups ? "destructive" : "neutral"} href="/sales/pipeline?view=overdue" info={{ definition: "Open opportunities whose next action due date has passed.", grain: "Opportunity", source: "sales.opportunities", freshness }} />
              <MetricCard label="Unassigned inquiries" value={summary.unassigned_leads} tone={summary.unassigned_leads ? "warning" : "neutral"} href="/sales/inbox?view=unassigned" info={{ definition: "Active leads with no owner.", grain: "Lead", source: "sales.leads", freshness }} />
              <MetricCard label="No first response" value={summary.no_response_leads} tone={summary.no_response_leads ? "warning" : "neutral"} href="/sales/inbox?view=no-response" info={{ definition: "New leads with no logged response attempt.", grain: "Lead", source: "sales.leads", freshness }} />
              <MetricCard label="Quotes expiring" value={summary.quotes_expiring} tone={summary.quotes_expiring ? "info" : "neutral"} href="/sales/pipeline?view=quotes" info={{ definition: "Issued quote versions whose validity ends within 7 days.", grain: "Quote version", source: "sales.quote_versions", freshness }} />
              <MetricCard label="Duplicate review" value={summary.duplicate_candidates} tone={summary.duplicate_candidates ? "info" : "neutral"} href="/sales/identity-review" info={{ definition: "Suggested identity matches awaiting a human decision. Never auto-merged.", grain: "Candidate pair", source: "identity.identity_match_candidates", freshness }} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Pipeline scorecard */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  Pipeline scorecard
                  <Link href="/sales/pipeline" className="text-xs font-normal text-info hover:underline">
                    Open pipeline <ArrowRight className="inline size-3" aria-hidden />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricCard compact label="Open opportunities" value={summary.open_opportunities} href="/sales/pipeline" info={{ definition: "Opportunities in an open reporting group.", grain: "Opportunity", source: "sales.opportunities", freshness }} />
                <MetricCard compact label="Open value" value={formatMoney(summary.open_value, session.currency)} info={{ definition: "Sum of estimated value on open opportunities. Unweighted; probability bands are not yet accepted by the business.", grain: "Opportunity", source: "sales.opportunities", freshness, caveat: "Estimates only — not a forecast." }} />
                <MetricCard compact label="Won (30d)" value={summary.won_30d} tone="success" href="/sales/pipeline?view=won" info={{ definition: "Opportunities moved to Won in the last 30 days.", grain: "Opportunity", source: "sales.opportunity_stage_events", freshness }} />
                <MetricCard compact label="Lost (30d)" value={summary.lost_30d} tone={summary.lost_30d ? "destructive" : "neutral"} href="/sales/pipeline?view=lost" info={{ definition: "Opportunities moved to Lost in the last 30 days.", grain: "Opportunity", source: "sales.opportunity_stage_events", freshness }} />
                <MetricCard compact label="Visits today" value={summary.visits_today} href="/sales/walk-ins" info={{ definition: "Walk-in visits recorded today (Asia/Kuala_Lumpur).", grain: "Visit", source: "sales.visits", freshness }} />
                <MetricCard compact label="Purchases (7d)" value={summary.purchases_7d} href="/sales/walk-ins?tab=purchases" info={{ definition: "Purchases recorded in the last 7 days (excluding voided).", grain: "Purchase", source: "sales.purchases", freshness }} />
                <MetricCard compact label="Purchase amount (7d)" value={formatMoney(summary.purchase_amount_7d, session.currency)} info={{ definition: "Sum of recorded purchase amounts in the last 7 days. Not reconciled with SQL Account.", grain: "Purchase", source: "sales.purchases", freshness, caveat: "App-recorded amounts; accounting remains in SQL Account." }} />
                <MetricCard compact label="Missing next action" value={summary.missing_next_action} tone={summary.missing_next_action ? "warning" : "neutral"} href="/sales/pipeline?view=missing-next-action" info={{ definition: "Open opportunities without a next action or due date.", grain: "Opportunity", source: "sales.opportunities", freshness }} />
              </CardContent>
            </Card>

            {/* My work */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  My work
                  <Link href="/sales/tasks" className="text-xs font-normal text-info hover:underline">
                    All tasks
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {work.tasks.length === 0 && work.opportunities.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned to you right now.</p>}
                {work.tasks.length > 0 && (
                  <ul className="space-y-1.5">
                    {work.tasks.slice(0, 6).map((t) => (
                      <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                        <Link href={`/sales/tasks?task=${t.id}`} className="min-w-0 flex-1 truncate hover:underline">
                          {t.title}
                        </Link>
                        <span className={cn("tnum shrink-0 text-[11px]", isOverdue(t.due_at) ? "text-destructive" : "text-muted-foreground")}>{t.due_at ? formatRelative(t.due_at) : "no due"}</span>
                        <StatusPill map={TASK_PRIORITY} value={t.priority} />
                      </li>
                    ))}
                  </ul>
                )}
                {work.opportunities.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next actions</div>
                    <ul className="space-y-1.5">
                      {work.opportunities.slice(0, 5).map((o) => (
                        <li key={o.id} className="text-sm">
                          <Link href={`/sales/pipeline?opportunity=${o.id}`} className="flex items-start justify-between gap-2 hover:underline">
                            <span className="min-w-0 flex-1 truncate">{o.next_action ?? "Set next action"}</span>
                            <span className={cn("tnum shrink-0 text-[11px]", isOverdue(o.next_action_due_at) ? "text-destructive" : "text-muted-foreground")}>{o.next_action_due_at ? formatRelative(o.next_action_due_at) : "—"}</span>
                          </Link>
                          <div className="truncate text-[11px] text-muted-foreground">{o.name}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Sales activity */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Sales activity</CardTitle>
              </CardHeader>
              <CardContent>
                <Timeline items={activity as unknown as TimelineItem[]} emptyText="No activity recorded yet." />
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* Merchandise trust */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Merchandise trust</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <MetricCard compact label="No price" value={summary.products_without_price} tone={summary.products_without_price ? "warning" : "neutral"} href="/merchandise/catalog?view=missing-price" info={{ definition: "Active products with no current approved price on any list.", grain: "Product", source: "merch", freshness }} />
                  <MetricCard compact label="Conflicts" value={summary.price_conflicts} tone={summary.price_conflicts ? "destructive" : "neutral"} href="/merchandise/pricing?state=conflicted" info={{ definition: "Prices blocked by an overlapping current price for the same scope.", grain: "Price", source: "merch.variant_prices", freshness }} />
                  <MetricCard compact label="Unreviewed" value={summary.unreviewed_products} tone={summary.unreviewed_products ? "warning" : "neutral"} href="/merchandise/catalog?view=unreviewed" info={{ definition: "Products whose attributes have not been reviewed by a catalog operator.", grain: "Product", source: "merch.products", freshness }} />
                </CardContent>
              </Card>

              {/* Content schedule placeholder + data health */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Data health</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <MetricCard compact label="Open issues" value={summary.open_data_issues} tone={summary.open_data_issues ? "warning" : "neutral"} href="/platform/data-health" info={{ definition: "Open data-quality issues: duplicates, unmapped units, stale snapshots, overlapping prices.", grain: "Issue", source: "ingest.data_quality_issues", freshness }} />
                    <MetricCard compact label="Reviews" value={summary.pending_reviews} href="/sources/review" info={{ definition: "Pending import/OCR review items.", grain: "Review item", source: "ingest.review_items", freshness }} />
                    <MetricCard compact label="Connectors" value={summary.connectors_failed} tone={summary.connectors_failed ? "destructive" : "neutral"} href="/platform/integrations" info={{ definition: "Connectors in failed or degraded state.", grain: "Connection", source: "ingest.integration_connections", freshness }} />
                  </div>
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Content schedule ({summary.content_opps_pending} nominations, {summary.shoots_next_7d} shoots in 7 days) and stock freshness appear here once Phase 2 and Phase 5 modules ship.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Every metric opens its contributing records. Definitions, grain, source and freshness are behind the ⓘ on each card. {summary && <>Last computed {formatDateTime(summary.generated_at)}.</>}</p>
        </>
      )}
    </PageBody>
  );
}
