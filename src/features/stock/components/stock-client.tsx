"use client";

import { useQueryState } from "nuqs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard } from "@/components/patterns/metric-card";
import { OverviewTab } from "@/features/stock/components/overview-tab";
import { SuppliersTab } from "@/features/stock/components/suppliers-tab";
import { SqlTab } from "@/features/stock/components/sql-tab";
import { ReconciliationTab } from "@/features/stock/components/reconciliation-tab";
import type { VariantOption } from "@/features/stock/components/variant-combobox";
import type { AvailabilityRow, InHouseSnapshotRow, MappingRow, ReconciliationRow, SqlConnector, StaleSupplierRow, StockCounts } from "@/server/queries/stock";

export type StockTab = "overview" | "suppliers" | "sql" | "reconciliation";

interface Props {
  tab: StockTab;
  rows: AvailabilityRow[];
  counts: StockCounts;
  stale: StaleSupplierRow[];
  mappings: MappingRow[];
  snapshots: InHouseSnapshotRow[];
  cases: ReconciliationRow[];
  connector: SqlConnector | null;
  categories: { id: string; label: string }[];
  brands: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  units: { id: string; code: string; label: string }[];
  sources: { id: string; name: string }[];
  variants: VariantOption[];
}

export function StockClient({ tab, rows, counts, stale, mappings, snapshots, cases, connector, categories, brands, suppliers, units, sources, variants }: Props) {
  const [, setTab] = useQueryState("tab");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          compact
          label="Stale suppliers"
          value={counts.staleSuppliers}
          tone={counts.staleSuppliers ? "warning" : "neutral"}
          info={{ definition: "Active suppliers whose latest snapshot is older than their freshness policy, or who have never sent one.", grain: "Supplier", source: "stock.supplier_availability_snapshots" }}
        />
        <MetricCard
          compact
          label="Unmapped item codes"
          value={counts.unmapped}
          tone={counts.unmapped ? "warning" : "neutral"}
          info={{ definition: "Codes delivered by an inventory source that are not yet matched to a product variant. Their snapshots arrive but cannot reach a product.", grain: "Item code", source: "stock.inventory_item_mappings" }}
        />
        <MetricCard
          compact
          label="Open reconciliation"
          value={counts.openCases}
          tone={counts.openCases ? "warning" : "neutral"}
          info={{ definition: "Recorded disagreements between a source figure and an observed count. The app records them; it never overwrites the source.", grain: "Case", source: "stock.stock_reconciliation_cases" }}
        />
        <MetricCard
          compact
          label="No availability"
          value={counts.noAvailability}
          tone={counts.noAvailability ? "warning" : "neutral"}
          info={{ definition: "Active products with no in-house snapshot and no supplier update at all — unknown, which is not the same as out of stock.", grain: "Product", source: "api.stock_availability" }}
        />
        <MetricCard
          compact
          label="Out of stock"
          value={counts.outLines}
          tone={counts.outLines ? "destructive" : "neutral"}
          info={{ definition: "Lines confirmed as out of stock, as at the date each was recorded.", grain: "Product × source", source: "api.stock_availability", caveat: "Confirmed on the date shown — check the freshness badge before promising anything." }}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v === "overview" ? null : v)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier updates</TabsTrigger>
          <TabsTrigger value="sql">SQL Account</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "overview" && <OverviewTab rows={rows} categories={categories} brands={brands} suppliers={suppliers} />}
      {tab === "suppliers" && <SuppliersTab stale={stale} suppliers={suppliers} variants={variants} units={units} />}
      {tab === "sql" && <SqlTab connector={connector} mappings={mappings} snapshots={snapshots} variants={variants} />}
      {tab === "reconciliation" && <ReconciliationTab cases={cases} sources={sources} variants={variants} />}
    </div>
  );
}
