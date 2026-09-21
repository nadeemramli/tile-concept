"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { DisabledHint, Gated, Hint } from "@/components/patterns/explain";
import { LEAD_STATUS, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatRelative, isOverdue, maskValue, titleCase } from "@/lib/format";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { useSession } from "@/components/shell/session-context";
import { VIEW_LABELS } from "@/features/inbox/lib/whereabouts";
import { LEAD_VIEWS, SOURCE_CHANNELS } from "@/features/inbox/schema";
import type { InquiryFilters } from "@/server/queries/leads";
import { LeadDrawer } from "@/features/inbox/components/lead-drawer";
import { NewInquiryDialog } from "@/features/inbox/components/new-inquiry-dialog";
import { InboxLive } from "@/features/inbox/components/inbox-live";
import { bulkAssignLeadsAction } from "@/server/commands/leads";
import type { IdentityCandidate, InboxCounts, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { LeadView } from "@/features/inbox/schema";
import type { ProfileRef } from "@/server/queries/reference";
import type { TimelineItem } from "@/components/patterns/timeline";
import { cn } from "@/lib/utils";

const PRIMARY_VIEWS: LeadView[] = ["needs-action", "waiting", "replied", "showroom", "won", "follow-ups-due", "upcoming", "disqualified", "all"];

const COLUMN_HINTS = {
  received: "When the inquiry arrived from the connector or was typed in.",
  source: "Where it came from. The line under the pill is the form or campaign name when the connector sent one.",
  contact: "Phone and email are masked in lists. Revealing them needs the contact.reveal permission and is audited.",
  owner: "The salesperson responsible. Unassigned means nobody is on the clock for this lead.",
  sla: "Time to the first real contact. The target is 4 hours from arrival. Due shows the deadline; no SLA means no deadline was set; a dash means the lead is closed.",
  next_follow_up: "The next reminder set from the lead. Red means it is overdue.",
  attempts: "Calls, messages and emails logged for this lead, whether or not the customer was reached.",
  products: "Product categories the customer asked about.",
} as const;

interface Props {
  refreshedAt: string;
  view: LeadView;
  leads: LeadRow[];
  counts: InboxCounts;
  members: ProfileRef[];
  locations: { id: string; name: string }[];
  filters: InquiryFilters;
  total: number;
  page: number;
  pageSize: number;
  viewCounts: Record<string, number>;
  selected: LeadRow | null;
  selectedIntake: IntakeEventRow[];
  selectedTimeline: TimelineItem[];
  selectedContact: { id: string; display_name: string; lifecycle_state: string; customer_type: string | null } | null;
}

export function InboxClient({ refreshedAt, view, leads, counts, members, locations, filters, total, page, pageSize, viewCounts, selected, selectedIntake, selectedTimeline, selectedContact }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState(filters.search);
  function href(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key); else params.set(key, value);
    }
    return `/sales/inbox?${params.toString()}`;
  }
  function filter(patch: Record<string, string | null>) { router.push(href(patch)); }

  const { session, can } = useSession();
  const [leadParam, setLeadParam] = useQueryState("lead", { shallow: false });
  const [newParam, setNewParam] = useQueryState("new");
  const [suggestions, setSuggestions] = useState<Record<string, IdentityCandidate[]>>({});
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkRows, setBulkRows] = useState<LeadRow[] | null>(null);
  const [pending, start] = useTransition();
  const canRevealContact = can("contact.reveal");

  const columns = useMemo<ColumnDef<LeadRow, unknown>[]>(
    () => ([
      { accessorKey: "created_at", header: "Received", meta: { hint: COLUMN_HINTS.received }, cell: ({ row }) => <span className="tnum text-muted-foreground">{formatRelative(row.original.created_at)}</span> },
      {
        accessorKey: "source_channel",
        header: "Source",
        meta: { hint: COLUMN_HINTS.source },
        cell: ({ row }) => (
          <div>
            <StatusPill map={SOURCE_CHANNEL} value={row.original.source_channel} />
            {row.original.source_detail && <div className="mt-0.5 max-w-44 truncate text-[11px] text-muted-foreground" title={row.original.source_detail}>{row.original.source_detail}</div>}
          </div>
        ),
      },
      {
        id: "name",
        header: "Name / company",
        accessorFn: (r) => `${r.raw_name ?? ""} ${r.raw_company ?? ""}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.raw_name ?? <span className="text-muted-foreground">Unknown</span>}</div>
            {row.original.raw_company && <div className="truncate text-[11px] text-muted-foreground">{row.original.raw_company}</div>}
            <div className="text-[11px] text-muted-foreground">{row.original.confirmed_sales > 0 ? `Closed sale · ${row.original.confirmed_sales} sale${row.original.confirmed_sales === 1 ? "" : "s"}` : row.original.first_showroom_at ? `Visited showroom · ${row.original.showroom_visits} visit${row.original.showroom_visits === 1 ? "" : "s"}` : row.original.last_contact_attempt_at ? `Last staff contact ${formatRelative(row.original.last_contact_attempt_at)}` : row.original.first_response_at ? `First staff contact ${formatRelative(row.original.first_response_at)}` : "No staff contact recorded"}</div>
          </div>
        ),
      },
      {
        id: "contact",
        header: "Phone / email",
        meta: { hint: COLUMN_HINTS.contact },
        accessorFn: (r) => `${r.raw_phone_normalized ?? ""} ${r.raw_email ?? ""}`,
        cell: ({ row }) => (
          <div className="font-mono text-[12px] tnum">
            <div>{maskValue(row.original.raw_phone_normalized ?? row.original.raw_phone, "phone")}</div>
            {row.original.raw_email && <div className="text-muted-foreground">{maskValue(row.original.raw_email, "email")}</div>}
          </div>
        ),
      },
      { accessorKey: "interest", header: "Interest", cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.interest ?? ""}>{row.original.interest ?? "—"}</span> },
      { accessorKey: "owner_name", header: "Owner", meta: { hint: COLUMN_HINTS.owner }, cell: ({ row }) => row.original.owner_name ?? <TonePill tone="warning" label="Unassigned" hint="No salesperson owns this lead yet, so nobody is on the clock. A sales manager assigns it, or a rep picks it up." /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={LEAD_STATUS} value={row.original.confirmed_sales > 0 ? "won" : row.original.status} /> },
      {
        id: "sla",
        header: "First response",
        meta: { hint: COLUMN_HINTS.sla },
        accessorFn: (r) => r.first_response_at ?? r.first_response_due_at ?? "",
        cell: ({ row }) => {
          const l = row.original;
          if (l.first_response_at) return <span className="tnum text-success">responded {formatRelative(l.first_response_at)}</span>;
          if (l.confirmed_sales > 0 || ["disqualified", "converted", "duplicate"].includes(l.status)) return <span className="text-muted-foreground">—</span>;
          const over = isOverdue(l.first_response_due_at);
          if (!l.first_response_due_at)
            return (
              <Hint content="No first-response deadline was set for this lead, usually because it was captured manually. Respond as if the 4-hour target applied." focusable>
                <span className="tnum text-muted-foreground">no SLA</span>
              </Hint>
            );
          return <span className={cn("tnum", over ? "font-medium text-destructive" : "text-muted-foreground")}>{`due ${formatRelative(l.first_response_due_at)}`}</span>;
        },
      },
      {
        id: "next_follow_up",
        header: "Next follow-up",
        meta: { hint: COLUMN_HINTS.next_follow_up },
        accessorFn: (r) => r.next_follow_up_at ?? "",
        cell: ({ row }) => {
          const at = row.original.next_follow_up_at;
          if (!at) return <span className="text-muted-foreground">—</span>;
          const over = isOverdue(at);
          return <span className={cn("tnum", over ? "font-medium text-destructive" : "text-muted-foreground")}>due {formatRelative(at)}</span>;
        },
      },
      { accessorKey: "contact_attempts", header: "Attempts", meta: { hint: COLUMN_HINTS.attempts }, cell: ({ row }) => <span className="tnum">{row.original.contact_attempts}</span> },
      { accessorKey: "product_interest", header: "Products", meta: { hint: COLUMN_HINTS.products }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.product_interest.map(titleCase).join(", ") || "—"}</span> },
      {
        id: "whatsapp",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          if (!canRevealContact) return null;
          const lead = row.original;
          const url = buildWhatsAppUrl(
            lead.raw_phone_normalized ?? lead.raw_phone,
            buildLeadWhatsAppMessage({ name: lead.raw_name, interest: lead.interest, source: lead.source_channel }),
          );
          if (!url) return null;
          return (
            <Button asChild variant="ghost" size="icon-sm">
              <a href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label={`Message ${lead.raw_name ?? "lead"} on WhatsApp`} title="Open a pre-filled WhatsApp message">
                <MessageCircle className="size-3.5" aria-hidden />
              </a>
            </Button>
          );
        },
      },
    ] satisfies ColumnDef<LeadRow, unknown>[]).map((column) => ({ ...column, enableSorting: false })),
    [canRevealContact],
  );

  const openNew = newParam === "1";

  return (
    <div className="space-y-4">
      <InboxLive workspaceId={session.workspaceId} refreshedAt={refreshedAt} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricCard compact label="Needs action" value={counts.needsAction} href={href({ view: "needs-action" })} info={{ definition: "Active inquiries with no staff response, no next action, or a follow-up due today or overdue.", grain: "Inquiry", source: "sales.leads + sales.tasks" }} />
        <MetricCard compact label="Follow-ups due" value={counts.followUpsDue} href={href({ view: "follow-ups-due" })} info={{ definition: "Inquiries with an open reminder due today or earlier, Kuala Lumpur time.", grain: "Inquiry", source: "sales.tasks" }} />
        <MetricCard compact label="Upcoming" value={counts.upcoming} href={href({ view: "upcoming" })} info={{ definition: "Inquiries whose next reminder is after today. Scheduled work is visible immediately.", grain: "Inquiry", source: "sales.tasks" }} />
        <MetricCard compact label="Customer replied" value={counts.replied} href={href({ view: "replied" })} info={{ definition: "Inquiries with an explicitly logged customer reply. Staff messages are not replies.", grain: "Inquiry", source: "sales.leads.first_customer_reply_at" }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <nav aria-label="Inquiry views" className="flex flex-wrap gap-1">
          {PRIMARY_VIEWS.map((key) => <Link key={key} href={href({ view: key })} aria-current={view === key ? "page" : undefined} className={cn("rounded-md px-2.5 py-1.5 text-xs", view === key ? "bg-accent font-semibold" : "text-muted-foreground hover:bg-accent")}>
            {VIEW_LABELS[key]} <span className="tnum ml-1">{viewCounts[key] ?? 0}</span>
          </Link>)}
        </nav>
        <Gated permission="sales.write"><Button size="sm" className="ml-auto" onClick={() => setNewParam("1")}><Plus className="size-3.5" /> New inquiry</Button></Gated>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); filter({ q: searchText.trim() }); }}>
          <Input aria-label="Search all inquiries" placeholder="Search all names, phones, references…" value={searchText} maxLength={200} onChange={(event) => setSearchText(event.target.value)} className="h-8 w-64" />
          <Button type="submit" size="sm" variant="outline">Search</Button>
        </form>
        <Select value={filters.owner} onValueChange={(owner) => filter({ owner })}><SelectTrigger className="h-8 w-40" aria-label="Inquiry owner"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">Team leads</SelectItem><SelectItem value="mine">My leads</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>
          {members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.full_name}</SelectItem>)}
        </SelectContent></Select>
        <Select value={filters.source || "all"} onValueChange={(source) => filter({ source: source === "all" ? null : source })}><SelectTrigger className="h-8 w-36" aria-label="Inquiry source"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All sources</SelectItem>{SOURCE_CHANNELS.map((source) => <SelectItem key={source} value={source}>{SOURCE_CHANNEL[source]?.label ?? titleCase(source)}</SelectItem>)}
        </SelectContent></Select>
        <Select value={view} onValueChange={(next) => filter({ view: next })}><SelectTrigger className="h-8 w-44" aria-label="All inquiry views"><SelectValue /></SelectTrigger><SelectContent>
          {LEAD_VIEWS.map((key) => <SelectItem key={key} value={key}>{VIEW_LABELS[key]} ({viewCounts[key] ?? 0})</SelectItem>)}
        </SelectContent></Select>
        {(filters.search || filters.source || filters.owner !== "all") && <Button size="sm" variant="ghost" onClick={() => { setSearchText(""); filter({ q: null, source: null, owner: null }); }}>Clear filters</Button>}
      </div>

      <DataTable
        columns={columns}
        data={leads}
        rowKey={(r) => r.id}
        hidePagination
        initialColumnVisibility={{ contact: false, interest: false, sla: false, contact_attempts: false, product_interest: false, whatsapp: false }}
        pageSize={pageSize}
        columnToggle
        selectable={can("sales.assign")}
        bulkActions={(rows) => (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setBulkRows(rows)}>
            Assign…
          </Button>
        )}
        onRowClick={(r) => setLeadParam(r.id)}
        isRowActive={(r) => r.id === leadParam}
        emptyTitle="No inquiries in this view"
        emptyDescription="No matches in this view. Check the source, owner and search filters, or open All inquiries."
      />

      <div className="flex items-center justify-between gap-2 text-sm" aria-label="Inquiry pagination">
        <span className="tnum text-muted-foreground">{total.toLocaleString()} inquiries · page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => filter({ page: String(page - 1) })}>Previous page</Button><Button size="sm" variant="outline" disabled={page * pageSize >= total} onClick={() => filter({ page: String(page + 1) })}>Next page</Button></div>
      </div>
      <LeadDrawer
        key={selected?.id ?? "none"}
        lead={openNew ? null : selected}
        intake={selectedIntake}
        timeline={selectedTimeline}
        contact={selectedContact}
        members={members}
        initialSuggestions={selected ? suggestions[selected.id] : undefined}
        view={view}
        inCurrentView={selected ? leads.some((l) => l.id === selected.id) : true}
        onClose={() => setLeadParam(null)}
      />

      <NewInquiryDialog
        open={openNew}
        onOpenChange={(o) => setNewParam(o ? "1" : null)}
        members={members}
        locations={locations}
        defaultLocationId={session.defaultLocationId}
        defaultOwnerId={session.userId}
        onCreated={(id, s) => {
          setSuggestions((prev) => ({ ...prev, [id]: s }));
          // Keep the saved record selected even when it does not match the
          // current filter. Closing the result dialog reveals its next steps.
          void setLeadParam(id);
        }}
      />

      <Dialog open={!!bulkRows} onOpenChange={(o) => !o && setBulkRows(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk assign {bulkRows?.length ?? 0} lead{bulkRows && bulkRows.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Preview: the selected leads will be reassigned and each change is audited. Owners already set will be overwritten.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 overflow-y-auto rounded-md border text-xs">
            {bulkRows?.map((r) => (
              <li key={r.id} className="flex justify-between border-b px-2 py-1 last:border-b-0">
                <span className="truncate">{r.raw_name ?? r.raw_company ?? "Unknown"}</span>
                <span className="text-muted-foreground">{r.owner_name ?? "Unassigned"}</span>
              </li>
            ))}
          </ul>
          <Select value={bulkOwner} onValueChange={setBulkOwner}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Assign to…" /></SelectTrigger>
            <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <DisabledHint reason={bulkOwner ? null : "Choose the salesperson to assign these leads to first."}>
              <Button
                disabled={!bulkOwner || pending}
                onClick={() =>
                  start(async () => {
                    const r = await bulkAssignLeadsAction({ lead_ids: (bulkRows ?? []).map((x) => x.id), owner_id: bulkOwner });
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    toast.success(r.message);
                    setBulkRows(null);
                    router.refresh();
                  })
                }
              >
                {pending ? "Assigning…" : "Confirm"}
              </Button>
            </DisabledHint>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
