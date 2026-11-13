import { redirect } from "next/navigation";
import { getSession, NO_ACCESS_PATH } from "@/server/session";
import { SessionProvider } from "@/components/shell/session-context";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getAttentionItems } from "@/server/queries/command-centre";
import { getLocale } from "@/server/locale";
import { LocaleProvider } from "@/components/i18n/locale-context";
import { ClockProvider } from "@/components/patterns/clock";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  if (!session) redirect(NO_ACCESS_PATH);
  // Not awaited: the shell renders immediately and the bell streams in once
  // the command-centre counters are ready (see TopBar).
  const notifications = getAttentionItems(session).catch(() => []);
  // The instant this request renders at: relative labels ("42 minutes ago")
  // hydrate against it instead of a second clock read in the browser (TILE-68).
  // A server layout renders once per request, so this read is not re-run.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <LocaleProvider locale={locale}>
      <SessionProvider session={session}>
        <ClockProvider now={now}>
          <div className="flex h-dvh overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar notifications={notifications} />
              <main className="min-h-0 flex-1 overflow-y-auto" id="main">
                {children}
              </main>
            </div>
          </div>
        </ClockProvider>
      </SessionProvider>
    </LocaleProvider>
  );
}
