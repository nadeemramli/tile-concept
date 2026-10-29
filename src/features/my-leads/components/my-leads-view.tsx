import Link from "next/link";
import { AlarmClock, ArrowLeft, ChevronRight, MessageCircle, Phone, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";
import { SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/messages";
import { dueState, fill, formatLeadDate, MY_LEAD_TABS, type DueState, type MyLeadTab } from "@/features/my-leads/lib/my-leads";
import type { MyLeadCard, MyLeadDetail } from "@/features/my-leads/types";
import { QuickActions } from "@/features/my-leads/components/quick-actions";

export interface MyLeadsState {
  tab: MyLeadTab;
  search: string;
  page: number;
}

export function myLeadsHref(state: MyLeadsState, lead?: string | null): string {
  const params = new URLSearchParams();
  if (state.tab !== "today") params.set("tab", state.tab);
  if (state.search) params.set("q", state.search);
  if (state.page > 1) params.set("page", String(state.page));
  if (lead) params.set("lead", lead);
  const query = params.toString();
  return query ? `/sales/my-leads?${query}` : "/sales/my-leads";
}

function sourceLabel(channel: string) {
  return SOURCE_CHANNEL[channel]?.label ?? titleCase(channel);
}

function statusLabel(status: string, t: Messages) {
  return t.myLeads.status[status as keyof Messages["myLeads"]["status"]] ?? titleCase(status);
}

const DUE_TONE: Record<DueState, string> = {
  overdue: "text-destructive",
  today: "text-warning",
  upcoming: "text-muted-foreground",
  none: "text-muted-foreground",
};

function DueLine({ lead, now, locale, t }: { lead: MyLeadCard; now: number; locale: Locale; t: Messages }) {
  const state = dueState(lead.nextFollowUpAt, now);
  const text = state === "none"
    ? (lead.noNextActionReason ? t.myLeads.due.noNeed : t.myLeads.due.none)
    : `${t.myLeads.due[state]} · ${formatLeadDate(lead.nextFollowUpAt, locale)}`;
  return (
    <p className={cn("flex items-center gap-1.5 text-sm", DUE_TONE[state])}>
      <AlarmClock className="size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

export function MyLeadsTabs({ state, counts, t }: { state: MyLeadsState; counts: Record<MyLeadTab, number>; t: Messages }) {
  return (
    <nav aria-label={t.myLeads.tabsLabel} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-2 md:min-w-0 md:flex-wrap">
        {MY_LEAD_TABS.map((tab) => {
          const active = tab === state.tab;
          return (
            <li key={tab}>
              <Link
                href={myLeadsHref({ tab, search: state.search, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent",
                )}
              >
                {t.myLeads.tabs[tab]}
                <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>{counts[tab]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MyLeadsSearch({ state, t }: { state: MyLeadsState; t: Messages }) {
  return (
    <form method="get" action="/sales/my-leads" role="search" className="flex gap-2">
      {state.tab !== "today" && <input type="hidden" name="tab" value={state.tab} />}
      <Input name="q" type="search" defaultValue={state.search} maxLength={200} placeholder={t.myLeads.search} aria-label={t.myLeads.search} className="h-11 text-base" />
      <Button type="submit" variant="outline" className="h-11 gap-2 px-4">
        <Search className="size-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">{t.myLeads.searchButton}</span>
      </Button>
    </form>
  );
}

export function MyLeadsList({ leads, state, selectedId, now, locale, t }: { leads: MyLeadCard[]; state: MyLeadsState; selectedId: string | null; now: number; locale: Locale; t: Messages }) {
  return (
    <ul className="space-y-2" aria-label={t.myLeads.tabs[state.tab]}>
      {leads.map((lead) => {
        const selected = lead.id === selectedId;
        return (
          <li key={lead.id}>
            <Link
              href={myLeadsHref(state, lead.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-card p-4 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="truncate text-base font-semibold">{lead.name ?? lead.company ?? t.myLeads.unnamed}</p>
                  <span className="text-xs font-medium text-muted-foreground">{statusLabel(lead.status, t)}</span>
                </div>
                <DueLine lead={lead} now={now} locale={locale} t={t} />
                <p className="truncate text-sm text-muted-foreground">
                  {sourceLabel(lead.sourceChannel)}
                  {lead.maskedPhone && <span className="font-mono"> · {lead.maskedPhone}</span>}
                  {lead.interest && <> · {lead.interest}</>}
                </p>
                {lead.primary && <p className="text-sm font-medium text-primary">→ {t.myLeads.actions[lead.primary]}</p>}
              </div>
              <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MyLeadsPager({ state, total, pageSize, t }: { state: MyLeadsState; total: number; pageSize: number; t: Messages }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label={fill(t.myLeads.pageOf, { page: state.page, pages })} className="flex items-center justify-between gap-2">
      {state.page > 1 ? (
        <Button asChild variant="outline" className="h-11"><Link href={myLeadsHref({ ...state, page: state.page - 1 })}>{t.myLeads.previous}</Link></Button>
      ) : <span />}
      <span className="text-sm text-muted-foreground">{fill(t.myLeads.pageOf, { page: state.page, pages })}</span>
      {state.page < pages ? (
        <Button asChild variant="outline" className="h-11"><Link href={myLeadsHref({ ...state, page: state.page + 1 })}>{t.myLeads.next}</Link></Button>
      ) : <span />}
    </nav>
  );
}

export function MyLeadsEmpty({ state, t }: { state: MyLeadsState; t: Messages }) {
  const e = t.myLeads.empty;
  const [title, hint] = state.search ? [e.search, e.searchHint] : [e[state.tab], e[`${state.tab}Hint` as const]];
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <UserRound className="size-8 text-muted-foreground/60" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
      {state.search && (
        <Button asChild variant="outline" className="mt-2 h-11"><Link href={myLeadsHref({ tab: state.tab, search: "", page: 1 })}>{t.myLeads.clearSearch}</Link></Button>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function MyLeadDetailPanel({ lead, state, now, locale, t, sessionUserId }: { lead: MyLeadDetail; state: MyLeadsState; now: number; locale: Locale; t: Messages; sessionUserId: string }) {
  const m = t.myLeads;
  return (
    <article aria-labelledby="my-lead-title" className="space-y-5 rounded-lg border bg-card p-4 md:p-5">
      <Button asChild variant="ghost" className="-ml-2 h-11 gap-2 lg:hidden">
        <Link href={myLeadsHref(state)}><ArrowLeft className="size-4" aria-hidden />{m.back}</Link>
      </Button>
      <header className="space-y-1">
        <h1 id="my-lead-title" className="text-xl font-semibold tracking-tight">{lead.name ?? lead.company ?? m.unnamed}</h1>
        <p className="text-sm text-muted-foreground">
          {statusLabel(lead.status, t)} · {m.source}: {sourceLabel(lead.sourceChannel)}
          {lead.name && lead.company && <> · {lead.company}</>}
        </p>
        <DueLine lead={lead} now={now} locale={locale} t={t} />
        {lead.interest && <p className="text-sm"><span className="text-muted-foreground">{m.interest}: </span>{lead.interest}</p>}
        <p className="text-sm">
          <span className="text-muted-foreground">{m.owner}: </span>
          {lead.ownerId === sessionUserId ? m.ownerYou : lead.ownerName ?? m.unassigned}
        </p>
      </header>

      <section aria-labelledby="my-lead-contact" className="space-y-2">
        <h2 id="my-lead-contact" className="text-sm font-semibold">{m.contact}</h2>
        {lead.contact ? (
          <>
            <p className="font-mono text-sm">{lead.contact.phone}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="h-12 gap-2 text-base">
                <a href={lead.contact.tel}><Phone className="size-4" aria-hidden />{m.call}</a>
              </Button>
              <Button asChild variant="outline" className="h-12 gap-2 text-base">
                <a href={lead.contact.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4" aria-hidden />{m.whatsapp}</a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{m.contactHint}</p>
          </>
        ) : lead.maskedPhone ? (
          <>
            <p className="font-mono text-sm">{lead.maskedPhone}</p>
            <p className="text-xs text-muted-foreground">{m.contactMasked}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{m.noPhone}</p>
        )}
      </section>

      <QuickActions lead={lead} />

      <dl className="grid grid-cols-2 gap-3 border-t pt-4">
        <Fact label={m.whatsappSent} value={lead.firstWhatsappSentAt ? formatLeadDate(lead.firstWhatsappSentAt, locale) : m.notRecorded} />
        <Fact label={m.customerReply} value={lead.firstCustomerReplyAt ? formatLeadDate(lead.firstCustomerReplyAt, locale) : m.notRecorded} />
        <Fact label={m.attempts} value={lead.contactAttempts} />
        <Fact label={m.nextFollowUp} value={lead.nextFollowUpAt ? formatLeadDate(lead.nextFollowUpAt, locale) : m.notRecorded} />
      </dl>

      <section aria-labelledby="my-lead-activity" className="space-y-2 border-t pt-4">
        <h2 id="my-lead-activity" className="text-sm font-semibold">{m.activity}</h2>
        {lead.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.activityEmpty}</p>
        ) : (
          <ol className="space-y-3">
            {lead.activity.map((a) => (
              <li key={a.id} className="border-l-2 pl-3">
                <p className="text-sm font-medium">{a.subject ?? titleCase(a.kind)}</p>
                {a.body && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{a.body}</p>}
                <p className="text-xs text-muted-foreground">{[a.actorName, formatLeadDate(a.occurredAt, locale)].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">{m.activityMore}</p>
        <Button asChild variant="link" className="h-11 px-0">
          <Link href={`/sales/inbox?view=all&lead=${lead.id}`}>{m.openInbox}</Link>
        </Button>
      </section>
    </article>
  );
}
