import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { listPriceLists, listPrices } from "@/server/queries/pricing";
import { getSuppliers } from "@/server/queries/catalog";
import { getBrands, getCategories } from "@/server/queries/reference";
import { PriceListsTable } from "@/features/pricing/components/price-lists-table";
import { PriceListFormDialog } from "@/features/pricing/components/price-list-form-dialog";
import { PriceTable } from "@/features/pricing/components/price-table";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pricing" };

const STATES = ["draft", "scheduled", "current", "superseded", "expired", "conflicted"];

export default async function PricingPage({ searchParams }: PageProps<"/merchandise/pricing">) {
  const session = await requireSession();
  if (!hasPermission(session, "price.read")) return <PermissionDenied permission="price.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const state = typeof sp.state === "string" && STATES.includes(sp.state) ? sp.state : undefined;
  const canPublish = hasPermission(session, "price.publish");

  const [lists, suppliers, brands, categories, attention] = await Promise.all([listPriceLists(), getSuppliers(), getBrands(), getCategories(), state ? listPrices({ state }) : listPrices({ state: "conflicted" })]);
  const totals = lists.reduce((a, l) => ({ current: a.current + l.counts.current, draft: a.draft + l.counts.draft + l.counts.scheduled, conflicted: a.conflicted + l.counts.conflicted }), { current: 0, draft: 0, conflicted: 0 });

  return (
    <PageBody>
      <PageHeader title="Pricing" description="Price is a versioned fact with a list, scope, basis, effective dates, source and approval — never a mutable field on a product.">
        {canPublish && <PriceListFormDialog refs={{ suppliers, brands, categories }} />}
      </PageHeader>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="Price lists" value={lists.length} info={{ definition: "All price lists regardless of status.", grain: "Price list", source: "merch.price_lists" }} />
        <MetricCard compact label="Current prices" value={totals.current} tone="success" info={{ definition: "Prices in state current across all lists.", grain: "Price", source: "merch.variant_prices" }} />
        <MetricCard compact label="Awaiting publish" value={totals.draft} tone={totals.draft ? "info" : "neutral"} href="/merchandise/pricing?state=draft" info={{ definition: "Draft or scheduled prices not yet in force.", grain: "Price", source: "merch.variant_prices" }} />
        <MetricCard compact label="Conflicts" value={totals.conflicted} tone={totals.conflicted ? "destructive" : "neutral"} href="/merchandise/pricing?state=conflicted" info={{ definition: "Prices blocked by an overlapping current/scheduled price for the same exact scope. Resolve with an audited override or edit the dates.", grain: "Price", source: "merch.variant_prices" }} />
      </div>

      {state ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Prices needing attention · <span className="capitalize">{state}</span>
            </h2>
            <div className="flex flex-wrap gap-1">
              {STATES.map((s) => (
                <Button key={s} asChild size="sm" variant={s === state ? "default" : "outline"} className="h-7 text-xs capitalize">
                  <Link href={`/merchandise/pricing?state=${s}`}>{s}</Link>
                </Button>
              ))}
              <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                <Link href="/merchandise/pricing">Lists</Link>
              </Button>
            </div>
          </div>
          <PriceTable rows={attention} canPublish={canPublish} />
        </section>
      ) : (
        <>
          <PriceListsTable rows={lists} />
          {attention.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-destructive">Conflicted prices ({attention.length})</h2>
              <PriceTable rows={attention} canPublish={canPublish} />
            </section>
          )}
        </>
      )}
    </PageBody>
  );
}
