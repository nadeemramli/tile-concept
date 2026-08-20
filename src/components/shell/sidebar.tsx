"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIDEBAR_GROUPS, isRouteActive, sidebarRoutes } from "@/lib/nav/routes";
import { useSession } from "@/components/shell/session-context";
import { Badge } from "@/components/ui/badge";
import { LogoMark } from "@/components/brand/logo";

export function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const { permissions } = useSession();
  const routes = sidebarRoutes(permissions);

  return (
    // Sized to fit without scrolling (~700px for the full nav): Platform lives
    // in the user menu, and density is tight. `auto` only engages on a window
    // shorter than the list, where scrolling beats hiding items.
    <nav className={cn("flex-1 space-y-3 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")} aria-label="Primary">
      {SIDEBAR_GROUPS.map((group) => {
        const items = routes.filter((r) => r.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className={cn(collapsed && group !== "Command Centre" && "border-t border-sidebar-border/60 pt-3")}>
            {!collapsed && group !== "Command Centre" && (
              <div className="mb-1 px-2 text-[11px] font-medium uppercase leading-5 tracking-wider text-muted-foreground/70">{group}</div>
            )}
            <ul className="space-y-1">
              {items.map((r) => {
                const active = isRouteActive(r, pathname);
                return (
                  <li key={r.key}>
                    <Link
                      href={r.path}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? r.label : undefined}
                      className={cn(
                        "group relative flex items-center rounded-md text-sm outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2 py-1.5",
                        // Active items carry a brand-amber rail so the identity
                        // reads in light mode too, where primary is navy.
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-brand"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <r.icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && <span className="flex-1 truncate">{r.label}</span>}
                      {!collapsed && r.status === "next-module" && (
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

export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  const { session } = useSession();
  return (
    <div className={cn("flex h-14 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
      <LogoMark />
      {!collapsed && (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{session.workspaceName}</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">Command Centre</div>
        </div>
      )}
    </div>
  );
}

const STORAGE_KEY = "tc.sidebar.collapsed";
const TOGGLE_EVENT = "tc-sidebar-toggle";

function subscribe(cb: () => void) {
  window.addEventListener(TOGGLE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(TOGGLE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function Sidebar() {
  // Persisted collapse state as an external store: the server snapshot is
  // "expanded" (no hydration mismatch) and the real value is read from
  // localStorage after mount without a set-state-in-effect.
  const collapsed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(STORAGE_KEY) === "1",
    () => false,
  );

  const toggle = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1");
    window.dispatchEvent(new Event(TOGGLE_EVENT));
  }, [collapsed]);

  return (
    <aside className={cn("hidden h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex", collapsed ? "w-14" : "w-60")}>
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 border-t border-sidebar-border text-xs text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <><ChevronsLeft className="size-4" aria-hidden /> Collapse</>}
      </button>
    </aside>
  );
}
