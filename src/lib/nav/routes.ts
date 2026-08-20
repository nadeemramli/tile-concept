import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Boxes,
  Cable,
  CalendarDays,
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
  "Marketing Coordination",
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
    description: "What needs attention now: aging leads, overdue follow-ups, data health.",
  },
  // Sales
  { key: "inbox", label: "Inquiry Inbox", path: "/sales/inbox", icon: Inbox, group: "Sales", status: "live", permission: "sales.read" },
  { key: "pipeline", label: "Pipeline", path: "/sales/pipeline", icon: KanbanSquare, group: "Sales", status: "live", permission: "sales.read" },
  { key: "projects", label: "Projects", path: "/sales/projects", icon: FolderKanban, group: "Sales", status: "live", permission: "sales.read" },
  { key: "walkins", label: "Walk-ins & Purchases", path: "/sales/walk-ins", icon: Store, group: "Sales", status: "live", permission: "sales.read" },
  { key: "tasks", label: "Tasks", path: "/sales/tasks", icon: ListTodo, group: "Sales", status: "live", permission: "sales.read" },
  // Customer — the resolved identity records behind the sales work
  { key: "accounts", label: "Accounts & Contacts", path: "/sales/accounts", icon: Contact, group: "Customer", status: "live", permission: "sales.read" },
  { key: "identity", label: "Identity Review", path: "/sales/identity-review", icon: UserCheck, group: "Customer", status: "live", permission: "sales.read" },
  // Marketing
  { key: "content-opps", label: "Content Opportunities", path: "/marketing/content-opportunities", icon: Megaphone, group: "Marketing Coordination", status: "live", permission: "marketing.read" },
  { key: "shoot-calendar", label: "Shoot Calendar", path: "/marketing/shoot-calendar", icon: CalendarDays, group: "Marketing Coordination", status: "live", permission: "marketing.read" },
  // Merchandise
  { key: "catalog", label: "Catalog", path: "/merchandise/catalog", icon: Package, group: "Merchandise", status: "live", permission: "catalog.read" },
  { key: "pricing", label: "Pricing", path: "/merchandise/pricing", icon: Tags, group: "Merchandise", status: "live", permission: "price.read" },
  { key: "stock", label: "Stock", path: "/merchandise/stock", icon: Boxes, group: "Merchandise", status: "live", permission: "stock.read" },
  // Sources
  { key: "source-library", label: "Source Library", path: "/sources/library", icon: Library, group: "Sources", status: "live", permission: "source.import" },
  { key: "review", label: "Imports & OCR Review", path: "/sources/review", icon: ClipboardCheck, group: "Sources", status: "live", permission: "review.approve" },
  // Insights
  { key: "reports", label: "Reports", path: "/insights/reports", icon: BarChart3, group: "Insights", status: "live", permission: "report.read" },
  // Platform
  { key: "integrations", label: "Integrations", path: "/platform/integrations", icon: Cable, group: "Platform", status: "live", permission: "audit.read" },
  { key: "connectors", label: "Lead Connectors", path: "/platform/connectors", icon: Webhook, group: "Platform", status: "live", permission: "settings.manage" },
  { key: "data-health", label: "Data Health", path: "/platform/data-health", icon: Activity, group: "Platform", status: "live", permission: "audit.read" },
  { key: "audit", label: "Audit", path: "/platform/audit", icon: ScrollText, group: "Platform", status: "live", permission: "audit.read" },
  { key: "settings", label: "Settings", path: "/platform/settings", icon: Settings, group: "Platform", status: "live", permission: "settings.manage" },
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
  return visibleRoutes(perms).filter((r) => r.group !== "Platform");
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
