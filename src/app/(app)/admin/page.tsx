import type { Metadata } from "next";
import { CalendarClock, PackageCheck, Truck } from "lucide-react";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied, EntryCard, NotBuiltQueue } from "@/features/workspace/components/entry";

export const metadata: Metadata = { title: "Admin System" };

/**
 * The Admin System's hub. Lists only the queues this role can open; the
 * delivery schedule is shown as not built rather than as an empty list.
 */
export default async function AdminHomePage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = messages(locale);
  const perms = session.permissions;
  if (!perms.includes("workspace.admin")) {
    const landing = resolveLanding(perms, session.defaultArea);
    return (
      <Localized locale={locale}>
        <AreaDenied permission="workspace.admin" roleLabel={session.roleLabel} home={landing.kind === "redirect" ? landing.href : "/start"} t={t} />
      </Localized>
    );
  }

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-5xl">
        <PageHeader title={t.adminHome.title} description={t.adminHome.description} />
        <div className="grid gap-3 md:grid-cols-2">
          {perms.includes("preparation.read") && (
            <EntryCard icon={PackageCheck} title={t.queues.preparation} summary={t.queues.preparationSummary} href="/admin/preparation" action={`${t.areas.open}: ${t.queues.preparation}`} />
          )}
          {perms.includes("delivery.read_own") && (
            <EntryCard icon={Truck} title={t.queues.myDeliveries} summary={t.queues.myDeliveriesSummary} href="/admin/my-deliveries" action={`${t.areas.open}: ${t.queues.myDeliveries}`} />
          )}
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          <NotBuiltQueue icon={CalendarClock} title={t.queues.deliveries} summary={t.queues.deliveriesSummary} t={t} />
        </ul>
      </PageBody>
    </Localized>
  );
}
