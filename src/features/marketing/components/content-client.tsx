"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill } from "@/components/patterns/status-pill";
import { ViewsBar } from "@/features/inbox/components/views-bar";
import { useSession } from "@/components/shell/session-context";
import { MarketingPill, Chips } from "@/features/marketing/components/pills";
import { PermissionExpiry } from "@/features/marketing/components/permission-summary";
import { NominateDialog } from "@/features/marketing/components/nominate-dialog";
import { OpportunityDrawer } from "@/features/marketing/components/opportunity-drawer";
import { BOOKING_STATUS, CONTENT_STATUS, CONTENT_TYPES, PERMISSION_STATUS, PRIORITY, READINESS_STATE } from "@/features/marketing/lib/status";
import type { ContentCounts, ContentOpportunityDetail, ContentOpportunityRow, SchedulableOpportunity } from "@/server/queries/marketing";
import type { ProfileRef } from "@/server/queries/reference";
import { formatDate } from "@/lib/format";

const CONTENT_TYPE_LABELS = Object.fromEntries(CONTENT_TYPES.map((c) => [c.value, c.label]));

const TABS = [
  { key: "inbox", label: "Needs review" },
  { key: "accepted", label: "Accepted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "declined", label: "Declined / deferred" },
  { key: "all", label: "All" },
];

export function ContentOpportunitiesClient({
  rows,
  counts,
  members,
  detail,
  schedulable,
  view,
}: {
  rows: ContentOpportunityRow[];
  counts: ContentCounts;
  members: ProfileRef[];
  detail: ContentOpportunityDetail | null;
  schedulable: SchedulableOpportunity[];
  view: string;
}) {
  const router = useRouter();
  const { can } = useSession();
  const [, setSelected] = useQueryState("opportunity", parseAsString);
  const [nominating, setNominating] = useState(false);
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));

  const columns: ColumnDef<ContentOpportunityRow, unknown>[] = [
    {
      id: "project",
      header: "Project",
      accessorFn: (r) => r.project_name ?? "",
      cell: ({ row }) => (
        <span className="block max-w-56 truncate font-medium">
          {row.original.project_name ?? "—"}
          {row.original.project_area && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{row.original.project_area}</span>}
        </span>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      accessorFn: (r) => r.contact_name ?? r.account_name ?? "",
      cell: ({ row }) => <span className="block max-w-40 truncate">{row.original.contact_name ?? row.original.account_name ?? "—"}</span>,
    },
    {
      id: "angle",
      header: "Story angle",
      accessorFn: (r) => r.story_angle ?? "",
      cell: ({ row }) => <span className="block max-w-56 truncate text-muted-foreground">{row.original.story_angle ?? "—"}</span>,
    },
    { id: "types", header: "Content", enableSorting: false, cell: ({ row }) => <Chips values={row.original.content_types} labels={CONTENT_TYPE_LABELS} /> },
    { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row }) => <MarketingPill map={CONTENT_STATUS} value={row.original.status} /> },
    { id: "readiness", header: "Readiness", accessorFn: (r) => r.readiness_state, cell: ({ row }) => <MarketingPill map={READINESS_STATE} value={row.original.readiness_state} /> },
    {
      id: "permission",
      header: "Permission",
      accessorFn: (r) => r.permission?.status ?? "not_requested",
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <MarketingPill map={PERMISSION_STATUS} value={row.original.permission?.status ?? "not_requested"} />
          <PermissionExpiry expiresAt={row.original.permission?.expires_at} className="text-[10px]" />
        </span>
      ),
    },
    { id: "priority", header: "Priority", accessorFn: (r) => r.priority, cell: ({ row }) => <StatusPill map={PRIORITY} value={row.original.priority} /> },
    {
      id: "window",
      header: "Target window",
      accessorFn: (r) => r.target_window_start ?? "",
      cell: ({ row }) => (
        <span className="tnum whitespace-nowrap text-xs text-muted-foreground">
          {row.original.target_window_start ? `${formatDate(row.original.target_window_start)} – ${formatDate(row.original.target_window_end)}` : "—"}
        </span>
      ),
    },
    {
      id: "shoot",
      header: "Shoot",
      accessorFn: (r) => r.booking_status ?? "",
      cell: ({ row }) =>
        row.original.booking_status ? (
          <span className="flex flex-col gap-0.5">
            <MarketingPill map={BOOKING_STATUS} value={row.original.booking_status} />
            <span className="tnum text-[10px] text-muted-foreground">{formatDate(row.original.booking_starts_at)}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not booked</span>
        ),
    },
    { id: "nominated_by", header: "Nominated by", accessorFn: (r) => names.get(r.nominated_by ?? "") ?? "", cell: ({ row }) => <span className="text-xs">{names.get(row.original.nominated_by ?? "") ?? "—"}</span> },
    { id: "owner", header: "Marketing owner", accessorFn: (r) => names.get(r.marketing_owner_id ?? "") ?? "", cell: ({ row }) => <span className="text-xs">{names.get(row.original.marketing_owner_id ?? "") ?? "Unassigned"}</span> },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Awaiting review"
          value={counts.awaiting_review}
          tone={counts.awaiting_review ? "warning" : "neutral"}
          href="/marketing/content-opportunities?view=inbox"
          info={{ definition: "Nominations still nominated, under review, or waiting on more information.", grain: "Content opportunity", source: "marketing.content_opportunities", freshness: "Live" }}
        />
        <MetricCard
          label="Permission missing"
          value={counts.permission_missing}
          tone={counts.permission_missing ? "warning" : "neutral"}
          info={{ definition: "Live nominations whose customer media permission is not approved. Assets cannot be published without it.", grain: "Content opportunity", source: "marketing.media_permission_records", freshness: "Live" }}
        />
        <MetricCard
          label="Permission expiring"
          value={counts.permission_expiring}
          tone={counts.permission_expiring ? "destructive" : "neutral"}
          info={{ definition: "Approved permissions expiring within 30 days.", grain: "Permission record", source: "marketing.media_permission_records", freshness: "Live", caveat: "An expired permission blocks new 'usable' decisions." }}
        />
        <MetricCard
          label="Ready to schedule"
          value={counts.ready_to_schedule}
          tone={counts.ready_to_schedule ? "success" : "neutral"}
          href="/marketing/content-opportunities?view=accepted"
          info={{ definition: "Accepted, project ready to shoot, and permission approved.", grain: "Content opportunity", source: "marketing", freshness: "Live" }}
        />
        <MetricCard label="Scheduled" value={counts.scheduled} href="/marketing/shoot-calendar" info={{ definition: "Nominations with a shoot booked.", grain: "Content opportunity", source: "marketing.shoot_bookings", freshness: "Live" }} />
        <MetricCard label="Completed" value={counts.completed} tone={counts.completed ? "success" : "neutral"} href="/marketing/content-opportunities?view=completed" info={{ definition: "Shoots completed and closed out.", grain: "Content opportunity", source: "marketing", freshness: "Live" }} />
      </div>

      <ViewsBar
        tabs={TABS}
        active={view}
        basePath="/marketing/content-opportunities"
        extra={
          can("marketing.write") ? (
            <Button size="sm" className="h-7" onClick={() => setNominating(true)}>
              <Plus className="size-3.5" aria-hidden /> Nominate a project
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        searchable
        columnToggle
        searchPlaceholder="Filter by project, customer, angle…"
        onRowClick={(r) => setSelected(r.id)}
        emptyTitle="Nothing here"
        emptyDescription="Sales nominates a finished customer project and it lands in this queue."
      />

      {nominating && <NominateDialog open onOpenChange={(o) => !o && setNominating(false)} />}
      {detail && (
        <OpportunityDrawer
          detail={detail}
          members={members}
          opportunities={schedulable}
          onClose={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
      {!detail && rows.length === 0 && can("marketing.write") && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Megaphone className="size-3.5" aria-hidden /> Nominations also start from a project page.
        </p>
      )}
    </>
  );
}
