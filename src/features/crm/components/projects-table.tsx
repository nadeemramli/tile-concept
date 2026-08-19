"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/patterns/data-table";
import { TonePill } from "@/components/patterns/status-pill";
import { formatDate, titleCase } from "@/lib/format";
import type { ProjectListRow } from "@/server/queries/projects";
import type { MemberOption } from "@/features/crm/components/selects";
import { ProjectOpportunityDialog } from "@/features/crm/components/dialogs";
import { useSession } from "@/components/shell/session-context";

const STATUS_TONE = { planning: "neutral", active: "info", completed: "success", on_hold: "warning", cancelled: "destructive" } as const;

export function ProjectsView({ projects, members }: { projects: ProjectListRow[]; members: MemberOption[] }) {
  const router = useRouter();
  const { can } = useSession();
  const [newParam, setNewParam] = useQueryState("new", parseAsString);
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const cols = useMemo<ColumnDef<ProjectListRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Project", cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: "project_type", header: "Type", cell: ({ getValue }) => titleCase(getValue<string | null>() ?? "") || "—" },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <TonePill tone={STATUS_TONE[getValue<keyof typeof STATUS_TONE>()] ?? "neutral"} label={titleCase(getValue<string>())} /> },
      { accessorKey: "area", header: "Area", cell: ({ getValue }) => getValue<string | null>() ?? "—" },
      {
        accessorKey: "account_name",
        header: "Account",
        cell: ({ row }) => (row.original.account_id ? <Link href={`/sales/accounts/${row.original.account_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.account_name}</Link> : "—"),
      },
      {
        accessorKey: "contact_name",
        header: "Primary contact",
        cell: ({ row }) => (row.original.contact_id ? <Link href={`/sales/contacts/${row.original.contact_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.contact_name}</Link> : "—"),
      },
      { accessorKey: "owner_id", header: "Owner", cell: ({ getValue }) => names.get(getValue<string | null>() ?? "") ?? "—" },
      { accessorKey: "opportunities_count", header: "Opps", cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "expected_completion", header: "Expected completion", cell: ({ getValue }) => <span className="tnum text-xs">{formatDate(getValue<string | null>())}</span> },
    ],
    [names],
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {can("sales.write") && (
          <Button size="sm" onClick={() => setNewParam("1")}>
            <Plus className="size-3.5" aria-hidden /> New project
          </Button>
        )}
      </div>
      <DataTable columns={cols} data={projects} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => router.push(`/sales/projects/${r.id}`)} emptyTitle="No projects" emptyDescription="Projects keep one customer's multiple jobs separate." />
      <ProjectOpportunityDialog open={newParam === "1"} onOpenChange={(o) => !o && setNewParam(null)} members={members} />
    </div>
  );
}
