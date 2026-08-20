import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBrands, getCategories, getUnits } from "@/server/queries/reference";
import { getSuppliers } from "@/server/queries/catalog";
import { getSqlConnector, getStockCounts, getVariantOptions, listAvailability, listInHouseSnapshots, listItemMappings, listReconciliationCases, listStaleSuppliers } from "@/server/queries/stock";
import { StockClient, type StockTab } from "@/features/stock/components/stock-client";

export const metadata: Metadata = { title: "Stock" };

const TABS: StockTab[] = ["overview", "suppliers", "sql", "reconciliation"];

export default async function StockPage({ searchParams }: PageProps<"/merchandise/stock">) {
  const session = await requireSession();
  if (!hasPermission(session, "stock.read")) return <PermissionDenied permission="stock.read" roleLabel={session.roleLabel} />;

  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = (TABS.includes(str("tab") as StockTab) ? (str("tab") as StockTab) : "overview") as StockTab;
  const filters = {
    category: str("category"),
    brand: str("brand"),
    supplier: str("supplier"),
    sourceKind: str("sourceKind"),
    freshness: str("freshness"),
    availability: str("availability"),
    q: str("q"),
  };

  const supabase = await createServerSupabase();
  const [rows, allRows, stale, mappings, snapshots, cases, connector, categories, brands, suppliers, units, variants, { data: sources }] = await Promise.all([
    listAvailability(filters),
    listAvailability(),
    listStaleSuppliers(),
    listItemMappings(),
    listInHouseSnapshots(),
    listReconciliationCases(),
    getSqlConnector(),
    getCategories(),
    getBrands(),
    getSuppliers(),
    getUnits(),
    getVariantOptions(),
    supabase.from("inventory_sources").select("id, name"),
  ]);
  const counts = await getStockCounts(allRows);

  return (
    <PageBody>
      <PageHeader
        title="Stock"
        description="In-house stock mirrored read-only from SQL Account, alongside supplier availability that keeps its source, age and evidence. Nothing here overwrites the authority."
      />
      <StockClient
        tab={tab}
        rows={rows}
        counts={counts}
        stale={stale}
        mappings={mappings}
        snapshots={snapshots}
        cases={cases}
        connector={connector}
        categories={categories}
        brands={brands}
        suppliers={suppliers.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }))}
        units={units}
        sources={(sources ?? []).map((s) => ({ id: s.id!, name: s.name ?? "Source" }))}
        variants={variants.map((v) => ({ id: v.id, label: v.label, code: v.code, name: v.name }))}
      />
    </PageBody>
  );
}
