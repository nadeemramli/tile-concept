import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { getMyLeadDetail, getMyLeads } from "@/server/queries/my-leads";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { uuid } from "@/lib/zod";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied } from "@/features/workspace/components/entry";
import { fill, parseTab } from "@/features/my-leads/lib/my-leads";
import { MyLeadDetailPanel, MyLeadsEmpty, MyLeadsList, MyLeadsPager, MyLeadsSearch, MyLeadsTabs, type MyLeadsState } from "@/features/my-leads/components/my-leads-view";

export const metadata: Metadata = { title: "My Leads" };

/**
 * A salesperson's own inquiries on a phone: what is due, one next action, and
 * a quick update. It reads and writes through the Inquiry Inbox's queries and
 * commands, so assignment, masking and ownership rules are the inbox's own.
 */
export default async function MyLeadsPage({ searchParams }: PageProps<"/sales/my-leads">) {
  const [session, locale, sp] = await Promise.all([requireSession(), getLocale(), searchParams]);
  const t = messages(locale);
  if (!session.permissions.includes("sales.read")) {
    const landing = resolveLanding(session.permissions, session.defaultArea);
    return (
      <Localized locale={locale}>
        <AreaDenied permission="sales.read" roleLabel={session.roleLabel} home={landing.kind === "redirect" ? landing.href : "/start"} t={t} />
      </Localized>
    );
  }
  const requested: MyLeadsState = {
    tab: parseTab(sp.tab),
    search: typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "",
    page: Math.min(1000000, Math.max(1, Math.floor(Number(sp.page) || 1))),
  };
  const selectedId = uuid().safeParse(sp.lead).data ?? null;
  const [list, detail] = await Promise.all([
    getMyLeads(requested),
    selectedId ? getMyLeadDetail(selectedId, session) : Promise.resolve(null),
  ]);
  const state: MyLeadsState = { ...requested, page: list.page };
  // The instant this request renders at, so due labels agree across the page.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const showDetail = Boolean(sp.lead);

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-6xl">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
          <div className={cn("space-y-4", showDetail && "hidden lg:block")}>
            <PageHeader title={t.myLeads.title} description={t.myLeads.description} />
            <MyLeadsTabs state={state} counts={list.counts} t={t} />
            <MyLeadsSearch state={state} t={t} />
            <p className="text-sm text-muted-foreground" aria-live="polite">{fill(t.myLeads.count, { n: list.total })}</p>
            {list.leads.length === 0 ? (
              <MyLeadsEmpty state={state} t={t} />
            ) : (
              <MyLeadsList leads={list.leads} state={state} selectedId={selectedId} now={now} locale={locale} t={t} />
            )}
            <MyLeadsPager state={state} total={list.total} pageSize={list.pageSize} t={t} />
          </div>
          {showDetail && (
            <div className="lg:sticky lg:top-0">
              {detail ? (
                <MyLeadDetailPanel key={detail.id} lead={detail} state={state} now={now} locale={locale} t={t} sessionUserId={session.userId} />
              ) : (
                <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">{t.myLeads.notFound}</p>
              )}
            </div>
          )}
        </div>
      </PageBody>
    </Localized>
  );
}
