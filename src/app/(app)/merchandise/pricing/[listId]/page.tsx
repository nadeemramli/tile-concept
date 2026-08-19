import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { FactList } from "@/components/patterns/record-drawer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPriceList, listPrices } from "@/server/queries/pricing";
import { getSuppliers } from "@/server/queries/catalog";
import { getBrands, getCategories, getUnits } from "@/server/queries/reference";
import { createServerSupabase } from "@/lib/supabase/server";
import { PriceTable } from "@/features/pricing/components/price-table";
import { AddPriceDialog } from "@/features/pricing/components/add-price-dialog";
import { PriceListFormDialog } from "@/features/pricing/components/price-list-form-dialog";
import { Pencil } from "lucide-react";

export const metadata: Metadata = { title: "Price list" };
const STATES = ["draft", "scheduled", "current", "superseded", "expired", "conflicted"];

export default async function PriceListPage({ params, searchParams }: PageProps<"/merchandise/pricing/[listId]">) {
  const session = await requireSession();
  if (!hasPermission(session, "price.read")) return <PermissionDenied permission="price.read" roleLabel={session.roleLabel} />;
  const { listId } = await params;
  const sp = await searchParams;
  const state = typeof sp.state === "string" && STATES.includes(sp.state) ? sp.state : undefined;
  const list = await getPriceList(listId);
  if (!list) notFound();
  const canPublish = hasPermission(session, "price.publish");
  const supabase = await createServerSupabase();
  const [prices, suppliers, brands, categories, units, { data: variants }] = await Promise.all([
    listPrices({ listId, state }),
    getSuppliers(),
    getBrands(),
    getCategories(),
    getUnits(),
    supabase.from("product_variants").select("id, sku, name, product_id").eq("status", "active").limit(1000),
  ]);
  const { data: products } = await supabase.from("products").select("id, name, code").neq("status", "archived").limit(1000);
  const pMap = new Map((products ?? []).map((p) => [p.id!, p]));
  const variantOpts = (variants ?? [])
    .map((v) => ({ id: v.id!, label: `${pMap.get(v.product_id!)?.code ?? v.sku ?? "—"} · ${pMap.get(v.product_id!)?.name ?? ""}${v.name && v.name !== "Standard" ? ` (${v.name})` : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <PageBody>
      <PageHeader eyebrow={<Link href="/merchandise/pricing" className="hover:underline">Pricing</Link>} title={list.name} description={`${list.price_type} · ${list.currency}${list.tax_inclusive ? " incl. tax" : ""} · ${[list.supplier, list.brand, list.category].filter(Boolean).join(" · ") || "all products"}`}>
        {canPublish && (
          <>
            <PriceListFormDialog
              listId={list.id}
              refs={{ suppliers, brands, categories }}
              initial={{ name: list.name, price_type: list.price_type as "retail", currency: list.currency, market: list.market ?? "", tax_inclusive: list.tax_inclusive, status: list.status as "active", source_ref: list.source_ref ?? "" }}
              trigger={
                <Button size="sm" variant="outline" className="h-8 gap-1.5">
                  <Pencil className="size-3.5" aria-hidden /> Edit list
                </Button>
              }
            />
            <AddPriceDialog variants={variantOpts} priceLists={[{ id: list.id, name: list.name, price_type: list.price_type, currency: list.currency }]} units={units} defaultListId={list.id} />
          </>
        )}
      </PageHeader>
      <Card className="px-4 py-3">
        <FactList
          items={[
            { label: "Current", value: list.counts.current },
            { label: "Draft / scheduled", value: list.counts.draft + list.counts.scheduled },
            { label: "Conflicted", value: list.counts.conflicted },
            { label: "Superseded / expired", value: list.counts.superseded + list.counts.expired },
            { label: "Owner", value: list.owner_name ?? "—" },
            { label: "Source", value: list.source_ref ?? "—" },
          ]}
          className="sm:grid-cols-3 lg:grid-cols-6"
        />
      </Card>
      <div className="flex flex-wrap gap-1">
        <Button asChild size="sm" variant={!state ? "default" : "outline"} className="h-7 text-xs">
          <Link href={`/merchandise/pricing/${list.id}`}>All</Link>
        </Button>
        {STATES.map((s) => (
          <Button key={s} asChild size="sm" variant={s === state ? "default" : "outline"} className="h-7 text-xs capitalize">
            <Link href={`/merchandise/pricing/${list.id}?state=${s}`}>{s}</Link>
          </Button>
        ))}
      </div>
      <PriceTable rows={prices} canPublish={canPublish} listId={list.id} showList={false} />
    </PageBody>
  );
}
