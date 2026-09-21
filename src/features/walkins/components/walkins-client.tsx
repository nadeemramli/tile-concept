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
import { DisabledHint, Gated, gateReason } from "@/components/patterns/explain";
import { PURCHASE_STATUS, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDateTime, formatMoney, formatRelative, titleCase } from "@/lib/format";
import { useSession } from "@/components/shell/session-context";
import { correctPurchaseAction } from "@/server/commands/walkins";
import type { PurchaseRow, VisitRow } from "@/features/walkins/types";
import { VisitInquiryLink } from "./visit-inquiry-link";

/** Column meanings follow the showroom Daily Tracker sheet the team already knows. */
const HINTS = {
  smp: "The staff member who served the visit (the sheet's SMP column).",
  from: "Where the customer came from: their neighbourhood or town.",
  status: "New means no earlier record of this customer; Existing means they were already in the app. Decided when the visit is recorded.",
  type: "Homeowner, contractor, designer and so on. Set on the customer and confirmed at the visit.",
  orc: "The official receipt number of the collection recorded at this visit. Blank when nothing was paid.",
  collection: "Money taken at this visit, recorded as a linked purchase. Not reconciled with SQL Account.",
  sq: "The quotation number handed to the customer at this visit.",
  quotation: "The quoted amount in MYR. A quotation is not a sale; the purchase column is.",
  heard: "The channel the customer named when asked how they heard of the showroom.",
  purpose: "What the customer came to do: browse, collect, purchase, and so on.",
  opportunity: "The pipeline opportunity this visit was linked to, if any.",
  postingDate: "When the purchase was posted, not when it was entered into the app.",
  documentNo: "The receipt or invoice number from the counter (the ORC).",
  extRef: "A bank or e-wallet reference from the payment, when one was captured.",
  repeat: "Repeat means this customer already had an accepted purchase in the app. Derived from app data only.",
  source: "Whether the purchase came from a walk-in, an import or elsewhere.",
  newPill: "No earlier record of this customer existed when the visit was recorded.",
  existingPill: "The customer was already in the app before this visit.",
  repeatPill: "This customer already had an accepted purchase recorded in the app.",
  firstPill: "The first purchase recorded for this customer in the app. Earlier purchases in SQL Account are not counted.",
} as const;

interface Props {
  selectedVisit: VisitRow | null;
  linkHistory: { id: string; occurred_at: string; reason: string }[];
  visitPage: number;
  visitTotal: number;
  needsLinking: boolean;
  tab: "visits" | "purchases";
  visits: VisitRow[];
  purchases: PurchaseRow[];
  counts: { visitsToday: number; visits7d: number; purchases7d: number; repeat7d: number };
}

