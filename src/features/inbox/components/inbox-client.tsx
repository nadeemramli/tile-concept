"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { LEAD_STATUS, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatRelative, isOverdue, maskValue, titleCase } from "@/lib/format";
import { buildLeadWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { useSession } from "@/components/shell/session-context";
import { ViewsBar } from "@/features/inbox/components/views-bar";
import { LeadDrawer } from "@/features/inbox/components/lead-drawer";
import { NewInquiryDialog } from "@/features/inbox/components/new-inquiry-dialog";
import { bulkAssignLeadsAction } from "@/server/commands/leads";
import type { IdentityCandidate, InboxCounts, IntakeEventRow, LeadRow } from "@/features/inbox/types";
import type { LeadView } from "@/features/inbox/schema";
import type { ProfileRef } from "@/server/queries/reference";
import type { TimelineItem } from "@/components/patterns/timeline";
import { cn } from "@/lib/utils";

const VIEW_MAP: Record<string, LeadView> = {
  New: "new",
  Unassigned: "unassigned",
  "My leads": "mine",
  "No response": "no-response",
  "SLA overdue": "follow-up",
  "Follow-ups due": "follow-ups-due",
  "Duplicate review": "duplicates",
  Qualified: "qualified",
  Disqualified: "disqualified",
  All: "all",
};

interface Props {
  view: LeadView;
  leads: LeadRow[];
  counts: InboxCounts;
  members: ProfileRef[];
  locations: { id: string; name: string }[];
  savedViews: { id: string; name: string }[];
  selected: LeadRow | null;
  selectedIntake: IntakeEventRow[];
  selectedTimeline: TimelineItem[];
  selectedContact: { id: string; display_name: string; lifecycle_state: string; customer_type: string | null } | null;
}

export function InboxClient({ view, leads, counts, members, locations, savedViews, selected, selectedIntake, selectedTimeline, selectedContact }: Props) {
  const router = useRouter();
  const { session, can } = useSession();
  const [leadParam, setLeadParam] = useQueryState("lead", { shallow: false });
  const [newParam, setNewParam] = useQueryState("new");
  const [suggestions, setSuggestions] = useState<Record<string, IdentityCandidate[]>>({});
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkRows, setBulkRows] = useState<LeadRow[] | null>(null);
  const [pending, start] = useTransition();
  const canRevealContact = can("contact.reveal");

  const tabs = useMemo(() => {
    const countFor: Record<LeadView, number | undefined> = {
      new: counts.new,
      unassigned: counts.unassigned,
      mine: counts.mine,
      "no-response": counts.noResponse,
      "follow-up": counts.followUp,
      "follow-ups-due": counts.followUpsDue,
      duplicates: counts.duplicates,
      qualified: undefined,
      disqualified: undefined,
      all: undefined,
      aging: counts.aging,
    };
    const base = savedViews.length
      ? savedViews.map((v) => ({ key: VIEW_MAP[v.name] ?? "all", label: v.name }))
      : Object.entries(VIEW_MAP).map(([label, key]) => ({ key, label }));
    const list = base.map((t) => ({ ...t, count: countFor[t.key] }));
    if (view === "aging" && !list.some((t) => t.key === "aging")) list.push({ key: "aging", label: "Aging", count: counts.aging });
    return list;
  }, [savedViews, counts, view]);

  const columns = useMemo<ColumnDef<LeadRow, unknown>[]>(
    () => [
      { accessorKey: "created_at", header: "Received", cell: ({ row }) => <span className="tnum text-muted-foreground">{formatRelative(row.original.created_at)}</span> },
      {
        accessorKey: "source_channel",
        header: "Source",
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
          </div>
        ),
      },
      {
        id: "contact",
        header: "Phone / email",
        accessorFn: (r) => `${r.raw_phone_normalized ?? ""} ${r.raw_email ?? ""}`,
        cell: ({ row }) => (
          <div className="font-mono text-[12px] tnum">
            <div>{maskValue(row.original.raw_phone_normalized ?? row.original.raw_phone, "phone")}</div>
            {row.original.raw_email && <div className="text-muted-foreground">{maskValue(row.original.raw_email, "email")}</div>}
          </div>
        ),
      },
      { accessorKey: "interest", header: "Interest", cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.interest ?? ""}>{row.original.interest ?? "—"}</span> },
      { accessorKey: "owner_name", header: "Owner", cell: ({ row }) => row.original.owner_name ?? <TonePill tone="warning" label="Unassigned" /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={LEAD_STATUS} value={row.original.status} /> },
      {
        id: "sla",
        header: "First response",
        accessorFn: (r) => r.first_response_at ?? r.first_response_due_at ?? "",
        cell: ({ row }) => {
          const l = row.original;
          if (l.first_response_at) return <span className="tnum text-success">responded {formatRelative(l.first_response_at)}</span>;
          if (["disqualified", "converted", "duplicate"].includes(l.status)) return <span className="text-muted-foreground">—</span>;
          const over = isOverdue(l.first_response_due_at);
          return <span className={cn("tnum", over ? "font-medium text-destructive" : "text-muted-foreground")}>{l.first_response_due_at ? `due ${formatRelative(l.first_response_due_at)}` : "no SLA"}</span>;
        },
      },
      {
        id: "next_follow_up",
        header: "Next follow-up",
        accessorFn: (r) => r.next_follow_up_at ?? "",
        cell: ({ row }) => {
          const at = row.original.next_follow_up_at;
          if (!at) return <span className="text-muted-foreground">—</span>;
          const over = isOverdue(at);
          return <span className={cn("tnum", over ? "font-medium text-destructive" : "text-muted-foreground")}>due {formatRelative(at)}</span>;
        },
      },
      { accessorKey: "contact_attempts", header: "Attempts", cell: ({ row }) => <span className="tnum">{row.original.contact_attempts}</span> },
      { accessorKey: "product_interest", header: "Products", cell: ({ row }) => <span className="text-muted-foreground">{row.original.product_interest.map(titleCase).join(", ") || "—"}</span> },
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
    ],
    [canRevealContact],
  );

  const openNew = newParam === "1";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-7">
        <MetricCard compact label="New" value={counts.new} href="/sales/inbox?view=new" info={{ definition: "Leads in status New.", grain: "Lead", source: "sales.leads" }} />
        <MetricCard compact label="Unassigned" value={counts.unassigned} tone={counts.unassigned ? "warning" : "neutral"} href="/sales/inbox?view=unassigned" info={{ definition: "Active leads with no owner.", grain: "Lead", source: "sales.leads" }} />
        <MetricCard compact label="No response" value={counts.noResponse} tone={counts.noResponse ? "warning" : "neutral"} href="/sales/inbox?view=no-response" info={{ definition: "New leads with no logged response.", grain: "Lead", source: "sales.leads" }} />
        <MetricCard compact label="SLA overdue" value={counts.followUp} tone={counts.followUp ? "destructive" : "neutral"} href="/sales/inbox?view=follow-up" info={{ definition: "Active leads whose first-response due time has passed without a response.", grain: "Lead", source: "sales.leads" }} />
        <MetricCard compact label="Follow-ups due" value={counts.followUpsDue} tone={counts.followUpsDue ? "warning" : "neutral"} href="/sales/inbox?view=follow-ups-due" info={{ definition: "Leads with an open follow-up task due today or overdue (tasks visible to you).", grain: "Lead", source: "sales.tasks" }} />
        <MetricCard compact label="Aging (>2d)" value={counts.aging} tone={counts.aging ? "warning" : "neutral"} href="/sales/inbox?view=aging" info={{ definition: "Leads still New/Contact attempted more than 2 days after creation.", grain: "Lead", source: "sales.leads" }} />
        <MetricCard compact label="Duplicate review" value={counts.duplicates} href="/sales/inbox?view=duplicates" info={{ definition: "Leads marked duplicate or linked to another lead.", grain: "Lead", source: "sales.leads" }} />
      </div>

      <ViewsBar
        tabs={tabs}
        active={view}
        basePath="/sales/inbox"
        extra={
          can("sales.write") ? (
            <Button size="sm" className="h-7" onClick={() => setNewParam("1")}>
              <Plus className="size-3.5" aria-hidden /> New inquiry
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={leads}
        rowKey={(r) => r.id}
        searchable
        searchPlaceholder="Filter by name, company, phone…"
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
        emptyDescription="Inquiries arrive from connectors or manual capture. Create one or switch views."
        initialSorting={[{ id: "created_at", desc: true }]}
      />

      <LeadDrawer
        lead={selected}
        intake={selectedIntake}
        timeline={selectedTimeline}
        contact={selectedContact}
        members={members}
        initialSuggestions={selected ? suggestions[selected.id] : undefined}
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
          router.refresh();
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
