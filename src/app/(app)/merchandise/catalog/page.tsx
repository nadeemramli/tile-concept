import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { Button } from "@/components/ui/button";
import { getCatalogFacets, getCatalogSummary, getCategoryAttributeRules, getSuppliers, searchCatalog } from "@/server/queries/catalog";
import { getBrands, getCategories, getUnits } from "@/server/queries/reference";
import { CatalogTable } from "@/features/catalog/components/catalog-table";
import { NewProductButton } from "@/features/catalog/components/catalog-page-client";

export const metadata: Metadata = { title: "Product & Price Finder" };

const VIEWS = [
  { id: "ready", name: "Ready to quote", key: "ready" },
  { id: "active", name: "All active", key: "active" },
  { id: "missing-price", name: "Missing price", key: "missing-price" },
  { id: "unreviewed", name: "Unreviewed", key: "unreviewed" },
  { id: "all", name: "All", key: "all" },
];

export default async function CatalogPage({ searchParams }: PageProps<"/merchandise/catalog">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.read")) return <PermissionDenied permission="catalog.read" roleLabel={session.roleLabel} />;

  const sp = await searchParams;
  const str = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
  const parsedPage = Number(str("page") ?? "1");
  const filters = {
    view: str("view") ?? "ready",
    category: str("category"),
    brand: str("brand"),
    color: str("color"),
    finish: str("finish"),
    material: str("material"),
    q: str("q"),
    page: Number.isFinite(parsedPage) ? parsedPage : 1,
    pageSize: 100,
  };

  const [result, summary, facets, categories, brands, units, suppliers] = await Promise.all([
    searchCatalog(filters),
    getCatalogSummary(),
    getCatalogFacets(),
    getCategories(),
    getBrands(),
    getUnits(),
    getSuppliers(),
  ]);
  const rulesEntries = await Promise.all(categories.map(async (category) => [category.id, await getCategoryAttributeRules(category.id)] as const));
  const rulesByCategory = Object.fromEntries(rulesEntries);
  const canWrite = hasPermission(session, "catalog.write");

  return (
    <PageBody>
      <PageHeader title="Product & Price Finder" description="Find a sellable tile by name, code, brand, colour, finish or material, then see its current approved price immediately.">
        <Button asChild size="sm" variant="outline">
          <Link href="/merchandise/pricing">Manage price lists</Link>
        </Button>
        {canWrite && <NewProductButton refs={{ brands, suppliers, categories, units, rulesByCategory }} />}
      </PageHeader>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="Ready to quote" value={summary.ready} href="/merchandise/catalog?view=ready" info={{ definition: "Active products with a current reviewed price.", grain: "Product", source: "api.catalog_finder" }} />
        <MetricCard compact label="All active" value={summary.active} href="/merchandise/catalog?view=active" info={{ definition: "Products currently active in the catalog.", grain: "Product", source: "merch.products" }} />
        <MetricCard compact label="Missing price" value={summary.missing} tone={summary.missing ? "warning" : "neutral"} href="/merchandise/catalog?view=missing-price" info={{ definition: "Active products with no current reviewed price.", grain: "Product", source: "api.catalog_finder" }} />
        <MetricCard compact label="Unreviewed" value={summary.unreviewed} tone={summary.unreviewed ? "warning" : "neutral"} href="/merchandise/catalog?view=unreviewed" info={{ definition: "Non-archived products not yet reviewed by a catalog operator.", grain: "Product", source: "merch.products" }} />
      </div>
      <CatalogTable key={filters.q ?? ""} result={result} categories={categories} brands={brands} facets={facets} views={VIEWS} />
    </PageBody>
  );
}
