"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GlobalSearch } from "@/components/shell/global-search";
import { ModePill } from "@/components/shell/mode-pill";
import { ThemeToggleItem } from "@/components/shell/theme-toggle";
import { SidebarBrand, SidebarNav } from "@/components/shell/sidebar";
import { useSession } from "@/components/shell/session-context";
import { platformRoutes, routeForPath } from "@/lib/nav/routes";
import { initials } from "@/lib/format";
import { signOutAction } from "@/server/commands/auth";
import { Inbox, Store, Contact, FolderKanban, ListTodo, Package, Building2 } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  detail?: string;
  href?: string;
  tone?: "warning" | "destructive" | "info";
}

export function TopBar({ notifications = [] }: { notifications?: Notification[] }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const { session, can, permissions } = useSession();
  const platform = platformRoutes(permissions);
  const current = routeForPath(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:gap-3 md:px-4">
      {/* Mobile nav */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
          <Menu className="size-4" />
        </Button>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBrand />
          <SidebarNav onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="hidden min-w-0 items-center gap-2 text-sm md:flex">
        <span className="truncate font-medium">{current?.label ?? "Tile Concept OS"}</span>
      </div>

      <Button variant="outline" size="sm" className="h-8 w-full max-w-xs justify-start gap-2 px-2.5 text-muted-foreground md:ml-2 md:w-64" onClick={() => setSearchOpen(true)} aria-label="Open global search">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 truncate text-left text-xs">Search…</span>
        <Kbd className="hidden md:inline-flex">⌘K</Kbd>
      </Button>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden sm:block">
          <ModePill />
        </div>

        {can("sales.write") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5">
                <Plus className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Create</span>
                <ChevronDown className="size-3 opacity-70" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/sales/inbox?new=1">
                    <Inbox className="size-4" aria-hidden /> Inquiry
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sales/walk-ins/new">
                    <Store className="size-4" aria-hidden /> Walk-in
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sales/accounts?new=contact">
                    <Contact className="size-4" aria-hidden /> Contact
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sales/accounts?new=account">
                    <Building2 className="size-4" aria-hidden /> Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sales/projects?new=1">
                    <FolderKanban className="size-4" aria-hidden /> Project / opportunity
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sales/tasks?new=1">
                    <ListTodo className="size-4" aria-hidden /> Task
                  </Link>
                </DropdownMenuItem>
                {can("catalog.write") && (
                  <DropdownMenuItem asChild>
                    <Link href="/merchandise/catalog?new=1">
                      <Package className="size-4" aria-hidden /> Product
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative size-8" aria-label={`Notifications${notifications.length ? ` (${notifications.length})` : ""}`}>
              <Bell className="size-4" />
              {notifications.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-warning" aria-hidden />}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b px-3 py-2 text-sm font-medium">Needs attention</div>
            <ul className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing overdue. Nice.</li>}
              {notifications.map((n) => (
                <li key={n.id} className="border-b last:border-b-0">
                  {n.href ? (
                    <Link href={n.href} className="block px-3 py-2 hover:bg-accent/50">
                      <div className="text-sm">{n.title}</div>
                      {n.detail && <div className="text-xs text-muted-foreground">{n.detail}</div>}
                    </Link>
                  ) : (
                    <div className="px-3 py-2">
                      <div className="text-sm">{n.title}</div>
                      {n.detail && <div className="text-xs text-muted-foreground">{n.detail}</div>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-1.5" aria-label="User menu">
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px]">{initials(session.fullName)}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-32 truncate text-xs sm:inline">{session.fullName}</span>
              <ChevronDown className="size-3 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{session.fullName}</div>
              <div className="truncate text-xs text-muted-foreground">{session.email}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {session.roleLabel} · {session.workspaceName}
              </div>
            </DropdownMenuLabel>
            {platform.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Platform</DropdownMenuLabel>
                {platform.map((r) => (
                  <DropdownMenuItem key={r.key} asChild>
                    <Link href={r.path}>
                      <r.icon className="size-4" aria-hidden /> {r.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <ThemeToggleItem />
            <DropdownMenuItem asChild>
              <Link href="/auth/set-password">Change password</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut className="size-4" aria-hidden /> Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
