import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied, NotBuiltState } from "@/features/workspace/components/entry";
import { CheckAgainButton } from "@/features/workspace/components/check-again-button";

export const metadata: Metadata = { title: "My Deliveries" };

/**
 * A driver's whole app on a phone. Scheduling and delivery records are a later
 * issue; until then this states that nothing is recorded, with one action.
 */
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
        <NotBuiltState title={t.myDeliveries.emptyTitle} description={t.myDeliveries.emptyDescription} t={t}>
          <CheckAgainButton label={t.myDeliveries.checkAgain} pendingLabel={t.myDeliveries.checking} />
        </NotBuiltState>
      </PageBody>
    </Localized>
  );
}
