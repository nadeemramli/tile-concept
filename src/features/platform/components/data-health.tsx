"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { ISSUE_SEVERITY, ISSUE_STATUS, CONNECTOR_STATUS } from "@/lib/domain/status-maps";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/patterns/states";
import { formatRelative } from "@/lib/format";
import type { IssueRow, IntegrationRow } from "@/server/queries/platform";
import { updateIssueStatusAction } from "@/server/commands/platform";
import { useAction } from "@/features/catalog/use-action";
import { FreshnessBadge } from "@/components/patterns/freshness-badge";

interface Props {
  issues: IssueRow[];
  integrations: IntegrationRow[];
  counts: { duplicates: number; unreviewed: number; conflicted: number; pendingReviews: number };
}

export function DataHealthTabs({ issues, integrations, counts }: Props) {
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("issues"));
  const [action, setAction] = useState<{ issue: IssueRow; status: "acknowledged" | "resolved" | "ignored" | "open" } | null>(null);
  const [note, setNote] = useState("");
  const update = useAction(updateIssueStatusAction, {
    onSuccess: () => {
      setAction(null);
      setNote("");
    },
  });

  const columns = useMemo<ColumnDef<IssueRow, unknown>[]>(
    () => [
      { accessorKey: "issue_type", header: "Type", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.issue_type}</span> },
      { accessorKey: "severity", header: "Severity", cell: ({ row }) => <StatusPill map={ISSUE_SEVERITY} value={row.original.severity} /> },
      { accessorKey: "summary", header: "Summary", cell: ({ row }) => <span className="max-w-96 truncate" title={row.original.summary}>{row.original.summary}</span> },
      {
        id: "object",
        header: "Object",
        cell: ({ row }) =>
          row.original.href ? (
            <Link href={row.original.href} className="font-mono text-[12px] hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.object_type} · {row.original.object_id?.slice(0, 8)}
            </Link>
          ) : (
            <span className="font-mono text-[12px] text-muted-foreground">{row.original.object_type ?? "—"}{row.original.object_id ? ` · ${row.original.object_id.slice(0, 8)}` : ""}</span>
          ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={ISSUE_STATUS} value={row.original.status} /> },
      { accessorKey: "assigned_name", header: "Assigned", cell: ({ row }) => row.original.assigned_name ?? "—" },
      { accessorKey: "created_at", header: "Opened", cell: ({ row }) => <span className="tnum text-muted-foreground">{formatRelative(row.original.created_at)}</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const i = row.original;
          return (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              {i.status === "open" && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setAction({ issue: i, status: "acknowledged" })}>
                  Acknowledge
                </Button>
              )}
              {(i.status === "open" || i.status === "acknowledged") && (
                <>
                  <Button size="sm" className="h-6 px-2 text-xs" onClick={() => setAction({ issue: i, status: "resolved" })}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setAction({ issue: i, status: "ignored" })}>
                    Ignore
                  </Button>
                </>
              )}
              {(i.status === "resolved" || i.status === "ignored") && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAction({ issue: i, status: "open" })}>
                  Reopen
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="issues">Data quality issues ({issues.filter((i) => i.status === "open").length})</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicate candidates ({counts.duplicates})</TabsTrigger>
          <TabsTrigger value="unreviewed">Unreviewed products ({counts.unreviewed})</TabsTrigger>
          <TabsTrigger value="prices">Conflicted prices ({counts.conflicted})</TabsTrigger>
          <TabsTrigger value="connectors">Connectors</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "issues" && <DataTable columns={columns} data={issues} rowKey={(r) => r.id} searchable columnToggle emptyTitle="No data quality issues" emptyDescription="Duplicates, unmapped units, overlapping prices and stale snapshots will be queued here." initialSorting={[{ id: "status", desc: false }]} />}
      {tab === "duplicates" && (
        <EmptyState title={`${counts.duplicates} suggested identity match${counts.duplicates === 1 ? "" : "es"} awaiting review`} description="Ambiguous people or companies are never merged automatically. Review candidate pairs with reason codes, then confirm or reject." action={{ label: "Open Identity Review", href: "/sales/identity-review" }} />
      )}
      {tab === "unreviewed" && <EmptyState title={`${counts.unreviewed} product${counts.unreviewed === 1 ? "" : "s"} not yet reviewed`} description="A catalog operator confirms attributes and provenance before a product is trusted for quoting." action={{ label: "Open catalog · Unreviewed", href: "/merchandise/catalog?view=unreviewed" }} />}
      {tab === "prices" && <EmptyState title={`${counts.conflicted} conflicted price${counts.conflicted === 1 ? "" : "s"}`} description="Overlapping current prices for the same scope are blocked until resolved with an audited override or date change." action={{ label: "Open pricing · Conflicted", href: "/merchandise/pricing?state=conflicted" }} />}
      {tab === "connectors" && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {integrations.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.provider} · {c.direction}</div>
              </div>
              <div className="flex items-center gap-2">
                <FreshnessBadge lastSuccessAt={c.last_success_at} slaMinutes={240} />
                <StatusPill map={CONNECTOR_STATUS} value={c.status} />
              </div>
            </div>
          ))}
          <Link href="/platform/integrations" className="flex items-center justify-center rounded-lg border border-dashed px-3 py-2 text-sm text-info hover:underline">
            Manage integrations →
          </Link>
        </div>
      )}

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{action?.status === "open" ? "Reopen" : action?.status} issue</DialogTitle>
            <DialogDescription>{action?.issue.summary}</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={action?.status === "resolved" ? "What was done? (recommended)" : "Optional note"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button disabled={update.pending || !action} onClick={() => action && update.run(action.issue.id, action.status, note)}>
              {update.pending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
