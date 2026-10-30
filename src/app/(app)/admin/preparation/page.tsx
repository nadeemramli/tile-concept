import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied, NotBuiltState } from "@/features/workspace/components/entry";

export const metadata: Metadata = { title: "Order preparation" };

/** Warehouse landing. The queue itself is a later issue; this says so plainly. */
export default async function PreparationPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = messages(locale);
  if (!session.permissions.includes("preparation.read")) {
    const landing = resolveLanding(session.permissions, session.defaultArea);
    return (
      <Localized locale={locale}>
        <AreaDenied permission="preparation.read" roleLabel={session.roleLabel} home={landing.kind === "redirect" ? landing.href : "/start"} t={t} />
      </Localized>
    );
  }
  return (
    <Localized locale={locale}>
      <PageBody className="max-w-2xl">
        <PageHeader title={t.preparation.title} />
        <NotBuiltState title={t.preparation.emptyTitle} description={t.preparation.emptyDescription} t={t} />
      </PageBody>
    </Localized>
  );
}
