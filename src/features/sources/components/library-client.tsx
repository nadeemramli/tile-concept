"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ASSET_KIND, ASSET_STATUS, formatBytes } from "@/features/sources/status-maps";
import type { SourceAssetDetail, SourceAssetRow } from "@/server/queries/sources";
import { AssetDrawer } from "@/features/sources/components/asset-drawer";
import { UploadDialog } from "@/features/sources/components/upload-dialog";

interface Props {
  rows: SourceAssetRow[];
  detail: SourceAssetDetail | null;
  suppliers: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  supplierNames: string[];
  canWrite: boolean;
}

export function LibraryClient({ rows, detail, suppliers, brands, supplierNames, canWrite }: Props) {
  const router = useRouter();
  const [kind, setKind] = useQueryState("kind", parseAsString.withDefault(""));
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString.withDefault(""));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault(""));
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [asset, setAsset] = useQueryState("asset", parseAsString);
  const [isNew, setIsNew] = useQueryState("new", parseAsString);

  const columns = useMemo<ColumnDef<SourceAssetRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Document", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { accessorKey: "kind", header: "Kind", cell: ({ row }) => <StatusPill map={ASSET_KIND} value={row.original.kind} /> },
      { accessorKey: "supplier_name", header: "Supplier", cell: ({ row }) => row.original.supplier_name ?? "—" },
      { accessorKey: "brand_name", header: "Brand", cell: ({ row }) => row.original.brand_name ?? "—" },
      { accessorKey: "version_no", header: "Version", cell: ({ row }) => <MonoCell value={row.original.version_no ? `v${row.original.version_no}` : "—"} /> },
      { accessorKey: "size_bytes", header: "Size", cell: ({ row }) => <span className="tnum">{formatBytes(row.original.size_bytes)}</span> },
      { accessorKey: "page_count", header: "Pages", cell: ({ row }) => <span className="tnum">{row.original.page_count ?? "—"}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={ASSET_STATUS} value={row.original.status} /> },
      {
        accessorKey: "pending_reviews",
        header: "To review",
        cell: ({ row }) => (row.original.pending_reviews > 0 ? <TonePill tone="warning" label={String(row.original.pending_reviews)} /> : <span className="text-muted-foreground">—</span>),
      },
      { accessorKey: "received_at", header: "Received", cell: ({ row }) => <span title={formatDateTime(row.original.received_at)}>{row.original.received_at ? formatRelative(row.original.received_at) : "—"}</span> },
      {
        accessorKey: "last_processed_at",
        header: "Last parsed",
        cell: ({ row }) => <span title={formatDateTime(row.original.last_processed_at)}>{row.original.last_processed_at ? formatRelative(row.original.last_processed_at) : "never"}</span>,
      },
      { accessorKey: "uploaded_by_name", header: "Uploaded by", cell: ({ row }) => row.original.uploaded_by_name ?? "—" },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        columnToggle
        onRowClick={(r) => setAsset(r.id)}
        isRowActive={(r) => r.id === asset}
        emptyTitle="No source documents"
        emptyDescription="Upload a supplier price list, catalogue extract or stock note to stage it for review."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value || null)} placeholder="Search documents…" className="h-8 w-52 pl-7 text-sm" aria-label="Search source documents" />
            </div>
            <SimpleSelect
              value={kind}
              onChange={(v) => setKind(v || null)}
              options={Object.entries(ASSET_KIND).map(([value, meta]) => ({ value, label: meta.label }))}
              placeholder="Any kind"
              noneLabel="Any kind"
              className="h-8 w-32 text-sm"
            />
            <SimpleSelect
              value={supplier}
              onChange={(v) => setSupplier(v || null)}
              options={supplierNames.map((s) => ({ value: s, label: s }))}
              placeholder="Any supplier"
              noneLabel="Any supplier"
              className="h-8 w-44 text-sm"
            />
            <SimpleSelect
              value={status}
              onChange={(v) => setStatus(v || null)}
              options={Object.entries(ASSET_STATUS).map(([value, meta]) => ({ value, label: meta.label }))}
              placeholder="Any status"
              noneLabel="Any status"
              className="h-8 w-40 text-sm"
            />
          </div>
        }
      />

      <AssetDrawer
        detail={detail}
        canWrite={canWrite}
        onClose={() => {
          setAsset(null);
          router.refresh();
        }}
      />

      <UploadDialog open={isNew === "1"} onOpenChange={(o) => setIsNew(o ? "1" : null)} suppliers={suppliers} brands={brands} />
    </>
  );
}
