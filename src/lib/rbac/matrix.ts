/**
 * Permission keys mirror `core.role_permissions` in the database (the
 * authority). This file exists for navigation visibility and UI affordances;
 * every write is re-checked by RLS / SECURITY DEFINER functions server-side.
 */
export const PERMISSIONS = [
  "sales.read",
  "sales.read_all",
  "sales.leads.read_all",
  "sales.write",
  "sales.assign",
  "contact.reveal",
  "identity.merge",
  "purchase.write",
  "purchase.correct",
  "catalog.read",
  "catalog.write",
  "price.read",
  "price.publish",
  "stock.read",
  "stock.write",
  "marketing.read",
  "marketing.write",
  "marketing.confirm",
  "source.import",
  "review.approve",
  "report.read",
  "audit.read",
  "audit.read_all",
  "settings.manage",
  "export.customer",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const ROLES = [
  "admin",
  "management",
  "sales_manager",
  "sales_rep",
  "showroom",
  "marketing_coordinator",
  "catalog_pricing",
  "stock_coordinator",
  "analyst",
  // Anonymous visitors in the demo workspace. Every permission except
  // settings.manage, and the database confines them to that one workspace.
  "guest",
] as const;

export type RoleKey = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Platform administrator",
  management: "Management",
  sales_manager: "Sales manager",
  sales_rep: "Sales representative",
  showroom: "Showroom staff",
  marketing_coordinator: "Marketing coordinator",
  catalog_pricing: "Catalog / pricing",
  stock_coordinator: "Stock coordinator",
  analyst: "Analyst (read-only)",
  guest: "Guest (demo)",
};

export const PERMISSION_EXPLAINERS: Partial<Record<PermissionKey, string>> = {
  "sales.read": "Viewing leads, accounts, projects and opportunities needs a sales role.",
  "sales.leads.read_all": "Sales representatives, managers and administrators share visibility of every Enquiry Box lead.",
  "sales.assign": "Only sales managers and administrators can assign leads.",
  "identity.merge": "Confirming an identity merge is restricted to sales managers and administrators.",
  "price.publish": "Publishing prices is restricted to catalog/pricing operators.",
  "catalog.read": "Catalog access needs a merchandise, sales, or management role.",
  "stock.read": "Stock visibility needs a stock, sales, or management role.",
  "marketing.read": "Marketing coordination needs a marketing, sales, or management role.",
  "source.import": "Importing source documents is restricted to catalog/pricing operators.",
  "audit.read": "Audit access is role-scoped.",
  "settings.manage": "Settings and user management are restricted to administrators.",
  "report.read": "Reports need a management, analyst, or manager role.",
};

export function can(perms: ReadonlySet<string> | string[], permission: PermissionKey): boolean {
  return Array.isArray(perms) ? perms.includes(permission) : perms.has(permission);
}
