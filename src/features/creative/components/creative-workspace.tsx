"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Film, ListFilter, Plus, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/states";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { Gated, InfoTip } from "@/components/patterns/explain";
import { Field } from "@/components/patterns/field";
import { useSession } from "@/components/shell/session-context";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { addDays, addMonths, dayKey, dayLabel, eachDay, monthLabel, startOfMonth, startOfWeek } from "@/features/marketing/lib/time";
import { CREATIVE_STAGES, type CreativeCalendar, type CreativeCard, type CreativeDetail, type CreativeList, type CreativeOptions, type CreativeStage, type PublicationCard } from "../types";
import { CHANNEL_LABELS, CREATIVE_CONDITION_META, CREATIVE_SELECT_CLASS, CREATIVE_STAGE_META, FORMAT_LABELS, PUBLICATION_META, TEMPLATE_META, creativeHref, creativeWeekPreset, type CalendarMode, creativeRiskLabel } from "../presentation";
import { CreateCreativeDialog } from "./creative-forms";
import { CreativeDrawer } from "./creative-drawer";

export interface CreativeWorkspaceProps {
  view: "board" | "calendar" | "my-work" | "all";
  list: CreativeList;
  columns: { stage: CreativeStage; data: CreativeList }[];
  calendar: CreativeCalendar | null;
  options: CreativeOptions;
  detail: CreativeDetail | null;
  selectedMissing: boolean;
  initialBrief?: { title: string; key_message: string; mandatory_coverage: string };
  today: string;
  calendarMode: CalendarMode;
  anchor: string;
  range: { from: string; to: string };
  basis: "target" | "scheduled" | "published";
}

