import type { Metadata } from "next";
import { DriverSchedules } from "@/features/dispatch/driver-schedules";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied, NotBuiltState } from "@/features/workspace/components/entry";
import { CheckAgainButton } from "@/features/workspace/components/check-again-button";

export const metadata: Metadata = { title: "My Deliveries" };

export default async function MyDeliveriesPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = messages(locale);
  if (!session.permissions.includes("delivery.read_own")) {
    const landing = resolveLanding(session.permissions, session.defaultArea);
    return (
      <Localized locale={locale}>
        <AreaDenied permission="delivery.read_own" roleLabel={session.roleLabel} home={landing.kind === "redirect" ? landing.href : "/start"} t={t} />
      </Localized>
    );
  }
  return (
    <Localized locale={locale}>
      <PageBody className="max-w-2xl">
        <PageHeader title={t.myDeliveries.title} description={session.fullName} />
        {process.env.TILE_SYNTHETIC_PREPARATION === "1" ? <DriverSchedules locale={locale} /> : (
          <NotBuiltState title={t.myDeliveries.emptyTitle} description={t.myDeliveries.emptyDescription} t={t}>
          <CheckAgainButton label={t.myDeliveries.checkAgain} pendingLabel={t.myDeliveries.checking} />
          </NotBuiltState>
        )}
      </PageBody>
    </Localized>
  );
}
