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
  "feedback.send",
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
  "marketing.spend.read",
  "marketing.spend.write",
  "marketing.spend.review",
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

/** What each key lets a person do, in the words used on screen. */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "sales.read": "See leads, accounts, projects and opportunities",
  "sales.read_all": "See every salesperson's records, not only your own",
  "sales.leads.read_all": "See every Enquiry Box lead",
  "sales.write": "Create and edit sales records, log activity, add tasks",
  "sales.assign": "Assign leads to a salesperson",
  "contact.reveal": "Reveal a masked phone number or email (audited)",
  "feedback.send": "Reveal a visit customer’s phone for an audited feedback handoff",
  "identity.merge": "Confirm or reverse a duplicate merge",
  "purchase.write": "Record walk-ins and purchases",
  "purchase.correct": "Correct a recorded purchase amount (audited)",
  "catalog.read": "See the product catalog",
  "catalog.write": "Edit products and mark them reviewed",
  "price.read": "See prices",
  "price.publish": "Publish, override or reject prices",
  "stock.read": "See stock",
  "stock.write": "Enter supplier stock updates and flag stale suppliers",
  "marketing.read": "See content opportunities and the shoot calendar",
  "marketing.write": "Nominate projects, record customer media permission, hold shoot dates",
  "marketing.confirm": "Confirm crew capacity and mark shoot assets usable",
  "marketing.spend.read": "See marketing costs and spending coverage",
  "marketing.spend.write": "Record daily advertising and shared marketing costs",
  "marketing.spend.review": "Correct marketing costs and confirm period coverage",
  "source.import": "Upload and parse source documents",
  "review.approve": "Approve or reject parsed import items",
  "report.read": "Open reports",
  "audit.read": "See the audit trail within your scope",
  "audit.read_all": "See the whole workspace's audit trail",
  "settings.manage": "Manage users, roles, stages and integrations",
  "export.customer": "Export customer data",
};

/**
 * Role → permissions, mirrored from `core.role_permissions`
 * (`supabase/migrations/20260820000001_foundation.sql`, the Enquiry Box
 * migration and `20260823000001_guest_mode.sql`). Used only to explain gates
 * and to render Help & glossary; the database decides.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  admin: ["marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "stock.write", "marketing.read", "marketing.write", "marketing.confirm", "source.import", "review.approve", "report.read", "audit.read", "audit.read_all", "settings.manage", "export.customer"],
  management: ["marketing.spend.read", "sales.read", "sales.read_all", "sales.leads.read_all", "contact.reveal", "catalog.read", "price.read", "stock.read", "marketing.read", "report.read", "audit.read"],
  sales_manager: ["marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "price.read", "stock.read", "marketing.read", "marketing.write", "report.read", "audit.read", "export.customer"],
  sales_rep: ["sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "contact.reveal", "purchase.write", "catalog.read", "price.read", "stock.read", "marketing.read", "marketing.write", "review.approve", "report.read", "audit.read"],
  showroom: ["sales.read", "sales.leads.read_all", "sales.write", "feedback.send", "purchase.write", "catalog.read", "price.read", "stock.read", "audit.read"],
  marketing_coordinator: ["marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "marketing.read", "marketing.write", "marketing.confirm", "catalog.read", "audit.read"],
  catalog_pricing: ["catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "source.import", "review.approve", "audit.read"],
  stock_coordinator: ["catalog.read", "price.read", "stock.read", "stock.write", "audit.read"],
  analyst: ["marketing.spend.read", "report.read", "catalog.read", "price.read"],
  guest: ["marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "stock.write", "marketing.read", "marketing.write", "marketing.confirm", "source.import", "review.approve", "report.read", "audit.read", "audit.read_all", "export.customer"],
};

/** Roles that hold a permission, excluding the demo guest. */
export function rolesWith(permission: PermissionKey): RoleKey[] {
  return ROLES.filter((r) => r !== "guest" && ROLE_PERMISSIONS[r].includes(permission));
}

/**
 * One sentence per key naming who can. Shown by `PermissionDenied`, by
 * `Gated` controls, and in refusal toasts, so a person always learns which
 * role to ask for rather than "you do not have permission".
 */
export const PERMISSION_EXPLAINERS: Record<PermissionKey, string> = {
  "sales.read": "Viewing leads, accounts, projects and opportunities needs a sales, showroom, marketing or management role.",
  "sales.read_all": "Seeing every salesperson's records is open to sales representatives, sales managers, management and administrators.",
  "sales.leads.read_all": "Sales representatives, sales managers, management and administrators share visibility of every Enquiry Box lead.",
  "sales.write": "Creating or editing sales records needs a sales representative, sales manager or showroom role.",
  "sales.assign": "Only sales managers and administrators can assign leads.",
  "contact.reveal": "Revealing a masked phone or email needs a sales or management role, and every reveal is audited.",
  "feedback.send": "Showroom staff can reveal the recipient of a visit feedback handoff. Each use is audited; other contact details stay protected.",
  "identity.merge": "Confirming an identity merge is restricted to sales managers and administrators.",
  "purchase.write": "Recording walk-ins and purchases needs a sales representative, sales manager or showroom role.",
  "purchase.correct": "Correcting a recorded purchase is restricted to sales managers and administrators, and is audited.",
  "catalog.read": "Catalog access needs a merchandise, sales, or management role.",
  "catalog.write": "Editing products is restricted to catalog/pricing operators.",
  "price.read": "Seeing prices needs a sales, merchandise, management or analyst role.",
  "price.publish": "Publishing prices is restricted to catalog/pricing operators.",
  "stock.read": "Stock visibility needs a stock, sales, or management role.",
  "stock.write": "Entering supplier stock updates is restricted to stock coordinators.",
  "marketing.read": "Marketing coordination needs a marketing, sales, or management role.",
  "marketing.write": "Nominating projects, recording customer media permission and holding shoot dates needs a sales or marketing coordinator role.",
  "marketing.confirm": "Confirming crew capacity and marking shoot assets usable is restricted to marketing coordinators.",
  "marketing.spend.read": "Marketing costs are visible to marketing coordinators, sales managers, management, administrators and analysts.",
  "marketing.spend.write": "Recording marketing costs needs a marketing coordinator, sales manager or administrator role.",
  "marketing.spend.review": "Correcting marketing costs and confirming complete coverage needs a marketing coordinator, sales manager or administrator role, with a reason.",
  "source.import": "Importing source documents is restricted to catalog/pricing operators.",
  "review.approve": "Approving parsed import items is open to sales representatives, catalog/pricing operators and administrators.",
  "report.read": "Reports are open to sales representatives, sales managers, management, analysts and administrators.",
  "audit.read": "The audit trail is visible to every operational role within its own scope.",
  "audit.read_all": "Seeing the whole workspace's audit trail is restricted to administrators.",
  "settings.manage": "Settings and user management are restricted to administrators.",
  "export.customer": "Exporting customer data is restricted to sales managers and administrators.",
};

export function can(perms: ReadonlySet<string> | string[], permission: PermissionKey): boolean {
  return Array.isArray(perms) ? perms.includes(permission) : perms.has(permission);
}
