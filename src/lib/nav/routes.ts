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
} from "lucide-react";
import type { PermissionKey } from "@/lib/rbac/matrix";

export const ROUTE_GROUPS = [
  "Command Centre",
  "Sales",
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
  { key: "accounts", label: "Accounts & Contacts", path: "/sales/accounts", icon: Contact, group: "Sales", status: "live", permission: "sales.read" },
  { key: "projects", label: "Projects", path: "/sales/projects", icon: FolderKanban, group: "Sales", status: "live", permission: "sales.read" },
  { key: "walkins", label: "Walk-ins & Purchases", path: "/sales/walk-ins", icon: Store, group: "Sales", status: "live", permission: "sales.read" },
  { key: "tasks", label: "Tasks", path: "/sales/tasks", icon: ListTodo, group: "Sales", status: "live", permission: "sales.read" },
  { key: "identity", label: "Identity Review", path: "/sales/identity-review", icon: UserCheck, group: "Sales", status: "live", permission: "sales.read" },
  // Marketing
  {
    key: "content-opps",
    label: "Content Opportunities",
    path: "/marketing/content-opportunities",
    icon: Megaphone,
    group: "Marketing Coordination",
    status: "next-module",
    permission: "marketing.read",
    nextModule: {
      phase: "Phase 2",
      summary: "Sales nominates finished customer projects; Marketing reviews readiness, permission, and story angle.",
      workflow: [
        "Salesperson nominates an existing customer project with readiness, location, and proposed content types.",
        "Marketing accepts, requests more information, defers, or declines with a reason.",
        "Customer media permission is recorded separately from contact consent, with evidence and restrictions.",
        "Accepted opportunities flow into the shoot calendar as tentative holds.",
      ],
      unlocks: ["Phase 1 customer/project records in use", "Media-permission evidence policy accepted", "Marketing roles and owners named"],
    },
  },
  {
    key: "shoot-calendar",
    label: "Shoot Calendar",
    path: "/marketing/shoot-calendar",
    icon: CalendarDays,
    group: "Marketing Coordination",
    status: "next-module",
    permission: "marketing.read",
    nextModule: {
      phase: "Phase 2",
      summary: "Month/week/agenda calendar for tentative holds, standby crew, and confirmed shoots with conflict warnings.",
      workflow: [
        "Marketing places tentative holds and assigns coordinator plus crew/standby.",
        "System warns on participant overlap, travel buffers, missing permission, unconfirmed readiness.",
        "Customer-facing owner confirms the date; an authorized coordinator confirms capacity.",
        "Outcome, outputs, and follow-up tasks link back to the customer/project timeline.",
      ],
      unlocks: ["Content Opportunities module", "Crew pool and working-hours rules", "FullCalendar Standard integration"],
    },
  },
  // Merchandise
  { key: "catalog", label: "Catalog", path: "/merchandise/catalog", icon: Package, group: "Merchandise", status: "live", permission: "catalog.read" },
  { key: "pricing", label: "Pricing", path: "/merchandise/pricing", icon: Tags, group: "Merchandise", status: "live", permission: "price.read" },
  {
    key: "stock",
    label: "Stock",
    path: "/merchandise/stock",
    icon: Boxes,
    group: "Merchandise",
    status: "next-module",
    permission: "stock.read",
    nextModule: {
      phase: "Phase 5",
      summary: "In-house SQL Account stock and supplier availability side by side — each with source, timestamp, and freshness.",
      workflow: [
        "Read-only local connector mirrors SQL Account item/location facts with checkpoints.",
        "Supplier updates are time-stamped snapshots (quick entry, CSV, paste, mobile) with evidence.",
        "Freshness policy marks values fresh / aging / stale / unknown per supplier.",
        "Reconciliation compares SQL values with app-linked sales evidence without overwriting the authority.",
      ],
      unlocks: ["SQL Account API entitlement and endpoint discovery", "Quotation-vs-reservation behaviour test", "Item/unit mapping"],
    },
  },
  // Sources
  {
    key: "source-library",
    label: "Source Library",
    path: "/sources/library",
    icon: Library,
    group: "Sources",
    status: "next-module",
    permission: "source.import",
    nextModule: {
      phase: "Phase 4",
      summary: "Private store of supplier PDFs, images, spreadsheets, and allowlisted URLs with checksum and version history.",
      workflow: [
        "Upload to a private quarantine bucket; record checksum, MIME, size, uploader.",
        "Native PDF text / Excel / CSV parsed first; Tesseract only for raster pages.",
        "Extracted rows and page coordinates feed the review queue.",
        "Re-import of an identical checksum is idempotent; changed documents create a new version.",
      ],
      unlocks: ["Representative sanitized source files per category", "Storage and retention policy", "Background job consumer"],
    },
  },
  {
    key: "review",
    label: "Imports & OCR Review",
    path: "/sources/review",
    icon: ClipboardCheck,
    group: "Sources",
    status: "next-module",
    permission: "review.approve",
    nextModule: {
      phase: "Phase 4",
      summary: "Reviewer sees the source region on the left and the proposed normalized record on the right; approve, correct, or reject.",
      workflow: [
        "Each proposed product/price/stock field carries confidence and evidence.",
        "Duplicates and price conflicts are flagged before publishing.",
        "Approval creates versioned records and audit events; nothing publishes automatically.",
      ],
      unlocks: ["Source Library", "Category attribute schemas accepted", "OCR sampling/error thresholds"],
    },
  },
  // Insights
  {
    key: "reports",
    label: "Reports",
    path: "/insights/reports",
    icon: BarChart3,
    group: "Insights",
    status: "next-module",
    permission: "report.read",
    nextModule: {
      phase: "Phase 6",
      summary: "Governed reports with declared definitions, grain, filters, lineage, freshness, and export permission.",
      workflow: [
        "Pipeline and aging; lead source and response; quote conversion.",
        "Walk-in, new/existing, purchase and payment-channel summary; repeat cohorts.",
        "Price coverage/conflicts; stock freshness; data quality and import throughput.",
      ],
      unlocks: ["Baseline period measured", "Metric definitions accepted by the business"],
    },
  },
  // Platform
  {
    key: "integrations",
    label: "Integrations",
    path: "/platform/integrations",
    icon: Cable,
    group: "Platform",
    status: "live",
    permission: "audit.read",
  },
  { key: "data-health", label: "Data Health", path: "/platform/data-health", icon: Activity, group: "Platform", status: "live", permission: "audit.read" },
  { key: "audit", label: "Audit", path: "/platform/audit", icon: ScrollText, group: "Platform", status: "live", permission: "audit.read" },
  { key: "settings", label: "Settings", path: "/platform/settings", icon: Settings, group: "Platform", status: "live", permission: "settings.manage" },
];

export function visibleRoutes(perms: ReadonlySet<string>): RouteDef[] {
  return ROUTES.filter((r) => !r.permission || perms.has(r.permission));
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
