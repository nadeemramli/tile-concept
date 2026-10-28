import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { SessionProvider } from "@/components/shell/session-context";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getAttentionItems } from "@/server/queries/command-centre";
import { getLocale } from "@/server/locale";
import { LocaleProvider } from "@/components/i18n/locale-context";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  if (!session) redirect("/login?reason=no-membership");
  // Not awaited: the shell renders immediately and the bell streams in once
  // the command-centre counters are ready (see TopBar).
  const notifications = getAttentionItems(session).catch(() => []);

  return (
    <LocaleProvider locale={locale}>
      <SessionProvider session={session}>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar notifications={notifications} />
            <main className="min-h-0 flex-1 overflow-y-auto" id="main">
              {children}
            </main>
          </div>
        </div>
      </SessionProvider>
    </LocaleProvider>
  );
}
