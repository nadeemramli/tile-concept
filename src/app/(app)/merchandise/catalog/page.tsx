import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { listProducts, getSuppliers, getCategoryAttributeRules } from "@/server/queries/catalog";
import { getBrands, getCategories, getSavedViews, getUnits } from "@/server/queries/reference";
import { CatalogTable } from "@/features/catalog/components/catalog-table";
import { NewProductButton } from "@/features/catalog/components/catalog-page-client";

export const metadata: Metadata = { title: "Catalog" };

const VIEW_KEYS: Record<string, string> = { Active: "active", "Missing price": "missing-price", Unreviewed: "unreviewed" };

export default async function CatalogPage({ searchParams }: PageProps<"/merchandise/catalog">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.read")) return <PermissionDenied permission="catalog.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = { view: str("view") ?? "active", category: str("category"), brand: str("brand"), status: str("status"), q: str("q") };

  const [rows, categories, brands, units, suppliers, savedViews, allRows] = await Promise.all([
    listProducts(filters),
    getCategories(),
    getBrands(),
    getUnits(),
    getSuppliers(),
    getSavedViews("catalog"),
    listProducts({ view: "all" }),
  ]);
  const rulesEntries = await Promise.all(categories.map(async (c) => [c.id, await getCategoryAttributeRules(c.id)] as const));
  const rulesByCategory = Object.fromEntries(rulesEntries);

  const views = [...savedViews.map((v) => ({ id: v.id, name: v.name, key: VIEW_KEYS[v.name] ?? v.name.toLowerCase().replace(/\s+/g, "-") })), { id: "all", name: "All", key: "all" }];
  const active = allRows.filter((r) => r.status === "active");
  const missingPrice = active.filter((r) => !r.price).length;
  const unreviewed = allRows.filter((r) => r.review_state === "unreviewed" && r.status !== "archived").length;
  const canWrite = hasPermission(session, "catalog.write");

  return (
    <PageBody>
      <PageHeader title="Catalog" description="Governed product knowledge: brand, code, name, category, dimensions, approved price, and provenance.">
        {canWrite && <NewProductButton refs={{ brands, suppliers, categories, units, rulesByCategory }} />}
      </PageHeader>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="Active products" value={active.length} info={{ definition: "Products with status active.", grain: "Product", source: "merch.products" }} />
        <MetricCard compact label="Missing approved price" value={missingPrice} tone={missingPrice ? "warning" : "neutral"} href="/merchandise/catalog?view=missing-price" info={{ definition: "Active products with no current price on any price list.", grain: "Product", source: "merch.variant_prices" }} />
        <MetricCard compact label="Unreviewed" value={unreviewed} tone={unreviewed ? "warning" : "neutral"} href="/merchandise/catalog?view=unreviewed" info={{ definition: "Products not yet reviewed by a catalog operator.", grain: "Product", source: "merch.products" }} />
        <MetricCard compact label="Stock sources" value="0" tone="neutral" href="/merchandise/stock" info={{ definition: "Connected inventory sources. Availability shows as Unknown until Phase 5.", grain: "Source", source: "stock.inventory_sources", caveat: "No stock source connected yet." }} />
      </div>
      <CatalogTable rows={rows} categories={categories} brands={brands} views={views} />
    </PageBody>
  );
}
