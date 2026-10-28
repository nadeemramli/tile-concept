import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { publicEnv } from "@/lib/env";
import { safeAuthNext } from "@/lib/auth-links";
import { messages } from "@/lib/i18n/messages";
import { htmlLang } from "@/lib/i18n/locale";
import { LocaleProvider } from "@/components/i18n/locale-context";
import { getLocale } from "@/server/locale";
import { LogoLockup } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/i18n/language-toggle";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [sp, locale] = await Promise.all([searchParams, getLocale()]);
  const t = messages(locale);
  const reasons: Record<string, string> = t.login.reasons;
  const reason = typeof sp.reason === "string" ? reasons[sp.reason] : undefined;
  // One sign-in for both systems. With no deep link the landing rule decides
  // (/start); a deep link is kept exactly, query string included.
  const next = safeAuthNext(sp.next, "/start");
  // The document stays lang="en" (most screens are still English); the
  // translated sign-in declares its own language.
  return (
    <LocaleProvider locale={locale}>
      <div lang={htmlLang(locale)} className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-end">
            <LanguageToggle size="lg" />
          </div>
          <div className="flex items-center gap-3.5">
            <LogoLockup size={64} priority className="ring-1 ring-border" />
            <div>
              <h1 className="text-base font-semibold tracking-tight">Tile Concept OS</h1>
              <p className="text-xs text-muted-foreground">{t.login.subtitle}</p>
            </div>
          </div>
          {reason && <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{reason}</p>}
          <LoginForm next={next} demo={publicEnv.appMode === "demo"} />
          <p className="text-[11px] text-muted-foreground">{t.login.footer}</p>
        </div>
      </div>
    </LocaleProvider>
  );
}
