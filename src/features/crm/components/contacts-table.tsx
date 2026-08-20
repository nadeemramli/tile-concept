"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, MonoCell } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { LIFECYCLE_STATE, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatRelative, maskValue, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContactListRow } from "@/server/queries/contacts";
import type { AccountListRow } from "@/server/queries/accounts";
import type { MemberOption } from "@/features/crm/components/selects";
import { NewAccountDialog, NewContactDialog } from "@/features/crm/components/dialogs";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/badge";

const CUSTOMER_LIFECYCLE = ["active", "repeat", "reactivated"];
const CONTACT_SEGMENTS = [
  { key: "all", label: "All contacts" },
  { key: "new", label: "New" },
  { key: "prospects", label: "Prospects" },
  { key: "customers", label: "Customers" },
  { key: "lapsed", label: "Lapsed" },
  { key: "review", label: "Needs review" },
];
const ACCOUNT_SEGMENTS = [
  { key: "all", label: "All accounts" },
  { key: "mine", label: "My accounts" },
  { key: "unassigned", label: "Unassigned" },
  { key: "prospects", label: "Prospects" },
  { key: "customers", label: "Customers" },
];
const LIFECYCLE_OPTIONS = ["new", "active", "repeat", "lapsed", "reactivated"];
const ACTIVITY_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function distinct(vals: (string | null)[]): string[] {
  return Array.from(new Set(vals.filter((v): v is string => !!v))).sort();
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string | null; onChange: (v: string | null) => void; placeholder: string; options: { value: string; label: string }[] }) {
  if (options.length === 0) return null;
  return (
    <Select value={value ?? "__all"} onValueChange={(v) => onChange(v === "__all" ? null : v)}>
      <SelectTrigger className={cn("h-8 w-auto min-w-[7rem] gap-1 text-xs", value && "border-brand/50 text-foreground")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{placeholder}: all</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AccountsContactsView({ contacts, accounts, members, includeMerged }: { contacts: ContactListRow[]; accounts: AccountListRow[]; members: MemberOption[]; includeMerged: boolean }) {
  const router = useRouter();
  const { can, session } = useSession();
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("contacts"));
  const [newParam, setNewParam] = useQueryState("new", parseAsString);
  const [showMerged, setShowMerged] = useQueryState("merged", parseAsString.withOptions({ shallow: false }));
  const [view, setView] = useQueryState("view", parseAsString.withDefault("all"));
  const [fType, setFType] = useQueryState("type", parseAsString);
  const [fSource, setFSource] = useQueryState("source", parseAsString);
  const [fLife, setFLife] = useQueryState("life", parseAsString);
  const [fActivity, setFActivity] = useQueryState("activity", parseAsString);
  const memberName = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);

  // `now` is captured after mount (in an async callback, not synchronously in
  // the effect) so the activity filter stays pure at render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const segments = tab === "accounts" ? ACCOUNT_SEGMENTS : CONTACT_SEGMENTS;
  const activeView = segments.some((s) => s.key === view) ? view : "all";
  const hasQuickFilter = !!(fType || fSource || fLife || fActivity);
  const resetFilters = () => {
    setView("all");
    setFType(null);
    setFSource(null);
    setFLife(null);
    setFActivity(null);
  };

  const withinActivity = (iso: string | null) => {
    if (!fActivity || fActivity === "all" || !now) return true;
    if (!iso) return false;
    return new Date(iso).getTime() >= now - Number(fActivity) * 86400000;
  };

  const contactTypes = useMemo(() => distinct(contacts.map((c) => c.customer_type)), [contacts]);
  const contactSources = useMemo(() => distinct(contacts.map((c) => c.original_acquisition_source)), [contacts]);
  const accountTypes = useMemo(() => distinct(accounts.map((a) => a.account_type)), [accounts]);
  const accountSources = useMemo(() => distinct(accounts.map((a) => a.original_acquisition_source)), [accounts]);

  const filteredContacts = useMemo(
    () =>
      contacts.filter((c) => {
        if (activeView === "new" && c.lifecycle_state !== "new") return false;
        if (activeView === "prospects" && !(c.open_opportunities > 0)) return false;
        if (activeView === "customers" && !CUSTOMER_LIFECYCLE.includes(c.lifecycle_state)) return false;
        if (activeView === "lapsed" && c.lifecycle_state !== "lapsed") return false;
        if (activeView === "review" && !c.is_provisional) return false;
        if (fType && (c.customer_type ?? "") !== fType) return false;
        if (fSource && (c.original_acquisition_source ?? "") !== fSource) return false;
        if (fLife && c.lifecycle_state !== fLife) return false;
        if (!withinActivity(c.last_activity_at)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, activeView, fType, fSource, fLife, fActivity, now],
  );

  const filteredAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (activeView === "mine" && a.owner_id !== session.userId) return false;
        if (activeView === "unassigned" && a.owner_id) return false;
        if (activeView === "prospects" && !(a.open_opportunities > 0)) return false;
        if (activeView === "customers" && !CUSTOMER_LIFECYCLE.includes(a.lifecycle_state)) return false;
        if (fType && (a.account_type ?? "") !== fType) return false;
        if (fSource && (a.original_acquisition_source ?? "") !== fSource) return false;
        if (fLife && a.lifecycle_state !== fLife) return false;
        return true;
      }),
    [accounts, activeView, fType, fSource, fLife, session.userId],
  );

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

  const total = tab === "accounts" ? accounts.length : contacts.length;
  const shown = tab === "accounts" ? filteredAccounts.length : filteredContacts.length;
  const typeOptions = (tab === "accounts" ? accountTypes : contactTypes).map((t) => ({ value: t, label: titleCase(t) }));
  const sourceOptions = (tab === "accounts" ? accountSources : contactSources).map((s) => ({ value: s, label: titleCase(s) }));

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

      {/* Salesforce-style list views: a saved segment plus composable quick filters. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/40 px-2.5 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">View</span>
        <Select value={activeView} onValueChange={(v) => setView(v)}>
          <SelectTrigger className="h-8 w-auto min-w-[9.5rem] gap-1 text-xs font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {segments.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <FilterSelect value={fType} onChange={setFType} placeholder="Type" options={typeOptions} />
        <FilterSelect value={fSource} onChange={setFSource} placeholder="Source" options={sourceOptions} />
        <FilterSelect value={fLife} onChange={setFLife} placeholder="Lifecycle" options={LIFECYCLE_OPTIONS.map((l) => ({ value: l, label: LIFECYCLE_STATE[l]?.label ?? titleCase(l) }))} />
        {tab !== "accounts" && <FilterSelect value={fActivity} onChange={setFActivity} placeholder="Activity" options={ACTIVITY_OPTIONS} />}
        {(activeView !== "all" || hasQuickFilter) && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground" onClick={resetFilters}>
            <X className="size-3.5" aria-hidden /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {shown === total ? `${total}` : `${shown} of ${total}`}
        </span>
      </div>

      {tab === "accounts" ? (
        <DataTable columns={accountCols} data={filteredAccounts} rowKey={(r) => r.id} searchable columnToggle searchPlaceholder="Filter accounts…" onRowClick={(r) => router.push(`/sales/accounts/${r.id}`)} emptyTitle="No accounts match" emptyDescription="Adjust the view or filters, or add a new account." />
      ) : (
        <DataTable columns={contactCols} data={filteredContacts} rowKey={(r) => r.id} searchable columnToggle searchPlaceholder="Filter contacts…" onRowClick={(r) => router.push(`/sales/contacts/${r.id}`)} emptyTitle="No contacts match" emptyDescription="Adjust the view or filters, resolve an inquiry, or register a walk-in." />
      )}
      <NewContactDialog open={newParam === "contact"} onOpenChange={(o) => !o && setNewParam(null)} members={members} />
      <NewAccountDialog open={newParam === "account"} onOpenChange={(o) => !o && setNewParam(null)} members={members} />
      <span className="hidden">{showMerged}</span>
    </div>
  );
}
