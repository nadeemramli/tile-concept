"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, History } from "lucide-react";
import { DataTable, MoneyCell, MonoCell } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { PRICE_STATE, REVIEW_STATE } from "@/lib/domain/status-maps";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { PriceRow } from "@/server/queries/pricing";
import { previewPriceAction, publishPriceAction, rejectPriceAction, updateDraftPriceAction } from "@/server/commands/pricing";
import { useAction } from "@/features/catalog/use-action";
import { cn } from "@/lib/utils";

interface Props {
  rows: PriceRow[];
  canPublish: boolean;
  productId?: string | null;
  listId?: string | null;
  showProduct?: boolean;
  showList?: boolean;
}

type Preview = NonNullable<Extract<Awaited<ReturnType<typeof previewPriceAction>>, { ok: true }>["data"]>;

export function PriceTable({ rows, canPublish, productId, listId, showProduct = true, showList = true }: Props) {
  const [publishFor, setPublishFor] = useState<PriceRow | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [needOverride, setNeedOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [rejectFor, setRejectFor] = useState<PriceRow | null>(null);
  const [historyFor, setHistoryFor] = useState<PriceRow | null>(null);
  const [editFor, setEditFor] = useState<PriceRow | null>(null);
  const [edit, setEdit] = useState({ amount: "", valid_from: "", valid_to: "", min_quantity: "1", source_ref: "", notes: "" });

  const loadPreview = useAction(previewPriceAction, { silent: true, refresh: false, onSuccess: (d) => setPreview(d) });
  const publish = useAction(publishPriceAction, {
    onSuccess: () => {
      setPublishFor(null);
      setNeedOverride(false);
      setReason("");
    },
  });
  const reject = useAction(rejectPriceAction, { onSuccess: () => setRejectFor(null) });
  const update = useAction(updateDraftPriceAction, { onSuccess: () => setEditFor(null) });

  const openPublish = (r: PriceRow) => {
    setPublishFor(r);
    setPreview(null);
    setNeedOverride(r.state === "conflicted");
    setReason("");
    void loadPreview.run(r.id);
  };
  const openHistory = (r: PriceRow) => {
    setHistoryFor(r);
    setPreview(null);
    void loadPreview.run(r.id);
  };

  const columns = useMemo<ColumnDef<PriceRow, unknown>[]>(() => {
    const cols: ColumnDef<PriceRow, unknown>[] = [];
    if (showProduct) {
      cols.push(
        { accessorKey: "product_code", header: "Code", cell: ({ row }) => <MonoCell value={row.original.product_code ?? row.original.sku} /> },
        {
          accessorKey: "product_name",
          header: "Product",
          cell: ({ row }) =>
            row.original.product_id ? (
              <Link href={`/merchandise/catalog/${row.original.product_id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                {row.original.product_name}
              </Link>
            ) : (
              row.original.product_name
            ),
        },
        { accessorKey: "brand", header: "Brand", cell: ({ row }) => row.original.brand ?? "—" },
      );
    } else {
      cols.push({ accessorKey: "sku", header: "Variant", cell: ({ row }) => <MonoCell value={row.original.sku} /> });
    }
    if (showList) cols.push({ accessorKey: "price_list_name", header: "Price list", cell: ({ row }) => `${row.original.price_list_name} · ${row.original.price_type}` });
    cols.push(
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <MoneyCell value={row.original.amount} currency={row.original.currency} className="font-medium" /> },
      { accessorKey: "unit_code", header: "Basis", cell: ({ row }) => <span className="tnum">{row.original.unit_code ? `per ${row.original.unit_code}` : "—"}{row.original.min_quantity > 1 ? ` · min ${row.original.min_quantity}` : ""}</span> },
      { accessorKey: "valid_from", header: "Valid from", cell: ({ row }) => <span className="tnum">{formatDate(row.original.valid_from)}</span> },
      { accessorKey: "valid_to", header: "Valid to", cell: ({ row }) => <span className="tnum">{row.original.valid_to ? formatDate(row.original.valid_to) : "open"}</span> },
      { accessorKey: "state", header: "State", cell: ({ row }) => <StatusPill map={PRICE_STATE} value={row.original.state} /> },
      { accessorKey: "review_state", header: "Review", cell: ({ row }) => <StatusPill map={REVIEW_STATE} value={row.original.review_state} /> },
      { accessorKey: "source_ref", header: "Source", cell: ({ row }) => <span className="max-w-48 truncate text-muted-foreground" title={row.original.source_ref ?? ""}>{row.original.source_ref ?? "—"}</span> },
      { id: "approved", header: "Approved", cell: ({ row }) => (row.original.approved_by_name ? <span className="text-xs text-muted-foreground">{row.original.approved_by_name} · {formatDate(row.original.approved_at)}</span> : "—") },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const publishable = ["draft", "scheduled", "conflicted"].includes(r.state) && r.review_state !== "rejected";
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {canPublish && publishable && (
                <Button size="sm" variant={r.state === "conflicted" ? "destructive" : "default"} className="h-6 px-2 text-xs" onClick={() => openPublish(r)}>
                  {r.state === "conflicted" ? "Resolve" : "Publish"}
                </Button>
              )}
              {canPublish && r.state === "draft" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setEditFor(r);
                    setEdit({ amount: String(r.amount), valid_from: r.valid_from, valid_to: r.valid_to ?? "", min_quantity: String(r.min_quantity), source_ref: r.source_ref ?? "", notes: r.notes ?? "" });
                  }}
                >
                  Edit
                </Button>
              )}
              {canPublish && publishable && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setRejectFor(r)}>
                  Reject
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => openHistory(r)} aria-label="Price history">
                <History className="size-3.5" />
              </Button>
            </div>
          );
        },
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish, showProduct, showList]);

  return (
    <>
      <DataTable columns={columns} data={rows} rowKey={(r) => r.id} searchable columnToggle emptyTitle="No prices" emptyDescription="No prices match this filter." pageSize={50} initialSorting={[{ id: "valid_from", desc: true }]} />

      {/* Publish / compare-before-publish */}
      <Dialog open={!!publishFor} onOpenChange={(o) => !o && setPublishFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{needOverride ? "Resolve overlapping price" : "Publish price"}</DialogTitle>
            <DialogDescription>Compare against the price currently in force for the same list, variant, basis and minimum quantity before publishing.</DialogDescription>
          </DialogHeader>
          {publishFor && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-md border p-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Current</div>
                  {loadPreview.pending && !preview ? (
                    <div className="text-muted-foreground">Loading…</div>
                  ) : preview?.previous ? (
                    <>
                      <div className="tnum text-lg font-semibold">{formatMoney(preview.previous.amount, preview.previous.currency)}</div>
                      <div className="text-xs text-muted-foreground">
                        from {formatDate(preview.previous.valid_from)} · {preview.previous.state}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{preview.previous.source_ref ?? "—"}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No current price for this scope</div>
                  )}
                </div>
                <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">New</div>
                  <div className={cn("tnum text-lg font-semibold", preview?.previous && preview.previous.amount !== publishFor.amount && (publishFor.amount > preview.previous.amount ? "text-warning" : "text-success"))}>{formatMoney(publishFor.amount, publishFor.currency)}</div>
                  <div className="text-xs text-muted-foreground">
                    from {formatDate(publishFor.valid_from)}
                    {publishFor.valid_to ? ` to ${formatDate(publishFor.valid_to)}` : ""}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{publishFor.source_ref ?? "—"}</div>
                </div>
              </div>
              {preview?.previous && preview.previous.amount !== 0 && (
                <p className="tnum text-xs text-muted-foreground">
                  Change: {(((publishFor.amount - preview.previous.amount) / preview.previous.amount) * 100).toFixed(1)}% · basis {publishFor.unit_code ?? "—"} · {publishFor.currency}. Units and currencies are never converted.
                </p>
              )}
              {needOverride ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs text-warning">An overlapping current or scheduled price exists for this exact scope. Publishing with override supersedes it and records your reason in the approval log.</p>
                  <Field label="Override reason" required className="mt-2">
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Supplier price list 2026-08 supersedes 2026-02 with earlier effective date" />
                  </Field>
                </div>
              ) : (
                preview?.previous && <p className="text-xs text-muted-foreground">{preview.previous.valid_to ? "The current price ends before this one starts; no overlap." : "The current price has no end date — publishing will be blocked as a conflict unless you override with a reason."}</p>
              )}
              {publish.error && <p className="text-sm text-destructive">{publish.error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishFor(null)}>
              Cancel
            </Button>
            {!needOverride && (
              <Button
                disabled={publish.pending || !publishFor}
                onClick={async () => {
                  if (!publishFor) return;
                  const res = await publish.run(publishFor.id, false, undefined, productId ?? publishFor.product_id, listId ?? publishFor.price_list_id);
                  if (!res.ok && /overlapping/i.test(res.error)) setNeedOverride(true);
                }}
              >
                {publish.pending ? "Publishing…" : "Publish"}
              </Button>
            )}
            {needOverride && (
              <Button variant="destructive" disabled={publish.pending || !publishFor || reason.trim().length < 5} onClick={() => publishFor && publish.run(publishFor.id, true, reason.trim(), productId ?? publishFor.product_id, listId ?? publishFor.price_list_id)}>
                {publish.pending ? "Publishing…" : "Override and publish"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject */}
      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject price</DialogTitle>
            <DialogDescription>The draft stays for evidence but is marked rejected in review.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={reject.pending || reason.trim().length < 3} onClick={() => rejectFor && reject.run(rejectFor.id, reason.trim(), productId ?? rejectFor.product_id, listId ?? rejectFor.price_list_id)}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit draft */}
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit draft price</DialogTitle>
            <DialogDescription>Only drafts can be edited. Published prices are superseded by new versions, never overwritten.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" required>
              <Input type="number" step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} className="tnum" />
            </Field>
            <Field label="Min quantity">
              <Input type="number" value={edit.min_quantity} onChange={(e) => setEdit({ ...edit, min_quantity: e.target.value })} className="tnum" />
            </Field>
            <Field label="Valid from" required>
              <Input type="date" value={edit.valid_from} onChange={(e) => setEdit({ ...edit, valid_from: e.target.value })} />
            </Field>
            <Field label="Valid to">
              <Input type="date" value={edit.valid_to} onChange={(e) => setEdit({ ...edit, valid_to: e.target.value })} />
            </Field>
            <Field label="Source reference" className="sm:col-span-2">
              <Input value={edit.source_ref} onChange={(e) => setEdit({ ...edit, source_ref: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={2} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={update.pending || !editFor}
              onClick={() =>
                editFor &&
                update.run(
                  editFor.id,
                  { price_list_id: editFor.price_list_id, variant_id: editFor.variant_id, amount: edit.amount, currency: editFor.currency, unit_id: editFor.unit_id ?? "", min_quantity: edit.min_quantity, valid_from: edit.valid_from, valid_to: edit.valid_to, source_ref: edit.source_ref, notes: edit.notes },
                  productId ?? editFor.product_id,
                )
              }
            >
              {update.pending ? "Saving…" : "Save draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History drawer */}
      <RecordDrawer open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)} title={historyFor ? `${historyFor.product_name} · ${historyFor.sku ?? ""}` : ""} description="Price history for this variant across lists, plus the approval log for the selected price." width="lg">
        {historyFor && (
          <>
            <DrawerSection title="Selected price">
              <FactList
                items={[
                  { label: "Amount", value: formatMoney(historyFor.amount, historyFor.currency) },
                  { label: "Basis", value: historyFor.unit_code ? `per ${historyFor.unit_code}` : "—" },
                  { label: "List", value: `${historyFor.price_list_name} · ${historyFor.price_type}` },
                  { label: "Valid", value: `${formatDate(historyFor.valid_from)} → ${historyFor.valid_to ? formatDate(historyFor.valid_to) : "open"}` },
                  { label: "State", value: <StatusPill map={PRICE_STATE} value={historyFor.state} /> },
                  { label: "Source", value: historyFor.source_ref ?? "—" },
                ]}
              />
            </DrawerSection>
            <DrawerSection title="Approval log">
              {loadPreview.pending && !preview ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : preview?.events.length ? (
                <ul className="space-y-1 text-sm">
                  {preview.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                      <TonePill tone={e.action === "approved" ? "success" : e.action === "rejected" ? "destructive" : e.action === "override" ? "warning" : "neutral"} label={e.action} />
                      <span className="text-xs text-muted-foreground">
                        {e.actor_name ?? "system"} · {formatDateTime(e.occurred_at)}
                      </span>
                      {e.reason && <span className="w-full text-xs text-muted-foreground">{e.reason}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No approval events.</p>
              )}
            </DrawerSection>
            <DrawerSection title="Variant price history">
              {preview?.history?.length ? (
                <ul className="space-y-1">
                  {preview.history.map((h) => (
                    <li key={h.id} className={cn("flex flex-wrap items-center gap-x-3 rounded border px-2 py-1 text-sm", h.id === historyFor.id && "bg-accent/50")}>
                      <span className="tnum font-medium">{formatMoney(h.amount, h.currency)}</span>
                      <span className="text-xs text-muted-foreground">{h.unit_code ? `per ${h.unit_code}` : ""}</span>
                      <span className="text-xs">{h.price_list_name}</span>
                      <span className="tnum text-xs text-muted-foreground">
                        {formatDate(h.valid_from)} → {h.valid_to ? formatDate(h.valid_to) : "open"}
                      </span>
                      <StatusPill map={PRICE_STATE} value={h.state} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{loadPreview.pending ? "Loading…" : "No history."}</p>
              )}
            </DrawerSection>
          </>
        )}
      </RecordDrawer>
    </>
  );
}
