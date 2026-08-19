"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SIDEBAR_GROUPS, isRouteActive, sidebarRoutes } from "@/lib/nav/routes";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/badge";
import { LogoMark } from "@/components/brand/logo";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { permissions } = useSession();
  const routes = sidebarRoutes(permissions);

  return (
    // Sized to fit without scrolling (~700px for the full nav): Platform lives
    // in the user menu, and density is tight. `auto` only engages on a window
    // shorter than the list, where scrolling beats hiding items.
    <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-2" aria-label="Primary">
      {SIDEBAR_GROUPS.map((group) => {
        const items = routes.filter((r) => r.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {group !== "Command Centre" && (
              <div className="mb-0.5 px-2 text-[11px] font-medium uppercase leading-5 tracking-wider text-muted-foreground/70">{group}</div>
            )}
            <ul className="space-y-0.5">
              {items.map((r) => {
                const active = isRouteActive(r, pathname);
                return (
                  <li key={r.key}>
                    <Link
                      href={r.path}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md px-2 py-1 text-sm outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        // Active items carry a brand-amber rail so the identity
                        // reads in light mode too, where primary is navy.
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-brand"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <r.icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{r.label}</span>
                      {r.status === "next-module" && (
                        <Badge variant="outline" className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground">
                          {r.nextModule?.phase?.replace("Phase ", "P") ?? "Next"}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  const { session } = useSession();
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
      <LogoMark />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-tight">{session.workspaceName}</div>
        <div className="truncate text-[11px] leading-tight text-muted-foreground">Command Centre</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <SidebarBrand />
      <SidebarNav />
    </aside>
  );
}
