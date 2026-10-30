import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, RefreshCw, ShieldOff } from "lucide-react";
import { getAuthUser, getSession } from "@/server/session";
import { signOutAction } from "@/server/commands/auth";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";
import { htmlLang } from "@/lib/i18n/locale";
import { LocaleProvider } from "@/components/i18n/locale-context";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { LogoLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No workspace access" };

/**
 * Where a signed-in account without an active membership lands (TILE-67):
 * never invited, not yet accepted, suspended or removed. It must stay put —
 * no redirect back to /start or /login — and offer the one way out, signing
 * out. It grants nothing: a member is sent to /start, an anonymous visitor to
 * /login, and the page shows only the account's own email.
 */
export default async function NoAccessPage() {
  const [session, user, locale] = await Promise.all([getSession(), getAuthUser(), getLocale()]);
  if (session) redirect("/start");
  if (!user) redirect("/login");
  const t = messages(locale);

  return (
    <LocaleProvider locale={locale}>
      <div lang={htmlLang(locale)} className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-end">
            <LanguageToggle size="lg" />
          </div>
          <LogoLockup size={64} priority className="ring-1 ring-border" />
          <div className="space-y-3">
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <ShieldOff className="size-5 shrink-0 text-warning" aria-hidden />
              {t.noAccess.title}
            </h1>
            <p className="text-sm">
              {t.noAccess.signedInAs} <span className="font-medium break-all">{user.email}</span>
            </p>
            <p className="text-sm text-muted-foreground">{t.noAccess.body}</p>
            <p className="text-sm font-medium">{t.noAccess.ask}</p>
          </div>
          <div className="space-y-3">
            <form action={signOutAction}>
              <Button type="submit" className="h-11 w-full text-base">
                <LogOut className="size-4" aria-hidden /> {t.noAccess.signOut}
              </Button>
            </form>
            <Button asChild variant="outline" className="h-11 w-full text-base">
              <Link href="/start">
                <RefreshCw className="size-4" aria-hidden /> {t.noAccess.retry}
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">{t.noAccess.retryHint}</p>
          </div>
        </div>
      </div>
    </LocaleProvider>
  );
}
