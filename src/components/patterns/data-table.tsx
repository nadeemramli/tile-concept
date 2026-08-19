"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/patterns/states";

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; href: string };
  pageSize?: number;
  rowKey?: (row: T) => string;
  dense?: boolean;
  loading?: boolean;
  /** Show a quick keyboard-searchable filter box over all columns. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Enable the column visibility menu. */
  columnToggle?: boolean;
  /** Enable bulk selection; receives selected rows. */
  selectable?: boolean;
  bulkActions?: (rows: T[]) => React.ReactNode;
  toolbar?: React.ReactNode;
  initialSorting?: SortingState;
  isRowActive?: (row: T) => boolean;
  footer?: React.ReactNode;
}

const SKELETON_CELL_WIDTHS = ["w-3/4", "w-1/2", "w-full"];

/**
 * Shared operational table contract (PRD §12.2): sorting, quick filter, column
 * visibility, bulk selection with preview, keyboard row activation, dense rows,
 * sticky header, loading/empty states.
 */
export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyTitle = "Nothing here",
  emptyDescription = "No rows match the current filters.",
  emptyAction,
  pageSize = 25,
  rowKey,
  dense = true,
  loading = false,
  searchable = false,
  searchPlaceholder = "Filter rows…",
  columnToggle = false,
  selectable = false,
  bulkActions,
  toolbar,
  initialSorting = [],
  isRowActive,
  footer,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all rows on this page"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
        />
      ),
      size: 32,
    };
    return [select, ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId: rowKey ? (row) => rowKey(row) : undefined,
    globalFilterFn: "includesString",
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);

  const header = (
    <TableHeader className="sticky top-0 z-10 bg-card">
      {table.getHeaderGroups().map((hg) => (
        <TableRow key={hg.id} className="hover:bg-transparent">
          {hg.headers.map((h) => {
            const sortable = h.column.getCanSort();
            const sorted = h.column.getIsSorted();
            return (
              <TableHead key={h.id} className="h-9 whitespace-nowrap text-xs" style={h.column.columnDef.size ? { width: h.column.columnDef.size } : undefined}>
                {h.isPlaceholder ? null : sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted === "asc" && <ChevronUp className="size-3" aria-hidden />}
                    {sorted === "desc" && <ChevronDown className="size-3" aria-hidden />}
                  </button>
                ) : (
                  flexRender(h.column.columnDef.header, h.getContext())
                )}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );

  const controls =
    searchable || columnToggle || toolbar || (selectable && selectedRows.length > 0) ? (
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-56 pl-7 text-sm"
              aria-label="Filter rows"
            />
          </div>
        )}
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {selectable && selectedRows.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border bg-accent/40 px-2 py-1 text-xs">
              <span className="tnum font-medium">{selectedRows.length} selected</span>
              {bulkActions?.(selectedRows)}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setRowSelection({})}>
                Clear
              </Button>
            </div>
          )}
          {columnToggle && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <Columns3 className="size-3.5" aria-hidden /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide())
                  .map((c) => (
                    <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}>
                      {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    ) : null;

  if (data.length === 0) {
    if (loading) {
      return (
        <div className="space-y-2">
          {controls}
          <div className="overflow-x-auto rounded-lg border" role="status" aria-busy aria-label="Loading rows">
            <Table>
              {header}
              <TableBody>
                {Array.from({ length: Math.min(pageSize, 8) }).map((_, r) => (
                  <TableRow key={r} className="hover:bg-transparent">
                    {allColumns.map((_, c) => (
                      <TableCell key={c} className={cn("whitespace-nowrap", dense ? "py-1.5" : "py-2.5")}>
                        <Skeleton className={cn("h-4 animate-skeleton", SKELETON_CELL_WIDTHS[(r + c) % SKELETON_CELL_WIDTHS.length])} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {controls}
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className={cn("space-y-2", loading && "pointer-events-none opacity-60")} aria-busy={loading || undefined}>
      {controls}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          {header}
          <TableBody>
            {table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="py-8 text-center text-sm text-muted-foreground">
                  No rows match “{globalFilter}”.
                </TableCell>
              </TableRow>
            )}
            {table.getRowModel().rows.map((row) => {
              const active = isRowActive?.(row.original);
              return (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(onRowClick && "cursor-pointer", active && "bg-accent/60")}
                  onClick={() => onRowClick?.(row.original)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onRowClick && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      onRowClick(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn("whitespace-nowrap", dense ? "py-1.5 text-[13px]" : "py-2.5 text-sm")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="tnum text-xs text-muted-foreground">
          {filteredCount.toLocaleString()} rows
          {pageCount > 1 && ` · page ${pageIndex + 1} of ${pageCount}`}
        </span>
        <div className="flex items-center gap-2">
          {footer}
          {pageCount > 1 && (
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="size-7" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} aria-label="Previous page">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="size-7" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} aria-label="Next page">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MoneyCell({ value, currency = "MYR", className }: { value: number | string | null | undefined; currency?: string; className?: string }) {
  const n = value === null || value === undefined || value === "" ? null : Number(value);
  return <span className={cn("tnum", className)}>{n === null || Number.isNaN(n) ? "—" : new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(n)}</span>;
}

export function MonoCell({ value, className }: { value: string | number | null | undefined; className?: string }) {
  return <span className={cn("font-mono text-[12px] tnum", className)}>{value ?? "—"}</span>;
}
