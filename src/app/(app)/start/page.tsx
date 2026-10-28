import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Briefcase, Truck } from "lucide-react";
import { requireSession } from "@/server/session";
import { getLocale } from "@/server/locale";
import { chooseAreaAction } from "@/server/commands/workspace";
import { messages } from "@/lib/i18n/messages";
import { resolveLanding } from "@/lib/workspace/areas";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { EmptyState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Start" };

/**
 * Where sign-in lands when no deep link was asked for. It applies the landing
 * rule (src/lib/workspace/areas.ts): single-area roles go straight in,
 * management goes to the overview, a remembered default is honoured while it
 * is still permitted, and everyone else chooses here.
 */
export default async function StartPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = messages(locale);
  const landing = resolveLanding(session.permissions, session.defaultArea);
  if (landing.kind === "redirect") redirect(landing.href);

  if (landing.kind === "none") {
    return (
      <Localized locale={locale}>
        <PageBody className="max-w-2xl">
          <PageHeader title={t.start.noneTitle} />
          <EmptyState title={session.roleLabel} description={t.start.noneDescription} />
        </PageBody>
      </Localized>
    );
  }

  const cards = {
    operating: { icon: Briefcase, title: t.areas.operating, summary: t.areas.operatingSummary },
    admin: { icon: Truck, title: t.areas.admin, summary: t.areas.adminSummary },
  };

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-3xl">
        <PageHeader title={t.start.title} description={t.start.description} />
        <form action={chooseAreaAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {landing.areas.map((a) => {
              const c = cards[a];
              return (
                <section key={a} className="flex flex-col gap-3 rounded-lg border bg-card p-5">
                  <div className="flex items-start gap-3">
                    <c.icon className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">{c.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{c.summary}</p>
                    </div>
                  </div>
                  <Button type="submit" name="area" value={a} size="lg" className="mt-auto h-11 text-base">
                    {t.start.enter}: {c.title}
                  </Button>
                </section>
              );
            })}
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-base">
            <input type="checkbox" name="remember" className="mt-1 size-5 accent-primary" />
            <span>
              <span className="block font-medium">{t.start.remember}</span>
              <span className="block text-sm text-muted-foreground">{t.start.rememberHint}</span>
            </span>
          </label>
        </form>
      </PageBody>
    </Localized>
  );
}
