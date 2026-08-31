"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsString, useQueryState, useQueryStates } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Columns2, ImageIcon, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { PRODUCT_STATUS, REVIEW_STATE } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CatalogFacets, CatalogRow, CatalogSearchResult } from "@/server/queries/catalog";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { cn } from "@/lib/utils";

interface Props {
  result: CatalogSearchResult;
  categories: { id: string; label: string }[];
  brands: { id: string; name: string }[];
  facets: CatalogFacets;
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

const serverParsers = {
  view: parseAsString.withDefault("ready"),
  category: parseAsString.withDefault(""),
  brand: parseAsString.withDefault(""),
  color: parseAsString.withDefault(""),
  finish: parseAsString.withDefault(""),
  material: parseAsString.withDefault(""),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
};
type ServerFilterUpdate = Partial<{
  view: string | null;
  category: string | null;
  brand: string | null;
  color: string | null;
  finish: string | null;
  material: string | null;
  q: string | null;
  page: number | null;
}>;


export function CatalogTable({ result, categories, brands, facets, views }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useQueryStates(serverParsers, { shallow: false, history: "push" });
  const [layout, setLayout] = useQueryState("layout", parseAsString.withDefault("table"));
  const [draftQuery, setDraftQuery] = useState(filters.q);
  const [pending, startTransition] = useTransition();

  const update = (next: ServerFilterUpdate) => {
    startTransition(() => {
      void setFilters(next);
    });
  };
  const setFilter = (key: "category" | "brand" | "color" | "finish" | "material", value: string) => update({ [key]: value || null, page: null });
  const hasFilters = Boolean(filters.category || filters.brand || filters.color || filters.finish || filters.material || filters.q);

  const columns = useMemo<ColumnDef<CatalogRow, unknown>[]>(
    () => [
      { accessorKey: "code", header: "Code", cell: ({ row }) => <MonoCell value={row.original.code} /> },
      {
        accessorKey: "name",
        header: "Product",
        cell: ({ row }) => (
          <div className="min-w-56">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-[11px] text-muted-foreground">{[row.original.brand, row.original.category].filter(Boolean).join(" · ") || "Uncategorised"}</div>
          </div>
        ),
      },
      { id: "look", header: "Colour / finish / material", cell: ({ row }) => [row.original.color, row.original.finish, row.original.material].filter(Boolean).join(" · ") || "—" },
      { accessorKey: "dimensions_label", header: "Size", cell: ({ row }) => <span className="tnum">{row.original.dimensions_label}</span> },
      { id: "price", header: "Current price", accessorFn: (row) => row.price?.amount ?? -1, cell: ({ row }) => <PriceCell price={row.original.price} /> },
      { accessorKey: "review_state", header: "Trust", cell: ({ row }) => <TrustCell row={row.original} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={PRODUCT_STATUS} value={row.original.status} /> },
    ],
    [],
  );

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ q: draftQuery.trim() || null, page: null });
  };
  const clear = () => {
    setDraftQuery("");
    update({ category: null, brand: null, color: null, finish: null, material: null, q: null, page: null });
  };

  const toolbar = (
    <div className="flex w-full flex-wrap items-center gap-2">
      <form onSubmit={search} className="flex min-w-64 flex-1 items-center gap-1 sm:max-w-md">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Search code, name, colour, finish…" className="h-8 pl-7 text-sm" aria-label="Search products" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Search</Button>
      </form>
      <div className="w-44">
        <SimpleSelect value={filters.brand} onChange={(value) => setFilter("brand", value)} options={brands.map((brand) => ({ value: brand.id, label: brand.name }))} noneLabel="All brands" placeholder="Brand" />
      </div>
      <div className="w-40">
        <SimpleSelect value={filters.color} onChange={(value) => setFilter("color", value)} options={facets.colors.map((item) => ({ value: item.value, label: `${item.label} (${item.count})` }))} noneLabel="All colours" placeholder="Colour" />
      </div>
      <div className="w-40">
        <SimpleSelect value={filters.finish} onChange={(value) => setFilter("finish", value)} options={facets.finishes.map((item) => ({ value: item.value, label: `${item.label} (${item.count})` }))} noneLabel="All finishes" placeholder="Finish" />
      </div>
      <div className="w-44">
        <SimpleSelect value={filters.category} onChange={(value) => setFilter("category", value)} options={categories.map((category) => ({ value: category.id, label: category.label }))} noneLabel="All categories" placeholder="Category" />
      </div>
      {facets.materials.length > 0 && (
        <div className="w-40">
          <SimpleSelect value={filters.material} onChange={(value) => setFilter("material", value)} options={facets.materials.map((item) => ({ value: item.value, label: `${item.label} (${item.count})` }))} noneLabel="All materials" placeholder="Material" />
        </div>
      )}
      {hasFilters && (
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={pending}>
          <X className="size-3.5" aria-hidden /> Clear
        </Button>
      )}
      <ToggleGroup type="single" value={layout} onValueChange={(value) => value && setLayout(value)} variant="outline" size="sm" aria-label="Layout">
        <ToggleGroupItem value="table" aria-label="Table"><Rows3 className="size-3.5" /></ToggleGroupItem>
        <ToggleGroupItem value="gallery" aria-label="Gallery"><LayoutGrid className="size-3.5" /></ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  const pagination = (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className="tnum text-xs text-muted-foreground">
        {result.total === 0 ? "0 products" : `Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-2">
        <span className="tnum text-xs text-muted-foreground">Page {result.page} of {result.pageCount}</span>
        <Button variant="outline" size="icon-sm" disabled={result.page <= 1 || pending} onClick={() => update({ page: result.page - 1 })} aria-label="Previous catalog page">
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={result.page >= result.pageCount || pending} onClick={() => update({ page: result.page + 1 })} aria-label="Next catalog page">
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className={cn("space-y-3", pending && "opacity-70")} aria-busy={pending || undefined}>
      <div className="flex flex-wrap items-center gap-1 border-b">
        {views.map((view) => (
          <button
            key={view.key}
            type="button"
            onClick={() => update({ view: view.key, page: null })}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", filters.view === view.key ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {view.name}
          </button>
        ))}
      </div>
      {toolbar}

      {layout === "gallery" ? (
        result.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">No products match the current filters.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {result.rows.map((row) => (
              <Link key={row.id} href={`/merchandise/catalog/${row.id}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full gap-2 p-3 transition-colors hover:bg-accent/40">
                  <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-6" aria-hidden /></div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{row.code ?? "—"}</div>
                    <div className="truncate text-sm font-medium">{row.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{[row.brand, row.color, row.finish].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2"><PriceCell price={row.price} /><StatusPill map={REVIEW_STATE} value={row.review_state} /></div>
                </Card>
              </Link>
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={result.rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/merchandise/catalog/${row.id}`)}
          columnToggle
          selectable
          bulkActions={(selected) => (
            <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs" disabled={selected.length < 2 || selected.length > 4} onClick={() => router.push(`/merchandise/catalog/compare?ids=${selected.map((row) => row.id).join(",")}`)}>
              <Columns2 className="size-3" aria-hidden /> Compare {selected.length > 4 ? "(max 4)" : ""}
            </Button>
          )}
          emptyTitle="No products"
          emptyDescription="No products match this search. Clear filters or switch to All active."
          pageSize={result.pageSize}
        />
      )}
      {pagination}
    </div>
  );
}
