"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { Gated } from "@/components/patterns/explain";
import { formatDate, titleCase } from "@/lib/format";
import type { ProjectListRow } from "@/server/queries/projects";
import type { MemberOption } from "@/features/crm/components/selects";
import { ProjectOpportunityDialog } from "@/features/crm/components/dialogs";
import { PROJECT_STATUS } from "@/features/crm/project-status";

export function ProjectsView({ projects, members }: { projects: ProjectListRow[]; members: MemberOption[] }) {
  const router = useRouter();
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
        cell: ({ row }) => (row.original.account_id ? <Link href={`/sales/accounts/${row.original.account_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.account_name}</Link> : "—"),
      },
      {
        accessorKey: "contact_name",
        header: "Primary contact",
        cell: ({ row }) => (row.original.contact_id ? <Link href={`/sales/contacts/${row.original.contact_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.contact_name}</Link> : "—"),
      },
      { accessorKey: "owner_id", header: "Owner", meta: { hint: "The salesperson responsible for the project and the customer." }, cell: ({ getValue }) => names.get(getValue<string | null>() ?? "") ?? "—" },
      { accessorKey: "opportunities_count", header: "Opps", meta: { hint: "Opportunities linked to this project, open or closed. One project can carry several quotes over time." }, cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "expected_completion", header: "Expected completion", meta: { hint: "When the site is expected to be finished. Marketing uses it to judge when a shoot could happen." }, cell: ({ getValue }) => <span className="tnum text-xs">{formatDate(getValue<string | null>())}</span> },
    ],
    [names],
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Gated permission="sales.write">
          <Button size="sm" onClick={() => setNewParam("1")}>
            <Plus className="size-3.5" aria-hidden /> New project
          </Button>
        </Gated>
      </div>
      <DataTable columns={cols} data={projects} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => router.push(`/sales/projects/${r.id}`)} emptyTitle="No projects" emptyDescription="Projects keep one customer's multiple jobs separate." />
      {newParam === "1" && <ProjectOpportunityDialog open onOpenChange={(o) => !o && setNewParam(null)} members={members} />}
    </div>
  );
}
