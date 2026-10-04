"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { Gated } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { ClaimProjectButton } from "./project-follow-up";
import { formatDate, formatRelative, titleCase } from "@/lib/format";
import type { ProjectListRow } from "@/server/queries/projects";
import type { MemberOption } from "@/features/crm/components/selects";
import { ProjectOpportunityDialog } from "@/features/crm/components/dialogs";
import { PROJECT_STATUS } from "@/features/crm/project-status";

export function ProjectsView({ projects, members }: { projects: ProjectListRow[]; members: MemberOption[] }) {
  const router = useRouter();
  const { session, can } = useSession();
  const canReadSales = can("sales.read");
  const [view, setView] = useState<"all" | "unassigned" | "mine">("all");
  const visible = projects.filter((p) => view === "all" || (view === "mine" ? p.owner_id === session.userId : !p.owner_id));
  const [newParam, setNewParam] = useQueryState("new", parseAsString);
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const cols = useMemo<ColumnDef<ProjectListRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Project", cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: "project_type", header: "Type", meta: { hint: "The kind of job: residential, commercial, showroom and so on. Set when the project is created." }, cell: ({ getValue }) => titleCase(getValue<string | null>() ?? "") || "—" },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusPill map={PROJECT_STATUS} value={getValue<string>()} /> },
      { accessorKey: "area", header: "Area", meta: { hint: "Where the site is, as a neighbourhood or town." }, cell: ({ getValue }) => getValue<string | null>() ?? "—" },
      {
        accessorKey: "account_name",
        header: "Account",
        meta: { hint: "The company or organisation the project belongs to, if any. A private homeowner has a contact but no account." },
        cell: ({ row }) => (row.original.account_id && canReadSales ? <Link href={`/sales/accounts/${row.original.account_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.account_name}</Link> : row.original.account_name ?? "—"),
      },
      {
        accessorKey: "contact_name",
        header: "Primary contact",
        cell: ({ row }) => (row.original.contact_id && canReadSales ? <Link href={`/sales/contacts/${row.original.contact_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.contact_name}</Link> : row.original.contact_name ?? "—"),
      },
      { accessorKey: "owner_id", header: "Internal handler", meta: { hint: "Who coordinates follow-up. Assignment never hides the project from the rest of the company." }, cell: ({ getValue }) => names.get(getValue<string | null>() ?? "") ?? "Unassigned" },
      { accessorKey: "opportunities_count", header: "Opps", meta: { hint: "Opportunities linked to this project, open or closed. One project can carry several quotes over time." }, cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "next_action", header: "Next follow-up", cell: ({ row }) => <div className="max-w-48 text-xs"><p className="truncate">{row.original.next_action ?? "—"}</p>{row.original.next_action_due_at && <p className="text-muted-foreground">{formatRelative(row.original.next_action_due_at)}</p>}</div> },
      { accessorKey: "last_follow_up_at", header: "Last followed up", cell: ({ row }) => <div className="text-xs">{row.original.last_follow_up_at ? <>{names.get(row.original.last_follow_up_by ?? "") ?? "Staff member"}<p className="text-muted-foreground">{formatRelative(row.original.last_follow_up_at)}</p></> : "Not yet"}</div> },
      { id: "claim", header: "", cell: ({ row }) => !row.original.owner_id ? <ClaimProjectButton id={row.original.id} version={row.original.version} /> : null },
      { accessorKey: "expected_completion", header: "Expected completion", meta: { hint: "When the site is expected to be finished. Marketing uses it to judge when a shoot could happen." }, cell: ({ getValue }) => <span className="tnum text-xs">{formatDate(getValue<string | null>())}</span> },
    ],
    [names, canReadSales],
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" aria-label="Project views">
          {(["all", "unassigned", "mine"] as const).map((key) => <Button key={key} size="sm" variant={view === key ? "secondary" : "ghost"} aria-pressed={view === key} onClick={() => setView(key)}>{key === "all" ? "All projects" : key === "unassigned" ? "Unassigned" : "My follow-ups"} <span className="ml-1 text-muted-foreground">{projects.filter((p) => key === "all" || (key === "mine" ? p.owner_id === session.userId : !p.owner_id)).length}</span></Button>)}
        </div>
        <Gated permission="projects.write">
          <Button size="sm" onClick={() => setNewParam("1")}>
            <Plus className="size-3.5" aria-hidden /> Register project
          </Button>
        </Gated>
      </div>
      <DataTable columns={cols} data={visible} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => router.push(`/sales/projects/${r.id}`)} emptyTitle="No projects" emptyDescription="Register a project with just a title. Contacts and specifications can be added later." />
      {newParam === "1" && <ProjectOpportunityDialog open onOpenChange={(o) => !o && setNewParam(null)} members={members} />}
    </div>
  );
}
