import type { Metadata } from "next";
import { Briefcase, CalendarClock, Info, PackageCheck, Truck } from "lucide-react";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { areaHome, resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied, EntryCard, NotBuiltQueue } from "@/features/workspace/components/entry";

export const metadata: Metadata = { title: "Management Overview" };

/**
 * Management's starting page: entry into both systems, and the operational
 * queues the business will need, each stated truthfully as not built yet. It
 * shows no totals — there is no data behind these queues to count.
 */
export default async function OverviewPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = messages(locale);
  const perms = session.permissions;
  if (!perms.includes("overview.read")) {
    const landing = resolveLanding(perms, session.defaultArea);
    return (
      <Localized locale={locale}>
        <AreaDenied permission="overview.read" roleLabel={session.roleLabel} home={landing.kind === "redirect" && landing.href !== "/overview" ? landing.href : "/start"} t={t} />
      </Localized>
    );
  }

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-5xl">
        <PageHeader title={t.overview.title} description={t.overview.description} />
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>{t.overview.scopeNote}</span>
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          {perms.includes("workspace.operating") && (
            <EntryCard icon={Briefcase} title={t.areas.operating} summary={t.areas.operatingSummary} href={areaHome("operating", perms)} action={`${t.areas.open}: ${t.areas.operating}`} />
          )}
          {perms.includes("workspace.admin") && (
            <EntryCard icon={Truck} title={t.areas.admin} summary={t.areas.adminSummary} href={areaHome("admin", perms)} action={`${t.areas.open}: ${t.areas.admin}`} />
          )}
        </div>

        <section className="space-y-2" aria-labelledby="queues-heading">
          <h2 id="queues-heading" className="text-base font-semibold">{t.overview.queues}</h2>
          <p className="text-sm text-muted-foreground">{t.overview.queuesHint}</p>
          <ul className="grid gap-2 md:grid-cols-2">
            <NotBuiltQueue icon={PackageCheck} title={t.queues.preparation} summary={t.queues.preparationSummary} t={t} />
            <NotBuiltQueue icon={CalendarClock} title={t.queues.deliveries} summary={t.queues.deliveriesSummary} t={t} />
          </ul>
        </section>
      </PageBody>
    </Localized>
  );
}
