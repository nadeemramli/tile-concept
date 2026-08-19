"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { LIFECYCLE_STATE, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatRelative, maskValue, titleCase } from "@/lib/format";
import type { ContactListRow } from "@/server/queries/contacts";
import type { AccountListRow } from "@/server/queries/accounts";
import type { MemberOption } from "@/features/crm/components/selects";
import { NewAccountDialog, NewContactDialog } from "@/features/crm/components/dialogs";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/badge";

export function AccountsContactsView({ contacts, accounts, members, includeMerged }: { contacts: ContactListRow[]; accounts: AccountListRow[]; members: MemberOption[]; includeMerged: boolean }) {
  const router = useRouter();
  const { can } = useSession();
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("contacts"));
  const [newParam, setNewParam] = useQueryState("new", parseAsString);
  const [showMerged, setShowMerged] = useQueryState("merged", parseAsString.withOptions({ shallow: false }));
  const memberName = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const [, force] = useState(0);
  void force;

  const contactCols = useMemo<ColumnDef<ContactListRow, unknown>[]>(
    () => [
      {
        accessorKey: "display_name",
        header: "Name",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 font-medium">
            {row.original.display_name}
            {row.original.is_provisional && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-warning">provisional</Badge>}
            {row.original.merged_into_contact_id && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">merged</Badge>}
          </span>
        ),
      },
      { accessorKey: "customer_type", header: "Type", cell: ({ getValue }) => titleCase(getValue<string | null>() ?? "") || "—" },
      { accessorKey: "primary_phone", header: "Phone", cell: ({ getValue }) => <MonoCell value={maskValue(getValue<string | null>(), "phone")} /> },
      { accessorKey: "primary_email", header: "Email", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{maskValue(getValue<string | null>(), "email")}</span> },
      { accessorKey: "lifecycle_state", header: "Lifecycle", cell: ({ getValue }) => <StatusPill map={LIFECYCLE_STATE} value={getValue<string>()} /> },
      { accessorKey: "original_acquisition_source", header: "Source", cell: ({ getValue }) => (getValue<string | null>() ? <StatusPill map={SOURCE_CHANNEL} value={getValue<string>()} /> : "—") },
      {
        accessorKey: "account_name",
        header: "Account",
        cell: ({ row }) =>
          row.original.account_id ? (
            <Link href={`/sales/accounts/${row.original.account_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.account_name}
            </Link>
          ) : (
            "—"
          ),
      },
      { accessorKey: "open_opportunities", header: "Open opps", cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "last_activity_at", header: "Last activity", cell: ({ getValue }) => <span className="tnum text-xs text-muted-foreground">{getValue<string | null>() ? formatRelative(getValue<string>()) : "—"}</span> },
      { accessorKey: "created_at", header: "Created", cell: ({ getValue }) => <span className="tnum text-xs text-muted-foreground">{formatRelative(getValue<string>())}</span> },
    ],
    [],
  );

  const accountCols = useMemo<ColumnDef<AccountListRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}{row.original.merged_into_account_id && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px] font-normal">merged</Badge>}</span> },
      { accessorKey: "account_type", header: "Type", cell: ({ getValue }) => titleCase(getValue<string | null>() ?? "") || "—" },
      { accessorKey: "registration_number", header: "Reg. no", cell: ({ getValue }) => <MonoCell value={getValue<string | null>()} /> },
      { accessorKey: "owner_id", header: "Owner", cell: ({ getValue }) => memberName.get(getValue<string | null>() ?? "") ?? "—" },
      { accessorKey: "contacts_count", header: "Contacts", cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "projects_count", header: "Projects", cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "open_opportunities", header: "Open opps", cell: ({ getValue }) => <span className="tnum">{getValue<number>()}</span> },
      { accessorKey: "lifecycle_state", header: "Lifecycle", cell: ({ getValue }) => <StatusPill map={LIFECYCLE_STATE} value={getValue<string>()} /> },
      { accessorKey: "original_acquisition_source", header: "Source", cell: ({ getValue }) => (getValue<string | null>() ? <StatusPill map={SOURCE_CHANNEL} value={getValue<string>()} /> : "—") },
    ],
    [memberName],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v)}>
          <TabsList>
            <TabsTrigger value="contacts">Contacts <span className="tnum ml-1 text-muted-foreground">{contacts.length}</span></TabsTrigger>
            <TabsTrigger value="accounts">Accounts <span className="tnum ml-1 text-muted-foreground">{accounts.length}</span></TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={includeMerged} onCheckedChange={(v) => setShowMerged(v ? "1" : null)} /> Show merged
          </label>
          {can("sales.write") && (
            <>
              <Button size="sm" variant="outline" onClick={() => setNewParam("account")}>
                <Plus className="size-3.5" aria-hidden /> Account
              </Button>
              <Button size="sm" onClick={() => setNewParam("contact")}>
                <Plus className="size-3.5" aria-hidden /> Contact
              </Button>
            </>
          )}
        </div>
      </div>
      {tab === "accounts" ? (
        <DataTable columns={accountCols} data={accounts} rowKey={(r) => r.id} searchable columnToggle searchPlaceholder="Filter accounts…" onRowClick={(r) => router.push(`/sales/accounts/${r.id}`)} emptyTitle="No accounts" emptyDescription="Companies, contractors, designers and developers appear here." />
      ) : (
        <DataTable columns={contactCols} data={contacts} rowKey={(r) => r.id} searchable columnToggle searchPlaceholder="Filter contacts…" onRowClick={(r) => router.push(`/sales/contacts/${r.id}`)} emptyTitle="No contacts" emptyDescription="Resolve an inquiry or register a walk-in to create the first contact." />
      )}
      <NewContactDialog open={newParam === "contact"} onOpenChange={(o) => !o && setNewParam(null)} members={members} />
      <NewAccountDialog open={newParam === "account"} onOpenChange={(o) => !o && setNewParam(null)} members={members} />
      <span className="hidden">{showMerged}</span>
    </div>
  );
}
