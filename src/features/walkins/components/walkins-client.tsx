"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, MoneyCell, MonoCell } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { PURCHASE_STATUS, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDateTime, formatMoney, formatRelative, titleCase } from "@/lib/format";
import { useSession } from "@/components/shell/session-context";
import { correctPurchaseAction } from "@/server/commands/walkins";
import type { PurchaseRow, VisitRow } from "@/features/walkins/types";

interface Props {
  tab: "visits" | "purchases";
  visits: VisitRow[];
  purchases: PurchaseRow[];
  counts: { visitsToday: number; visits7d: number; purchases7d: number; repeat7d: number };
}

export function WalkinsClient({ tab, visits, purchases, counts }: Props) {
  const router = useRouter();
  const { can } = useSession();
  const [, setTab] = useQueryState("tab");
  const [visitId, setVisitId] = useQueryState("visit");
  const [purchaseId, setPurchaseId] = useQueryState("purchase");
  const [correcting, setCorrecting] = useState(false);
  const [pending, start] = useTransition();

  const visit = visits.find((v) => v.id === visitId) ?? null;
  const purchase = purchases.find((p) => p.id === purchaseId) ?? null;

  const visitColumns = useMemo<ColumnDef<VisitRow, unknown>[]>(
    () => [
      { accessorKey: "occurred_at", header: "When", cell: ({ row }) => <span className="tnum" title={formatDateTime(row.original.occurred_at)}>{formatRelative(row.original.occurred_at)}</span> },
      { accessorKey: "location_name", header: "Location", cell: ({ row }) => row.original.location_name ?? "—" },
      { accessorKey: "staff_name", header: "Staff", cell: ({ row }) => row.original.staff_name ?? "—" },
      {
        accessorKey: "contact_name",
        header: "Customer",
        cell: ({ row }) =>
          row.original.contact_id ? (
            <Link href={`/sales/contacts/${row.original.contact_id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.contact_name ?? "Contact"}
            </Link>
          ) : (
            "—"
          ),
      },
      { accessorKey: "customer_type", header: "Type", cell: ({ row }) => (row.original.customer_type ? titleCase(row.original.customer_type) : "—") },
      { accessorKey: "origin_area", header: "Origin / area", cell: ({ row }) => row.original.origin_area ?? "—" },
      { accessorKey: "inquiry_source", header: "Inquiry source", cell: ({ row }) => (row.original.inquiry_source ? <StatusPill map={SOURCE_CHANNEL} value={row.original.inquiry_source} /> : "—") },
      { accessorKey: "purpose", header: "Purpose", cell: ({ row }) => titleCase(row.original.purpose) || "—" },
      { accessorKey: "is_new_customer", header: "New / existing", cell: ({ row }) => (row.original.is_new_customer === null ? "—" : row.original.is_new_customer ? <TonePill tone="info" label="New" /> : <TonePill tone="ai" label="Existing" />) },
      {
        accessorKey: "opportunity_id",
        header: "Opportunity",
        cell: ({ row }) =>
          row.original.opportunity_id ? (
            <Link href={`/sales/pipeline?opportunity=${row.original.opportunity_id}`} className="text-info hover:underline" onClick={(e) => e.stopPropagation()}>
              Open
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  const purchaseColumns = useMemo<ColumnDef<PurchaseRow, unknown>[]>(
    () => [
      { accessorKey: "purchased_at", header: "Date", cell: ({ row }) => <span className="tnum" title={formatDateTime(row.original.purchased_at)}>{formatRelative(row.original.purchased_at)}</span> },
      { accessorKey: "external_ref", header: "ORC / ref", cell: ({ row }) => <MonoCell value={row.original.external_ref} /> },
      {
        id: "customer",
        header: "Customer",
        accessorFn: (r) => `${r.contact_name ?? ""} ${r.account_name ?? ""}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            {row.original.contact_id && (
              <Link href={`/sales/contacts/${row.original.contact_id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                {row.original.contact_name ?? "Contact"}
              </Link>
            )}
            {row.original.account_id && (
              <Link href={`/sales/accounts/${row.original.account_id}`} className="block truncate text-[11px] text-muted-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                {row.original.account_name ?? "Account"}
              </Link>
            )}
            {!row.original.contact_id && !row.original.account_id && "—"}
          </div>
        ),
      },
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <MoneyCell value={row.original.amount} currency={row.original.currency} className="font-medium" /> },
      { accessorKey: "payment_methods", header: "Payment", cell: ({ row }) => (row.original.payment_methods.length ? row.original.payment_methods.map(titleCase).join(", ") : <span className="text-muted-foreground">—</span>) },
      { accessorKey: "purchase_source", header: "Source", cell: ({ row }) => (row.original.purchase_source ? titleCase(row.original.purchase_source) : "—") },
      { accessorKey: "location_name", header: "Location", cell: ({ row }) => row.original.location_name ?? "—" },
      { accessorKey: "salesperson_name", header: "Salesperson", cell: ({ row }) => row.original.salesperson_name ?? "—" },
      { accessorKey: "is_repeat", header: "Repeat", cell: ({ row }) => (row.original.is_repeat ? <TonePill tone="ai" label="Repeat" /> : <TonePill tone="neutral" label="First" />) },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={PURCHASE_STATUS} value={row.original.status} /> },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="Visits today" value={counts.visitsToday} info={{ definition: "Visits recorded today.", grain: "Visit", source: "sales.visits" }} />
        <MetricCard compact label="Visits (7d)" value={counts.visits7d} info={{ definition: "Visits recorded in the last 7 days.", grain: "Visit", source: "sales.visits" }} />
        <MetricCard compact label="Purchases (7d)" value={counts.purchases7d} info={{ definition: "Purchases recorded in the last 7 days, excluding voided.", grain: "Purchase", source: "sales.purchases" }} />
        <MetricCard compact label="Repeat purchases (7d)" value={counts.repeat7d} tone="ai" info={{ definition: "Purchases whose identity already had a prior accepted purchase.", grain: "Purchase", source: "sales.purchases", caveat: "Derived from app-recorded purchases only." }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v)}>
          <TabsList>
            <TabsTrigger value="visits">Visits</TabsTrigger>
            <TabsTrigger value="purchases">Purchases</TabsTrigger>
          </TabsList>
        </Tabs>
        {can("sales.write") && (
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link href="/sales/walk-ins/import">
                <FileSpreadsheet className="size-3.5" aria-hidden /> Import spreadsheet
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8">
              <Link href="/sales/walk-ins/new">
                <Plus className="size-3.5" aria-hidden /> New walk-in
              </Link>
            </Button>
          </div>
        )}
      </div>

      {tab === "visits" ? (
        <DataTable columns={visitColumns} data={visits} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => setVisitId(r.id)} isRowActive={(r) => r.id === visitId} emptyTitle="No visits yet" emptyDescription="Record a walk-in from the showroom or import the existing workbook." emptyAction={{ label: "New walk-in", href: "/sales/walk-ins/new" }} />
      ) : (
        <DataTable columns={purchaseColumns} data={purchases} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => setPurchaseId(r.id)} isRowActive={(r) => r.id === purchaseId} emptyTitle="No purchases yet" emptyDescription="Purchases are captured in the walk-in flow or imported." />
      )}

      {/* Visit drawer */}
      <RecordDrawer open={!!visit} onOpenChange={(o) => !o && setVisitId(null)} title="Showroom visit" description={visit ? `${formatDateTime(visit.occurred_at)} · ${visit.location_name ?? "Unknown location"}` : undefined} width="md">
        {visit && (
          <>
            <DrawerSection title="Visit">
              <FactList
                items={[
                  { label: "Customer", value: visit.contact_id ? <Link href={`/sales/contacts/${visit.contact_id}`} className="hover:underline">{visit.contact_name}</Link> : "—" },
                  { label: "Staff", value: visit.staff_name },
                  { label: "Customer type", value: titleCase(visit.customer_type) || "—" },
                  { label: "Origin / area", value: visit.origin_area },
                  { label: "Inquiry source", value: titleCase(visit.inquiry_source) || "—" },
                  { label: "Purpose", value: titleCase(visit.purpose) || "—" },
                  { label: "New customer", value: visit.is_new_customer === null ? "—" : visit.is_new_customer ? "Yes" : "No (existing)" },
                  { label: "Opportunity", value: visit.opportunity_id ? <Link href={`/sales/pipeline?opportunity=${visit.opportunity_id}`} className="text-info hover:underline">Open opportunity</Link> : "—" },
                ]}
              />
              {visit.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{visit.notes}</p>}
            </DrawerSection>
            <DrawerSection title="Linked purchases">
              {purchases.filter((p) => p.visit_id === visit.id).length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchase recorded at this visit.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {purchases
                    .filter((p) => p.visit_id === visit.id)
                    .map((p) => (
                      <li key={p.id} className="flex items-center justify-between px-3 py-2">
                        <button type="button" className="font-mono text-[12px] hover:underline" onClick={() => { setVisitId(null); setPurchaseId(p.id); }}>
                          {p.external_ref ?? "Purchase"}
                        </button>
                        <span className="tnum">{formatMoney(p.amount, p.currency)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </DrawerSection>
            {visit.contact_id && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/sales/contacts/${visit.contact_id}`}>Open customer timeline</Link>
              </Button>
            )}
          </>
        )}
      </RecordDrawer>

      {/* Purchase drawer */}
      <RecordDrawer
        open={!!purchase}
        onOpenChange={(o) => !o && setPurchaseId(null)}
        title={purchase ? <span className="flex items-center gap-2"><span className="font-mono">{purchase.external_ref ?? "Purchase"}</span><StatusPill map={PURCHASE_STATUS} value={purchase.status} size="md" />{purchase.is_repeat && <TonePill tone="ai" label="Repeat" size="md" />}</span> : ""}
        description={purchase ? `${formatDateTime(purchase.purchased_at)} · ${formatMoney(purchase.amount, purchase.currency)}` : undefined}
        width="md"
        actions={purchase && can("purchase.correct") && purchase.status !== "voided" ? <Button size="sm" variant="outline" className="h-7" onClick={() => setCorrecting(true)}>Correct amount</Button> : undefined}
      >
        {purchase && (
          <>
            <DrawerSection title="Purchase">
              <FactList
                items={[
                  { label: "Customer", value: purchase.contact_id ? <Link href={`/sales/contacts/${purchase.contact_id}`} className="hover:underline">{purchase.contact_name}</Link> : "—" },
                  { label: "Account", value: purchase.account_id ? <Link href={`/sales/accounts/${purchase.account_id}`} className="hover:underline">{purchase.account_name}</Link> : "—" },
                  { label: "Amount", value: formatMoney(purchase.amount, purchase.currency), mono: true },
                  { label: "Source", value: titleCase(purchase.purchase_source) || "—" },
                  { label: "Location", value: purchase.location_name },
                  { label: "Salesperson", value: purchase.salesperson_name },
                  { label: "Opportunity", value: purchase.opportunity_id ? <Link href={`/sales/pipeline?opportunity=${purchase.opportunity_id}`} className="text-info hover:underline">Open</Link> : "—" },
                  { label: "Visit", value: purchase.visit_id ? <button type="button" className="text-info hover:underline" onClick={() => { setPurchaseId(null); setVisitId(purchase.visit_id); }}>Open visit</button> : "—" },
                ]}
              />
              {purchase.notes && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-xs">{purchase.notes}</p>}
            </DrawerSection>
            <DrawerSection title={`Payments (${purchase.payments.length})`}>
              {purchase.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payment breakdown captured — only the total is known.</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {purchase.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-3 py-1.5">
                      <span>{titleCase(p.method)}{p.reference ? <span className="ml-2 font-mono text-[11px] text-muted-foreground">{p.reference}</span> : null}</span>
                      <span className="tnum">{formatMoney(p.amount, purchase.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>
            <DrawerSection title={`Items (${purchase.items.length})`}>
              {purchase.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No line items — document and total only (allowed by PRD §7.4).</p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {purchase.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate">{it.description}</span>
                      <span className="tnum text-muted-foreground">{it.quantity} {it.unit ?? ""}</span>
                      <span className="tnum">{it.line_total !== null ? formatMoney(it.line_total, purchase.currency) : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>
          </>
        )}
      </RecordDrawer>

      <Dialog open={correcting} onOpenChange={setCorrecting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correct purchase amount</DialogTitle>
            <DialogDescription>Corrections are restricted and audited. The original amount stays in the audit trail.</DialogDescription>
          </DialogHeader>
          {purchase && (
            <CorrectForm
              purchase={purchase}
              pending={pending}
              onSubmit={(amount, reason) =>
                start(async () => {
                  const r = await correctPurchaseAction({ purchase_id: purchase.id, amount, reason });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success(r.message);
                  setCorrecting(false);
                  router.refresh();
                })
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CorrectForm({ purchase, pending, onSubmit }: { purchase: PurchaseRow; pending: boolean; onSubmit: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState(String(purchase.amount));
  const [reason, setReason] = useState("");
  const n = Number(amount);
  return (
    <div className="space-y-3">
      <Field label="Current amount">
        <div className="tnum text-sm">{formatMoney(purchase.amount, purchase.currency)}</div>
      </Field>
      <Field label="Corrected amount" required>
        <Input className="h-8 tnum" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason" required hint="At least 5 characters">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button disabled={pending || Number.isNaN(n) || n < 0 || reason.trim().length < 5} onClick={() => onSubmit(n, reason.trim())}>
          {pending ? "Saving…" : "Apply correction"}
        </Button>
      </DialogFooter>
    </div>
  );
}
