"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Columns2, ImageIcon, LayoutGrid, Rows3 } from "lucide-react";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { PRODUCT_STATUS, REVIEW_STATE } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CatalogRow } from "@/server/queries/catalog";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { cn } from "@/lib/utils";

interface Props {
  rows: CatalogRow[];
  categories: { id: string; label: string }[];
  brands: { id: string; name: string }[];
  views: { id: string; name: string; key: string }[];
}

export function PriceCell({ price }: { price: CatalogRow["price"] }) {
  if (!price) return <TonePill tone="warning" label="No approved price" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tnum inline-flex items-baseline gap-1">
          <span className="font-medium">{formatMoney(price.amount, price.currency)}</span>
          {price.unit_code && <span className="text-[11px] text-muted-foreground">/ {price.unit_code}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {price.price_list_name} · {price.price_type} · valid from {price.valid_from}
      </TooltipContent>
    </Tooltip>
  );
}

export function TrustCell({ row }: { row: CatalogRow }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          <StatusPill map={REVIEW_STATE} value={row.review_state} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <div className="space-y-0.5 text-xs">
          <div>Source: {row.source_ref ?? "not recorded"}</div>
          <div>Reviewed: {row.reviewed_by_name ? `${row.reviewed_by_name} · ${formatDateTime(row.reviewed_at)}` : "not yet"}</div>
          {row.confidence != null && <div>Confidence: {Math.round(Number(row.confidence) * 100)}%</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function CatalogTable({ rows, categories, brands, views }: Props) {
  const router = useRouter();
  const [view, setView] = useQueryState("view", parseAsString.withDefault("active"));
  const [layout, setLayout] = useQueryState("layout", parseAsString.withDefault("table"));
  const [category, setCategory] = useQueryState("category", parseAsString.withDefault(""));
  const [brand, setBrand] = useQueryState("brand", parseAsString.withDefault(""));
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));

  const columns = useMemo<ColumnDef<CatalogRow, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: ({ row }) => <MonoCell value={row.original.code} /> },
      { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "brand", header: "Brand", cell: ({ row }) => row.original.brand ?? "—" },
      { accessorKey: "category", header: "Category", cell: ({ row }) => row.original.category ?? "—" },
      { id: "look", header: "Colour / finish / material", cell: ({ row }) => [row.original.color, row.original.finish, row.original.material].filter(Boolean).join(" · ") || "—" },
      { accessorKey: "dimensions_label", header: "Dimensions", cell: ({ row }) => <span className="tnum">{row.original.dimensions_label}</span> },
      { id: "price", header: "Current price", accessorFn: (r) => r.price?.amount ?? -1, cell: ({ row }) => <PriceCell price={row.original.price} /> },
      { id: "availability", header: "Availability", enableSorting: false, cell: () => <TonePill tone="neutral" label="Unknown · no stock source" /> },
      { accessorKey: "review_state", header: "Trust", cell: ({ row }) => <TrustCell row={row.original} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={PRODUCT_STATUS} value={row.original.status} /> },
    ],
    [],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44">
        <SimpleSelect value={category} onChange={(v) => setCategory(v || null)} options={categories.map((c) => ({ value: c.id, label: c.label }))} noneLabel="All categories" placeholder="Category" />
      </div>
      <div className="w-40">
        <SimpleSelect value={brand} onChange={(v) => setBrand(v || null)} options={brands.map((b) => ({ value: b.id, label: b.name }))} noneLabel="All brands" placeholder="Brand" />
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value || null)} placeholder="Search name, code, alias…" className="h-8 w-56 text-sm" aria-label="Search catalog" />
      <ToggleGroup type="single" value={layout} onValueChange={(v) => v && setLayout(v)} variant="outline" size="sm" aria-label="Layout">
        <ToggleGroupItem value="table" aria-label="Table">
          <Rows3 className="size-3.5" />
        </ToggleGroupItem>
        <ToggleGroupItem value="gallery" aria-label="Gallery">
          <LayoutGrid className="size-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 border-b">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", view === v.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {v.name}
          </button>
        ))}
      </div>

      {layout === "gallery" ? (
        <div className="space-y-3">
          {toolbar}
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No products match the current filters.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {rows.map((r) => (
                <Link key={r.id} href={`/merchandise/catalog/${r.id}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card className="h-full gap-2 p-3 transition-colors hover:bg-accent/40">
                    <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <ImageIcon className="size-6" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{r.code ?? "—"}</div>
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[r.brand, r.category].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <PriceCell price={r.price} />
                      <StatusPill map={REVIEW_STATE} value={r.review_state} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/merchandise/catalog/${r.id}`)}
          toolbar={toolbar}
          columnToggle
          selectable
          bulkActions={(selected) => (
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" disabled={selected.length < 2 || selected.length > 4} onClick={() => router.push(`/merchandise/catalog/compare?ids=${selected.map((s) => s.id).join(",")}`)}>
              <Columns2 className="size-3" aria-hidden /> Compare {selected.length > 4 ? "(max 4)" : ""}
            </Button>
          )}
          emptyTitle="No products"
          emptyDescription="No products match the current view and filters."
          pageSize={50}
        />
      )}
    </div>
  );
}
