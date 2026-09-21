import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Boxes,
  Cable,
  CalendarDays,
  CircleHelp,
  ClipboardCheck,
  Contact,
  FileSearch,
  FolderKanban,
  Images,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Library,
  ListTodo,
  Megaphone,
  MessageSquareText,
  Package,
  ScrollText,
  Settings,
  Store,
  Tags,
  UserCheck,
  Building2,
  Webhook,
} from "lucide-react";
import type { PermissionKey } from "@/lib/rbac/matrix";

export const ROUTE_GROUPS = [
  "Command Centre",
  "Sales",
  "Customer",
  "Marketing",
  "Merchandise",
  "Sources",
  "Insights",
  "Platform",
] as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[number];

export interface RouteDef {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: RouteGroup;
  status: "live" | "next-module";
  /** Permission that gates seeing this item; undefined = everyone with a membership. */
  permission?: PermissionKey;
  /**
   * Where the shell presents this route. Sidebar items are the daily work
   * list; a placed route is reachable from the shell chrome instead (the
   * sidebar brand, or the top bar) and is deliberately not repeated in the
   * sidebar, which keeps the list short enough never to scroll.
   */
  placement?: "brand" | "top-bar" | "user-menu";
  description?: string;
  nextModule?: { phase: string; summary: string; workflow: string[]; unlocks: string[] };
}

export const ROUTES: RouteDef[] = [
  {
    key: "home",
    label: "Command Centre",
    path: "/",
    icon: LayoutDashboard,
    group: "Command Centre",
    status: "live",
    placement: "brand",
    description: "What needs attention now: aging leads, overdue follow-ups, data health.",
  },
  // Sales
  { key: "pipeline", label: "Pipeline", path: "/sales/pipeline", icon: KanbanSquare, group: "Sales", status: "live", permission: "sales.read" },
  { key: "projects", label: "Projects", path: "/sales/projects", icon: FolderKanban, group: "Sales", status: "live", permission: "sales.read" },
  { key: "walkins", label: "Walk-ins & Purchases", path: "/sales/walk-ins", icon: Store, group: "Sales", status: "live", permission: "sales.read" },
  { key: "feedback", label: "Customer Feedback", path: "/sales/feedback", icon: MessageSquareText, group: "Sales", status: "live", permission: "sales.read" },
  { key: "tasks", label: "Tasks", path: "/sales/tasks", icon: ListTodo, group: "Sales", status: "live", permission: "sales.read", placement: "top-bar" },
  // Customer — the resolved identity records behind the sales work
  { key: "inbox", label: "Inquiry Inbox", path: "/sales/inbox", icon: Inbox, group: "Customer", status: "live", permission: "sales.read" },
  { key: "accounts", label: "Accounts & Contacts", path: "/sales/accounts", icon: Contact, group: "Customer", status: "live", permission: "sales.read" },
  // Marketing
  { key: "creative", label: "Creative", path: "/marketing/creative", icon: KanbanSquare, group: "Marketing", status: "live", permission: "marketing.read", description: "Production board, release calendar and your creative work." },
  { key: "marketing-spend", label: "Marketing Spend", path: "/marketing/spend", icon: Tags, group: "Marketing", status: "live", permission: "marketing.spend.read" },
  { key: "content-opps", label: "Content Opportunities", path: "/marketing/content-opportunities", icon: Megaphone, group: "Marketing", status: "live", permission: "marketing.read" },
  { key: "shoot-calendar", label: "Shoot Calendar", path: "/marketing/shoot-calendar", icon: CalendarDays, group: "Marketing", status: "live", permission: "marketing.read" },
  // Merchandise
  { key: "catalog", label: "Catalog", path: "/merchandise/catalog", icon: Package, group: "Merchandise", status: "live", permission: "catalog.read" },
  { key: "pricing", label: "Pricing", path: "/merchandise/pricing", icon: Tags, group: "Merchandise", status: "live", permission: "price.read" },
  { key: "stock", label: "Stock", path: "/merchandise/stock", icon: Boxes, group: "Merchandise", status: "live", permission: "stock.read" },
  // Sources — occasional administration, reached from the profile menu.
  { key: "source-library", label: "Source Library", path: "/sources/library", icon: Library, group: "Sources", status: "live", permission: "source.import", placement: "user-menu" },
  { key: "review", label: "Imports & OCR Review", path: "/sources/review", icon: ClipboardCheck, group: "Sources", status: "live", permission: "review.approve", placement: "user-menu" },
  // Insights
  { key: "reports", label: "Reports", path: "/insights/reports", icon: BarChart3, group: "Insights", status: "live", permission: "report.read" },
  // Platform — administration, reached from the user menu
  // Identity Review is a periodic clean-up queue, not daily work, so it sits
  // with the other administration surfaces rather than in the sidebar.
  { key: "identity", label: "Identity Review", path: "/sales/identity-review", icon: UserCheck, group: "Platform", status: "live", permission: "sales.read" },
  { key: "integrations", label: "Integrations", path: "/platform/integrations", icon: Cable, group: "Platform", status: "live", permission: "audit.read" },
  { key: "connectors", label: "Lead Connectors", path: "/platform/connectors", icon: Webhook, group: "Platform", status: "live", permission: "settings.manage" },
  { key: "data-health", label: "Data Health", path: "/platform/data-health", icon: Activity, group: "Platform", status: "live", permission: "audit.read" },
  { key: "audit", label: "Audit", path: "/platform/audit", icon: ScrollText, group: "Platform", status: "live", permission: "audit.read" },
  { key: "settings", label: "Settings", path: "/platform/settings", icon: Settings, group: "Platform", status: "live", permission: "settings.manage" },
  // Everyone with a membership. Generated from the status maps, so it never drifts from the tooltips.
  { key: "help", label: "Help & glossary", path: "/platform/help", icon: CircleHelp, group: "Platform", status: "live", description: "Every status and term, what it means, and who can do what." },
];

