"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryState, parseAsString } from "nuqs";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, KanbanSquare, List, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, MoneyCell } from "@/components/patterns/data-table";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { OPPORTUNITY_STATUS, SOURCE_CHANNEL, STAGE_GROUP_TONE } from "@/lib/domain/status-maps";
import { formatDate, formatMoney, formatRelative, initials, isOverdue, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/shell/session-context";
import type { OpportunityRow, PipelineView as View, OpportunityDetail } from "@/server/queries/opportunities";
import type { StageRef } from "@/server/queries/reference";
import type { MemberOption } from "@/features/crm/components/selects";
import { StageChangeDialog } from "@/features/pipeline/components/stage-dialog";
import { OpportunityDrawer } from "@/features/pipeline/components/opportunity-drawer";

const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue next action" },
  { key: "missing-next-action", label: "Missing next action" },
  { key: "quotes", label: "Quote stages" },
  { key: "won", label: "Won (30d)" },
  { key: "lost", label: "Lost (30d)" },
  { key: "all", label: "All" },
];

export function PipelineView({ rows, stages, members, view, detail, suggestedQuoteNumber }: { rows: OpportunityRow[]; stages: StageRef[]; members: MemberOption[]; view: View; detail: OpportunityDetail | null; suggestedQuoteNumber: string }) {
  const { can, session } = useSession();
  const [, setView] = useQueryState("view", parseAsString.withDefault("open").withOptions({ shallow: false }));
  const [layout, setLayout] = useQueryState("layout", parseAsString.withDefault("board"));
  const [, setOpp] = useQueryState("opportunity", parseAsString.withOptions({ shallow: false }));
  const [moving, setMoving] = useState<{ id: string; stage: string; hasNext: boolean; target?: string } | null>(null);
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const stageByKey = useMemo(() => new Map(stages.map((s) => [s.key, s])), [stages]);
  const canMove = (o: OpportunityRow) => can("sales.write") && (can("sales.read_all") || !o.owner_id || o.owner_id === session.userId);

  const cols = useMemo<ColumnDef<OpportunityRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: "Opportunity", cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: "stage_key", header: "Stage", cell: ({ getValue }) => { const s = stageByKey.get(getValue<string>()); return <TonePill tone={STAGE_GROUP_TONE[s?.reporting_group ?? "open"] ?? "info"} label={s?.label ?? getValue<string>()} />; } },
      { accessorKey: "status", header: "Status", cell: ({ getValue }) => <StatusPill map={OPPORTUNITY_STATUS} value={getValue<string>()} /> },
      { id: "who", header: "Account / contact", accessorFn: (r) => `${r.account_name ?? ""} ${r.contact_name ?? ""}`, cell: ({ row }) => <span className="text-xs">{[row.original.account_name, row.original.contact_name].filter(Boolean).join(" · ") || "—"}</span> },
      { accessorKey: "estimated_value", header: "Value", cell: ({ row }) => <MoneyCell value={row.original.estimated_value} currency={row.original.currency} /> },
      { accessorKey: "probability_band", header: "Prob.", cell: ({ getValue }) => titleCase(getValue<string | null>() ?? "") || "—" },
      { accessorKey: "expected_close_date", header: "Exp. close", cell: ({ getValue }) => <span className="tnum text-xs">{formatDate(getValue<string | null>())}</span> },
      { accessorKey: "next_action", header: "Next action", cell: ({ getValue }) => <span className="text-xs">{getValue<string | null>() ?? <span className="text-warning">missing</span>}</span> },
      { accessorKey: "next_action_due_at", header: "Due", cell: ({ row }) => <span className={cn("tnum text-xs", isOverdue(row.original.next_action_due_at) && row.original.status === "open" ? "text-destructive" : "text-muted-foreground")}>{row.original.next_action_due_at ? formatRelative(row.original.next_action_due_at) : "—"}</span> },
      { accessorKey: "owner_id", header: "Owner", cell: ({ getValue }) => names.get(getValue<string | null>() ?? "") ?? "—" },
      { accessorKey: "source_channel", header: "Source", cell: ({ getValue }) => (getValue<string | null>() ? <StatusPill map={SOURCE_CHANNEL} value={getValue<string>()} /> : "—") },
      { accessorKey: "updated_at", header: "Updated", cell: ({ getValue }) => <span className="tnum text-xs text-muted-foreground">{formatRelative(getValue<string>())}</span> },
    ],
    [names, stageByKey],
  );

  const columns = useMemo(() => {
    const open = stages.filter((s) => s.reporting_group === "open");
    const closed = stages.filter((s) => s.reporting_group !== "open");
    return view === "all" || view === "won" || view === "lost" ? [...open, ...closed] : open;
  }, [stages, view]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v)}>
          <TabsList className="flex-wrap">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.key} value={v.key}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <span className="tnum text-xs text-muted-foreground">
            {rows.length} · {formatMoney(rows.reduce((a, r) => a + (r.estimated_value ?? 0), 0))}
          </span>
          <ToggleGroup type="single" value={layout} onValueChange={(v) => v && setLayout(v)} variant="outline" size="sm">
            <ToggleGroupItem value="board" aria-label="Board">
              <KanbanSquare className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List">
              <List className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {layout === "list" ? (
        <DataTable columns={cols} data={rows} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => setOpp(r.id)} isRowActive={(r) => r.id === detail?.id} emptyTitle="No opportunities in this view" emptyDescription="Convert an inquiry or create a project/opportunity from a contact." />
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {columns.map((s) => {
              const items = rows.filter((r) => r.stage_key === s.key);
              const sum = items.reduce((a, r) => a + (r.estimated_value ?? 0), 0);
              const closedCol = s.reporting_group !== "open";
              return (
                <section key={s.key} className={cn("flex w-64 shrink-0 flex-col rounded-lg border bg-sidebar/60", closedCol && "w-52 opacity-80")} aria-label={s.label}>
                  <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{s.label}</div>
                      <div className="tnum text-[11px] text-muted-foreground">
                        {items.length} · {formatMoney(sum)}
                      </div>
                    </div>
                    <TonePill tone={STAGE_GROUP_TONE[s.reporting_group] ?? "info"} label={String(s.position)} dot={false} />
                  </header>
                  <ul className="flex-1 space-y-2 p-2">
                    {items.length === 0 && <li className="rounded-md border border-dashed px-2 py-4 text-center text-[11px] text-muted-foreground">Empty</li>}
                    {items.map((o) => (
                      <li key={o.id}>
                        <article
                          className={cn("group rounded-md border bg-card p-2.5 text-sm shadow-sm outline-none transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring", detail?.id === o.id && "border-ring")}
                          tabIndex={0}
                          role="button"
                          onClick={() => setOpp(o.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setOpp(o.id);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="line-clamp-2 font-medium leading-tight">{o.name}</span>
                            {canMove(o) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                  <Button variant="ghost" size="icon" className="size-6 shrink-0 opacity-60 group-hover:opacity-100" aria-label="Move to stage">
                                    <MoreHorizontal className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {stages
                                    .filter((t) => t.key !== o.stage_key)
                                    .map((t) => (
                                      <DropdownMenuItem key={t.key} onSelect={() => setMoving({ id: o.id, stage: o.stage_key, hasNext: !!o.next_action && !!o.next_action_due_at, target: t.key })}>
                                        <span className="tnum mr-1 text-muted-foreground">{t.position}.</span>
                                        {t.label}
                                      </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{[o.account_name, o.contact_name].filter(Boolean).join(" · ") || "—"}</div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="tnum text-xs font-medium">{o.estimated_value !== null ? formatMoney(o.estimated_value, o.currency) : "—"}</span>
                            <Avatar className="size-5" title={names.get(o.owner_id ?? "") ?? "Unassigned"}>
                              <AvatarFallback className="text-[9px]">{initials(names.get(o.owner_id ?? "") ?? "?")}</AvatarFallback>
                            </Avatar>
                          </div>
                          <div className={cn("mt-1 truncate text-[11px]", isOverdue(o.next_action_due_at) && o.status === "open" ? "text-destructive" : "text-muted-foreground")}>
                            {o.next_action ?? <span className="text-warning">No next action</span>}
                            {o.next_action_due_at ? ` · ${formatRelative(o.next_action_due_at)}` : ""}
                          </div>
                          {o.product_interest.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {o.product_interest.map((p) => (
                                <span key={p} className="rounded border px-1 text-[10px] text-muted-foreground">
                                  {titleCase(p)}
                                </span>
                              ))}
                            </div>
                          )}
                        </article>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {moving && <StageChangeDialog key={`${moving.id}-${moving.target}`} open onOpenChange={(o) => !o && setMoving(null)} opportunityId={moving.id} currentStage={moving.stage} stages={stages} hasNextAction={moving.hasNext} initialTarget={moving.target} />}
      {detail && <OpportunityDrawer opp={detail} stages={stages} members={members} suggestedQuoteNumber={suggestedQuoteNumber} onClose={() => setOpp(null)} />}
      <p className="text-[11px] text-muted-foreground">
        Board and list share one canonical stage state. Use the ⋯ menu on a card (or the Stage button in the drawer) to move stages — no drag required.{" "}
        <Link href="/sales/projects" className="hover:underline">
          Projects
        </Link>
        <ChevronDown className="hidden" />
      </p>
    </div>
  );
}
