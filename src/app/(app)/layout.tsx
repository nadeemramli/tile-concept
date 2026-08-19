import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { SessionProvider } from "@/components/shell/session-context";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getAttentionItems } from "@/server/queries/command-centre";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login?reason=no-membership");
  const notifications = await getAttentionItems(session).catch(() => []);

  return (
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
  );
}