export function visibleRoutes(perms: ReadonlySet<string>): RouteDef[] {
  return ROUTES.filter((r) => !r.permission || perms.has(r.permission));
}

/**
 * Platform routes are administration surfaces, not daily work — they live in
 * the user menu rather than the sidebar so the sidebar stays short enough to
 * never scroll.
 */
export const SIDEBAR_GROUPS = ROUTE_GROUPS.filter((g) => g !== "Platform");

export function sidebarRoutes(perms: ReadonlySet<string>): RouteDef[] {
  return visibleRoutes(perms).filter((r) => r.group !== "Platform" && !r.placement);
}

/** Routes the shell chrome renders itself, so the sidebar can leave them out. */
export function chromeRoutes(perms: ReadonlySet<string>, placement: NonNullable<RouteDef["placement"]>): RouteDef[] {
  return visibleRoutes(perms).filter((r) => r.placement === placement);
}

export function platformRoutes(perms: ReadonlySet<string>): RouteDef[] {
  return visibleRoutes(perms).filter((r) => r.group === "Platform");
}

export function routeForPath(pathname: string): RouteDef | undefined {
  const exact = ROUTES.find((r) => r.path === pathname);
  if (exact) return exact;
  return ROUTES.filter((r) => r.path !== "/" && pathname.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
}

export function isRouteActive(route: RouteDef, pathname: string): boolean {
  if (route.path === "/") return pathname === "/";
  if (route.key === "accounts") return pathname.startsWith("/sales/accounts") || pathname.startsWith("/sales/contacts");
  return pathname === route.path || pathname.startsWith(`${route.path}/`);
}

// Icons referenced by other surfaces (create menu, search)
export const ENTITY_ICONS = { contact: Contact, account: Building2, project: FolderKanban, product: Package, search: FileSearch, media: Images } as const;