export function WalkinsClient({ tab, visits, purchases, counts, selectedVisit, linkHistory, visitPage, visitTotal, needsLinking }: Props) {
  const router = useRouter();
  const { can, session } = useSession();
  const [, setTab] = useQueryState("tab", { shallow: false });
  const [visitId, setVisitId] = useQueryState("visit", { shallow: false });
  const [purchaseId, setPurchaseId] = useQueryState("purchase");
  const [correcting, setCorrecting] = useState(false);
  const [pending, start] = useTransition();

  const visit = selectedVisit?.id === visitId ? selectedVisit : visits.find((v) => v.id === visitId) ?? null;
  const purchase = purchases.find((p) => p.id === purchaseId) ?? null;

  // The Daily Tracker shows the day's collection (ORC + amount) on the same
  // visit row; the app models that as a linked purchase, so map it here.
  const purchaseByVisit = useMemo(() => {
    const m = new Map<string, PurchaseRow>();
    for (const p of purchases) if (p.visit_id) m.set(p.visit_id, p);
    return m;
  }, [purchases]);

  // Column set and order follow the showroom Daily Tracker sheet:
  // Date · SMP · Customer · From · Status · Type · Area · ORC · Collection ·
  // SQ · Quotation · How they heard · Purpose (+ Opportunity link, app value).
  const visitColumns = useMemo<ColumnDef<VisitRow, unknown>[]>(
    () => [
      { accessorKey: "occurred_at", header: "Date", cell: ({ row }) => <span className="tnum" title={formatDateTime(row.original.occurred_at)}>{formatRelative(row.original.occurred_at)}</span> },
      { accessorKey: "staff_name", header: "SMP", meta: { hint: HINTS.smp }, cell: ({ row }) => row.original.staff_name ?? "—" },
      { accessorKey: "inquiry_link_state", header: "Inquiry link", meta: { hint: "Linked visits retain the inquiry’s acquisition source. Needs linking visits await staff review. Legacy links have not been inferred or reassigned." }, cell: ({ row }) => <TonePill tone={row.original.inquiry_link_state === "needs_linking" ? "warning" : "neutral"} label={titleCase(row.original.inquiry_link_state)} hint={row.original.inquiry_link_state === "needs_linking" ? "Open this visit to resolve its original inquiry." : "Open this visit to inspect or correct the inquiry link."} /> },
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
      { accessorKey: "origin_area", header: "From", meta: { hint: HINTS.from }, cell: ({ row }) => row.original.origin_area ?? "—" },
      { accessorKey: "is_new_customer", header: "Status", meta: { hint: HINTS.status }, cell: ({ row }) => (row.original.is_new_customer === null ? "—" : row.original.is_new_customer ? <TonePill tone="info" label="New" hint={HINTS.newPill} /> : <TonePill tone="ai" label="Existing" hint={HINTS.existingPill} />) },
      { accessorKey: "customer_type", header: "Type", meta: { hint: HINTS.type }, cell: ({ row }) => (row.original.customer_type ? titleCase(row.original.customer_type) : "—") },
      { accessorKey: "renovation_area", header: "Area / renovation", meta: { hint: "Which part of the property is being renovated: wet kitchen, master bath, and so on." }, cell: ({ row }) => row.original.renovation_area ?? "—" },
      {
        id: "orc_number",
        header: "ORC",
        meta: { hint: HINTS.orc },
        cell: ({ row }) => <MonoCell value={purchaseByVisit.get(row.original.id)?.external_ref ?? null} />,
      },
      {
        id: "collection",
        header: "Collection",
        meta: { hint: HINTS.collection },
        cell: ({ row }) => {
          const p = purchaseByVisit.get(row.original.id);
          return p ? <MoneyCell value={p.amount} currency={p.currency} className="font-medium" /> : <span className="text-muted-foreground">—</span>;
        },
      },
      { accessorKey: "quotation_ref", header: "SQ", meta: { hint: HINTS.sq }, cell: ({ row }) => <MonoCell value={row.original.quotation_ref} /> },
      { accessorKey: "quotation_amount", header: "Quotation", meta: { hint: HINTS.quotation }, cell: ({ row }) => (row.original.quotation_amount !== null ? <MoneyCell value={row.original.quotation_amount} currency="MYR" /> : <span className="text-muted-foreground">—</span>) },
      { accessorKey: "inquiry_source", header: "How they heard", meta: { hint: HINTS.heard }, cell: ({ row }) => (row.original.inquiry_source ? <StatusPill map={SOURCE_CHANNEL} value={row.original.inquiry_source} /> : "—") },
      { accessorKey: "purpose", header: "Purpose", meta: { hint: HINTS.purpose }, cell: ({ row }) => titleCase(row.original.purpose) || "—" },
      {
        accessorKey: "opportunity_id",
        header: "Opportunity",
        meta: { hint: HINTS.opportunity },
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
    [purchaseByVisit],
  );

  const purchaseColumns = useMemo<ColumnDef<PurchaseRow, unknown>[]>(
    () => [
      { accessorKey: "purchased_at", header: "Posting date", meta: { hint: HINTS.postingDate }, cell: ({ row }) => <span className="tnum" title={formatDateTime(row.original.purchased_at)}>{formatRelative(row.original.purchased_at)}</span> },
      { accessorKey: "external_ref", header: "Document no.", meta: { hint: HINTS.documentNo }, cell: ({ row }) => <MonoCell value={row.original.external_ref} /> },
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
      { accessorKey: "payment_methods", header: "Payment method", cell: ({ row }) => (row.original.payment_methods.length ? row.original.payment_methods.map(titleCase).join(", ") : <span className="text-muted-foreground">—</span>) },
      { id: "ext_ref", header: "Bank / ext. ref", meta: { hint: HINTS.extRef }, cell: ({ row }) => <MonoCell value={row.original.payments.find((p) => p.reference)?.reference ?? null} /> },
      { accessorKey: "purchase_source", header: "Source", meta: { hint: HINTS.source }, cell: ({ row }) => (row.original.purchase_source ? titleCase(row.original.purchase_source) : "—") },
      { accessorKey: "location_name", header: "Location", cell: ({ row }) => row.original.location_name ?? "—" },
      { accessorKey: "salesperson_name", header: "Salesperson", cell: ({ row }) => row.original.salesperson_name ?? "—" },
      { accessorKey: "is_repeat", header: "Repeat", meta: { hint: HINTS.repeat }, cell: ({ row }) => (row.original.is_repeat ? <TonePill tone="ai" label="Repeat" hint={HINTS.repeatPill} /> : <TonePill tone="neutral" label="First" hint={HINTS.firstPill} />) },
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
        {can("sales.write") ? (
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
        ) : (
          <DisabledHint reason={{ title: "Needs a different role", body: gateReason("sales.write", session.roleLabel) }}>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8" disabled>
                <FileSpreadsheet className="size-3.5" aria-hidden /> Import spreadsheet
              </Button>
              <Button size="sm" className="h-8" disabled>
                <Plus className="size-3.5" aria-hidden /> New walk-in
              </Button>
            </div>
          </DisabledHint>
        )}
      </div>

      {tab === "visits" ? (<>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={needsLinking ? "outline" : "secondary"} size="sm"><Link href="/sales/walk-ins?tab=visits">All visits</Link></Button>
          <Button asChild variant={needsLinking ? "secondary" : "outline"} size="sm"><Link href="/sales/walk-ins?tab=visits&filter=needs-linking">Needs linking</Link></Button>
        </div>
        <DataTable columns={visitColumns} data={visits} rowKey={(r) => r.id} searchable searchPlaceholder="Filter this page…" hidePagination columnToggle onRowClick={(r) => setVisitId(r.id)} isRowActive={(r) => r.id === visitId} emptyTitle={needsLinking ? "No visits need linking" : "No visits yet"} emptyDescription={needsLinking ? "Ambiguous matches will appear here for staff review." : "Record a walk-in from the showroom or import the existing workbook."} emptyAction={{ label: "New walk-in", href: "/sales/walk-ins/new" }} />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>{visitTotal} visits · Page {visitPage} of {Math.max(1, Math.ceil(visitTotal / 25))}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={visitPage <= 1} onClick={() => router.push(`/sales/walk-ins?tab=visits&page=${visitPage - 1}${needsLinking ? "&filter=needs-linking" : ""}`)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={visitPage * 25 >= visitTotal} onClick={() => router.push(`/sales/walk-ins?tab=visits&page=${visitPage + 1}${needsLinking ? "&filter=needs-linking" : ""}`)}>Next</Button>
          </div>
        </div>
      </>
      ) : (
        <DataTable columns={purchaseColumns} data={purchases} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => setPurchaseId(r.id)} isRowActive={(r) => r.id === purchaseId} emptyTitle="No purchases yet" emptyDescription="Purchases are captured in the walk-in flow or imported." />
      )}

      {/* Visit drawer */}
      <RecordDrawer open={!!visit} onOpenChange={(o) => !o && setVisitId(null)} title="Showroom visit" description={visit ? `${formatDateTime(visit.occurred_at)} · ${visit.location_name ?? "Unknown location"}` : undefined} width="md">
        {visit && (
          <>
            <DrawerSection title="Original inquiry">
              <VisitInquiryLink key={`${visit.id}:${visit.inquiry_link_version}`} visit={visit} history={linkHistory} />
            </DrawerSection>
            <DrawerSection title="Visit">
              <FactList
                items={[
                  { label: "Customer", value: visit.contact_id ? <Link href={`/sales/contacts/${visit.contact_id}`} className="hover:underline">{visit.contact_name}</Link> : "—" },
                  { label: "Staff", value: visit.staff_name },
                  { label: "Customer type", value: titleCase(visit.customer_type) || "—" },
                  { label: "From (customer area)", value: visit.origin_area },
                  { label: "Area / renovation", value: visit.renovation_area || "—" },
                  { label: "How they heard", value: titleCase(visit.inquiry_source) || "—" },
                  { label: "Purpose", value: titleCase(visit.purpose) || "—" },
                  { label: "Quotation", value: visit.quotation_amount !== null || visit.quotation_ref ? `${visit.quotation_ref ?? "—"}${visit.quotation_amount !== null ? ` · ${formatMoney(visit.quotation_amount, "MYR")}` : ""}` : "—" },
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
        title={purchase ? <span className="flex items-center gap-2"><span className="font-mono">{purchase.external_ref ?? "Purchase"}</span><StatusPill map={PURCHASE_STATUS} value={purchase.status} size="md" />{purchase.is_repeat && <TonePill tone="ai" label="Repeat" size="md" hint={HINTS.repeatPill} />}</span> : ""}
        description={purchase ? `${formatDateTime(purchase.purchased_at)} · ${formatMoney(purchase.amount, purchase.currency)}` : undefined}
        width="md"
        actions={
          purchase && purchase.status !== "voided" ? (
            <div className="flex gap-2">
              {can("sales.write") && purchase.contact_id ? (
                <Button asChild size="sm" className="h-7">
                  <Link href={`/sales/feedback/new?purchase=${purchase.id}`}>Request feedback</Link>
                </Button>
              ) : (
                <DisabledHint
                  reason={
                    !can("sales.write")
                      ? { title: "Needs a different role", body: gateReason("sales.write", session.roleLabel) }
                      : "Resolve the customer first. Feedback can only be requested for a purchase linked to a contact, because the private link goes to that person by WhatsApp."
                  }
                >
                  <Button size="sm" className="h-7" disabled>
                    Request feedback
                  </Button>
                </DisabledHint>
              )}
              <Gated permission="purchase.correct">
                <Button size="sm" variant="outline" className="h-7" onClick={() => setCorrecting(true)}>
                  Correct amount
                </Button>
              </Gated>
            </div>
          ) : undefined
        }
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
                <p className="text-sm text-muted-foreground">No line items. Only the document number and total were recorded, which is enough for a purchase; item detail stays in SQL Account.</p>
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
        <DisabledHint reason={!pending && (Number.isNaN(n) || n < 0) ? "Enter a corrected amount of zero or more." : !pending && reason.trim().length < 5 ? "The reason needs at least 5 characters. It is kept in the audit trail." : undefined}>
          <Button disabled={pending || Number.isNaN(n) || n < 0 || reason.trim().length < 5} onClick={() => onSubmit(n, reason.trim())}>
            {pending ? "Saving…" : "Apply correction"}
          </Button>
        </DisabledHint>
      </DialogFooter>
    </div>
  );
}