function Pagination({ total, page, size, onPage, label = "creatives", compact = false }: { total: number; page: number; size: number; onPage: (p: number) => void; label?: string; compact?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className={cn("flex items-center justify-between gap-2 text-xs text-muted-foreground", !compact && "rounded-lg border px-3 py-2")}><span>{compact ? `${total} total · ${page}/${pages}` : `${total} ${label} · page ${page} of ${pages}`}</span><div className="flex gap-1"><Button aria-label={`Previous page of ${label}`} size="icon" variant="outline" className="size-7" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-3.5" /></Button><Button aria-label={`Next page of ${label}`} size="icon" variant="outline" className="size-7" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-3.5" /></Button></div></div>;
}

function CreativeCardButton({ item, open, today }: { item: CreativeCard; open: (id: string) => void; today: string }) {
  const overdue = item.production_due && item.production_due < today && !["approved", "scheduled", "published"].includes(item.stage);
  return <button onClick={() => open(item.id)} className="w-full space-y-3 rounded-lg border bg-card p-3 text-left shadow-sm outline-none transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between gap-2"><span className="line-clamp-3 break-words text-sm font-semibold leading-snug">{item.title}</span>{item.priority === "high" && <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">High</span>}</div>
    <p className="text-[11px] text-muted-foreground">{item.format ? FORMAT_LABELS[item.format] : "Format not set"} · {TEMPLATE_META[item.template].label}</p>
    <div className="flex flex-wrap gap-1">{item.channels.map((channel) => <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground" key={channel}>{CHANNEL_LABELS[channel] ?? channel}</span>)}</div>
    {item.condition !== "active" && <span className={cn("block rounded-md p-2 text-xs", item.condition === "blocked" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>{CREATIVE_CONDITION_META[item.condition].label}{item.blocker_reason ? ` · ${item.blocker_reason}` : ""}</span>}
    <div className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><UserRound className="size-3" aria-hidden />{item.owner_name ?? "Unassigned · triage needed"}</span><span className={cn("flex items-center gap-1.5", overdue && "text-destructive")}><Clock3 className="size-3" aria-hidden />{item.production_due ? `Production ${formatDate(item.production_due)}${overdue ? " · overdue" : ""}` : "Production date not set"}</span><span className="flex items-center gap-1.5"><CalendarDays className="size-3" aria-hidden />{item.next_target_date ? `Release target ${formatDate(item.next_target_date)}` : item.stage === "published" ? "All releases published" : "Release unscheduled"}</span></div>
    {(item.next_action || item.risks.length > 0) && <p className="line-clamp-2 text-xs text-muted-foreground">{item.next_action ? `Next: ${item.next_action}` : creativeRiskLabel(item.risks[0])}</p>}
    {item.publication_count > 0 && <p className="text-[10px] text-muted-foreground">{item.published_count}/{item.publication_count} channel releases published</p>}
  </button>;
}

function CalendarPublications({ calendar, range, anchor, mode, basis, open, onPage, today }: { calendar: CreativeCalendar; range: { from: string; to: string }; anchor: string; mode: CalendarMode; basis: "target" | "scheduled" | "published"; open: (id: string) => void; onPage: (page: number) => void; today: string }) {
  const groups = new Map<string, PublicationCard[]>();
  for (const pub of calendar.items) {
    const date = basis === "target" ? pub.target_date : basis === "scheduled" ? (pub.scheduled_at ? dayKey(pub.scheduled_at) : null) : pub.published_at ? dayKey(pub.published_at) : null;
    if (date) groups.set(date, [...(groups.get(date) ?? []), pub]);
  }
  const start = mode === "month" ? startOfWeek(startOfMonth(anchor)) : range.from;
  const days = mode === "month" ? eachDay(start, addDays(start, 41)) : eachDay(range.from, addDays(range.to, -1));
  const entry = (pub: PublicationCard, compact = false) => <button key={pub.id} onClick={() => open(pub.creative_id)} className={cn("w-full space-y-1 rounded-md border bg-card p-2 text-left outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring", compact && "text-xs")}><span className="block text-[10px] font-medium text-info">{CHANNEL_LABELS[pub.channel]} · {PUBLICATION_META[pub.status].label}</span><span className="block break-words text-xs font-semibold">{pub.title}</span><span className="block text-[10px] text-muted-foreground">{pub.account_label}</span>{pub.stage !== "approved" && pub.status === "planned" && <span className="block text-[10px] text-warning">Production: {CREATIVE_STAGE_META[pub.stage].label}</span>}{(pub.risks.length > 0 || pub.condition !== "active") && <span className="block text-[10px] text-warning">Needs attention</span>}</button>;
  return <div className="space-y-3">
    {calendar.total > calendar.page_size && <p role="status" className="rounded-md border border-warning/25 bg-warning/5 p-3 text-xs">Showing this page’s {calendar.items.length} of {calendar.total} channel releases in the selected range. Use the page controls to see the remainder; totals cover the complete range.</p>}
    {calendar.total === 0 ? <EmptyState icon={CalendarDays} title="No releases in this range" description="Add a release plan from a creative’s Publishing tab. Undated work stays available under Unscheduled and All Creatives." /> : <>
      {mode !== "agenda" && <div className="hidden overflow-hidden rounded-lg border lg:block"><div className="grid grid-cols-7 border-b bg-muted/30">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-3 py-2 text-xs font-medium text-muted-foreground">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((day) => <section key={day} aria-label={dayLabel(day)} className={cn("min-h-32 min-w-0 space-y-2 border-r border-b p-2", day < range.from || day >= range.to ? "bg-muted/15 text-muted-foreground/50" : "bg-background", day === today && "bg-primary/5")}><p className={cn("flex size-6 items-center justify-center rounded-full text-xs", day === today && "bg-primary font-semibold text-primary-foreground")}>{Number(day.slice(-2))}</p>{(groups.get(day) ?? []).map((pub) => entry(pub, true))}</section>)}</div></div>}
      <div className={cn("space-y-4", mode !== "agenda" && "lg:hidden")}>{[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, pubs]) => <section key={day} className="space-y-2"><h3 className="text-sm font-semibold">{dayLabel(day)}</h3><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pubs.map((pub) => entry(pub))}</div></section>)}</div>
    </>}
    <Pagination total={calendar.total} page={calendar.page} size={calendar.page_size} onPage={onPage} label="channel releases" />
  </div>;
}

export function CreativeWorkspace(props: CreativeWorkspaceProps) {
  const { view, list, columns, calendar, options, detail, selectedMissing, today, calendarMode, anchor, range, basis } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [pending, startTransition] = useTransition();
  const { session } = useSession();
  const creating = searchParams.get("new") === "1";
  const navigate = (patch: Record<string, string | number | null | undefined>, resetPages = false) => {
    const params = new URLSearchParams(search);
    if (resetPages) for (const key of [...params.keys()]) if (key === "page" || key.startsWith("page_")) params.delete(key);
    startTransition(() => router.push(creativeHref(params.toString(), patch), { scroll: false }));
  };
  useEffect(() => {
    if (detail || creating) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [detail, creating, router]);
  const open = (id: string) => navigate({ creative: id, new: null });
  const currentParams = Object.fromEntries(searchParams.entries());
  const total = Object.values(list.stage_counts).reduce((a, b) => a + b, 0);
  const tableColumns: ColumnDef<CreativeCard, unknown>[] = [
    { accessorKey: "title", header: "Creative", cell: ({ row }) => <div className="max-w-72"><p className="truncate font-medium">{row.original.title}</p><p className="text-[11px] text-muted-foreground">{TEMPLATE_META[row.original.template].label}</p></div> },
    { accessorKey: "stage", header: "Stage", meta: { hint: "Scheduled and Published are derived from active channel release plans." }, cell: ({ row }) => <StatusPill map={CREATIVE_STAGE_META} value={row.original.stage} /> },
    { accessorKey: "condition", header: "Work status", cell: ({ row }) => <StatusPill map={CREATIVE_CONDITION_META} value={row.original.condition} /> },
    { accessorKey: "owner_name", header: "Owner", cell: ({ row }) => row.original.owner_name ?? "Unassigned" },
    { accessorKey: "reviewer_name", header: "Reviewer", cell: ({ row }) => row.original.reviewer_name ?? "Unassigned" },
    { accessorKey: "production_due", header: "Production due", cell: ({ row }) => formatDate(row.original.production_due) },
    { accessorKey: "next_target_date", header: "Next release target", cell: ({ row }) => row.original.next_target_date ? formatDate(row.original.next_target_date) : "Unscheduled" },
  ];
  return <PageBody className="min-w-0">
    <PageHeader title="Creative" eyebrow="Marketing / Production workspace" description="Turn a clear brief into approved content, then plan and track every channel release."><Button size="sm" variant="outline" onClick={() => startTransition(() => router.refresh())} disabled={pending}><RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden />Refresh</Button><Gated permission="marketing.write"><Button size="sm" onClick={() => navigate({ new: "1", creative: null })}><Plus className="size-3.5" aria-hidden />New creative</Button></Gated></PageHeader>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard label={calendar ? "Channel releases" : "Matching creatives"} value={calendar?.total ?? total} info={{ definition: calendar ? "Release plans matching the selected date basis and owner in this range. Each channel/account release counts separately." : "All creatives matching the current filters, across every page and production stage.", grain: calendar ? "Publication plan" : "Creative deliverable", source: "Creative workflow", freshness: "Refreshes every 30 seconds while browsing" }} />
      <MetricCard label={calendar ? "Unique creatives" : "Awaiting review"} value={calendar?.unique_creatives ?? list.stage_counts.review ?? 0} tone="ai" info={{ definition: calendar ? "Distinct deliverables behind the channel release plans in this range. One creative may have several releases." : "Creatives in Review that match the current filters, including pages not currently visible.", grain: "Creative deliverable", source: "Creative workflow" }} />
      <MetricCard label="In production" value={list.stage_counts.in_production ?? 0} tone="info" info={{ definition: "Matching creatives actively in the editing, writing or design stage. Review and approved work are separate.", grain: "Creative deliverable", source: "Creative workflow", caveat: calendar ? "This production count covers all active work, independently of the release date range." : undefined }} />
      <MetricCard label="Awaiting release" value={list.stage_counts.approved ?? 0} tone="success" info={{ definition: "Matching approved creatives whose active release plans are not all scheduled or published. Creatives with no release plan remain here.", grain: "Creative deliverable", source: "Creative workflow", caveat: calendar ? "This production count covers all active work, independently of the release date range." : undefined }} />
    </div>
    <nav aria-label="Creative views" className="flex flex-wrap items-center gap-1 border-b pb-2">{[{ key: "board", label: "Production Board" }, { key: "calendar", label: "Content Calendar" }, { key: "my-work", label: "My Work" }, { key: "all", label: "All Creatives" }].map((item) => <Button key={item.key} size="sm" variant={view === item.key ? "secondary" : "ghost"} aria-current={view === item.key ? "page" : undefined} onClick={() => navigate({ view: item.key, creative: null, new: null, condition: null, stage: null, source: null, shoot: null, output: null, unscheduled: null, from: null, to: null }, true)}>{item.label}</Button>)}<span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">{pending ? "Updating…" : "MYT · Asia/Kuala_Lumpur"}<InfoTip label="Creative refresh" content="Lists refresh every 30 seconds while visible. Open record drawers are kept stable so drafts are not overwritten. Use Refresh to fetch the latest saved version." /></span></nav>
    <form key={`${view}:${searchParams.get("q")}:${searchParams.get("owner")}:${searchParams.get("condition")}:${searchParams.get("from")}:${searchParams.get("to")}`} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card/50 p-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); navigate({ q: String(fd.get("q") ?? ""), owner: String(fd.get("owner") ?? ""), condition: String(fd.get("condition") ?? ""), stage: String(fd.get("stage") ?? ""), from: String(fd.get("from") ?? ""), to: String(fd.get("to") ?? ""), date_basis: String(fd.get("date_basis") ?? "production_due"), creative: null }, true); }}>
      {view !== "calendar" && <Field label="Search creatives" htmlFor="creative-search" className="min-w-40 flex-1"><Input id="creative-search" name="q" placeholder="Creative title…" defaultValue={currentParams.q ?? ""} maxLength={200} /></Field>}
      <Field label="Owner" htmlFor="creative-owner" className="w-full sm:w-44"><select id="creative-owner" name="owner" className={CREATIVE_SELECT_CLASS} defaultValue={currentParams.owner ?? ""}><option value="">All owners</option>{options.members.filter((m) => m.can_write).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      {view !== "calendar" && <>
        <Field label="Work status" htmlFor="creative-condition" className="w-full sm:w-36"><select id="creative-condition" name="condition" className={CREATIVE_SELECT_CLASS} defaultValue={currentParams.condition ?? (view === "all" ? "all" : "")}><option value="">Open work</option><option value="active">Active only</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="all">All, including cancelled</option></select></Field>
        <Field label="Production stage" htmlFor="creative-stage" className="w-full sm:w-36"><select id="creative-stage" name="stage" className={CREATIVE_SELECT_CLASS} defaultValue={currentParams.stage ?? ""}><option value="">All stages</option>{CREATIVE_STAGES.map((stage) => <option key={stage} value={stage}>{CREATIVE_STAGE_META[stage].label}</option>)}</select></Field>
        <details className="w-full rounded border px-3 py-2 text-xs sm:w-auto"><summary className="cursor-pointer text-muted-foreground">Production / review dates</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field label="Date basis" htmlFor="date_basis"><select id="date_basis" name="date_basis" defaultValue={currentParams.date_basis ?? "production_due"} className={CREATIVE_SELECT_CLASS}><option value="production_due">Production due</option><option value="review_due">Review due</option></select></Field><Field label="From" htmlFor="creative-from"><Input id="creative-from" name="from" type="date" defaultValue={currentParams.from ?? ""} /></Field><Field label="Through (inclusive)" htmlFor="creative-to"><Input id="creative-to" name="to" type="date" defaultValue={currentParams.to ?? ""} /></Field></div><p className="mt-2 text-muted-foreground">Leave both dates empty to keep all active work visible.</p></details>
      </>}
      <Button type="submit" size="sm" variant="outline" disabled={pending}><ListFilter className="size-3.5" aria-hidden />Apply</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => startTransition(() => router.push(`/marketing/creative?view=${view}`, { scroll: false }))}>Clear filters</Button>
    </form>
    {view !== "calendar" && (currentParams.source || currentParams.shoot || currentParams.unscheduled === "1") && <div className="flex flex-wrap items-center gap-2 text-xs"><TonePill tone="info" label={currentParams.shoot ? "Linked to selected shoot" : currentParams.source ? "Linked to selected opportunity" : "Unscheduled only"} /><Button size="sm" variant="ghost" onClick={() => navigate({ source: null, shoot: null, unscheduled: null }, true)}>Remove scope</Button></div>}
    <div className="flex flex-wrap gap-2 text-xs"><Link href={creativeHref(search, { view: "all", unscheduled: "1", page: null, creative: null })} className="rounded border px-2.5 py-1.5 text-muted-foreground hover:text-foreground">Unscheduled work</Link><Link href="/marketing/content-opportunities" className="rounded border px-2.5 py-1.5 text-muted-foreground hover:text-foreground">Content Opportunities ↗</Link><Link href={view === "my-work" ? "/marketing/shoot-calendar?mine=true&view=agenda" : "/marketing/shoot-calendar"} className="rounded border px-2.5 py-1.5 text-muted-foreground hover:text-foreground">{view === "my-work" ? "My upcoming shoots" : "Shoot Calendar"} ↗</Link></div>
    {view === "calendar" && calendar && <>
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="icon" aria-label="Previous calendar period" onClick={() => navigate({ anchor: calendarMode === "week" ? addDays(anchor, -7) : addMonths(anchor, -1), page: null })}><ArrowLeft className="size-4" /></Button><span className="min-w-36 text-sm font-semibold">{calendarMode === "week" ? `${dayLabel(range.from)} – ${dayLabel(addDays(range.to, -1))}` : monthLabel(anchor)}</span><Button variant="outline" size="icon" aria-label="Next calendar period" onClick={() => navigate({ anchor: calendarMode === "week" ? addDays(anchor, 7) : addMonths(anchor, 1), page: null })}><ArrowRight className="size-4" /></Button><Input type="month" aria-label="Select calendar month and year" className="w-44" value={anchor.slice(0, 7)} onChange={(e) => { if (e.target.value) navigate({ anchor: `${e.target.value}-01`, page: null }); }} /></div><div className="flex flex-wrap gap-2"><select aria-label="Calendar date basis" className={cn(CREATIVE_SELECT_CLASS, "w-auto")} value={basis} onChange={(e) => navigate({ basis: e.target.value, page: null })}><option value="target">Planned release dates</option><option value="scheduled">Scheduled release times</option><option value="published">Actual publication times</option></select><select aria-label="Calendar view" className={cn(CREATIVE_SELECT_CLASS, "w-auto")} value={calendarMode} onChange={(e) => navigate({ calendar: e.target.value, page: null })}><option value="month">Month</option><option value="week">Week</option><option value="agenda">Agenda</option></select></div></div>
      <div className="flex flex-wrap gap-2">{[{ label: "This week", offset: 0 }, { label: "Next week", offset: 1 }, { label: "Following week", offset: 2 }].map(({ label, offset }) => <Button key={label} size="sm" variant="outline" onClick={() => navigate({ anchor: creativeWeekPreset(today, offset).from, calendar: "week", page: null })}>{label}</Button>)}<Button size="sm" variant="outline" onClick={() => navigate({ anchor: today, calendar: "month", page: null })}>This month</Button></div>
      <p className="text-xs text-muted-foreground">{formatDate(range.from)} – {formatDate(addDays(range.to, -1))} · {basis === "target" ? "Planned dates, including work still in production" : basis === "scheduled" ? "Recorded external schedules" : "Recorded actual publications"}. Production deadlines and shoot dates are separate.</p>
      <CalendarPublications calendar={calendar} range={range} anchor={anchor} mode={calendarMode} basis={basis} open={open} onPage={(page) => navigate({ page })} today={today} />
    </>}
    {view === "board" && <><p className="text-xs text-muted-foreground">One card per deliverable. Each column has its own pages. Scroll across to see all stages, or use the stage filter.</p><div className="max-w-full overflow-x-auto pb-3" tabIndex={0} role="region" aria-label="Production board"><div className="flex min-w-full items-start gap-3">{columns.map(({ stage, data }) => <section key={stage} aria-label={`${CREATIVE_STAGE_META[stage].label} column`} className="w-72 shrink-0 space-y-3 rounded-xl border bg-muted/15 p-3 sm:w-64"><div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-1 text-xs font-semibold">{CREATIVE_STAGE_META[stage].label}<InfoTip label={CREATIVE_STAGE_META[stage].label} content={CREATIVE_STAGE_META[stage].hint} /></h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs tnum">{data.total}</span></div><div className="space-y-2">{data.items.map((item) => <CreativeCardButton key={item.id} item={item} open={open} today={today} />)}{data.items.length === 0 && <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">{data.total > 0 ? "No cards on this page. Go back a page." : "No creatives in this stage"}</p>}</div>{(data.total > data.page_size || data.page > 1) && <Pagination compact total={data.total} page={data.page} size={data.page_size} label={CREATIVE_STAGE_META[stage].label} onPage={(page) => navigate({ [`page_${stage}`]: page })} />}</section>)}</div></div></>}
    {view === "my-work" && <><section className="rounded-lg border border-primary/20 bg-primary/5 p-4"><h2 className="text-sm font-semibold">Your production and review queue</h2><p className="mt-1 text-xs text-muted-foreground">Creatives you own or are assigned to review. Check overdue dates and blockers, then open a card for its next action.</p></section>{list.items.length === 0 ? <EmptyState icon={Film} title="Your queue is clear" description="Owned creatives and assigned reviews will appear here. Clear filters if you are looking for a particular item." /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{list.items.map((item) => <CreativeCardButton key={item.id} item={item} open={open} today={today} />)}</div>}<Pagination total={list.total} page={list.page} size={list.page_size} onPage={(page) => navigate({ page })} /></>}
    {view === "all" && <><DataTable columns={tableColumns} data={list.items} rowKey={(row) => row.id} onRowClick={(row) => open(row.id)} hidePagination pageSize={list.page_size} emptyTitle="No matching creatives" emptyDescription="Clear the filters or create a draft. Cancelled work remains discoverable by work status." /><Pagination total={list.total} page={list.page} size={list.page_size} onPage={(page) => navigate({ page })} /></>}
    {selectedMissing && <div role="alert" className="rounded-lg border border-warning/30 p-4 text-sm">That creative is unavailable in this workspace. <Button variant="link" onClick={() => navigate({ creative: null })}>Close selection</Button></div>}
    {creating && <CreateCreativeDialog initialBrief={props.initialBrief} options={options} sourceId={currentParams.source} shootId={currentParams.shoot} outputId={currentParams.output} defaultOwner={session.userId} onClose={() => navigate({ new: null })} onCreated={(id) => open(id)} />}
    {detail && <CreativeDrawer key={detail.id} detail={detail} options={options} onClose={() => navigate({ creative: null })} />}
  </PageBody>;
}
