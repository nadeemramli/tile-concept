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
  "creative.approve",
  "creative.publish",
  "creative.self_approve",
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
  "workspace.operating",
  "workspace.admin",
  "overview.read",
  "admin.coordinate",
  "preparation.read",
  "delivery.read_own",
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
  // Admin System roles (20261029000001_workspace_entry.sql). A business admin
  // employee is not a platform administrator.
  "business_admin",
  "warehouse",
  "driver",
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
  business_admin: "Admin employee",
  warehouse: "Warehouse staff",
  driver: "Delivery driver",
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
  "creative.approve": "Review and approve a specific creative version",
  "creative.publish": "Record scheduling and publication of approved creative versions",
  "creative.self_approve": "Approve your own creative submission with an audited decision",
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
  "workspace.operating": "Enter the Operating System (sales, showroom, marketing, catalogue)",
  "workspace.admin": "Enter the Admin System (order preparation and deliveries)",
  "overview.read": "Start on the Management Overview across both systems",
  "admin.coordinate": "Open the Admin System hub with every admin queue",
  "preparation.read": "See the warehouse preparation queue",
  "delivery.read_own": "See deliveries assigned to you",
};

/**
 * Role → permissions, mirrored from `core.role_permissions`
 * (`supabase/migrations/20260820000001_foundation.sql`, the Enquiry Box
 * migration, `20260823000001_guest_mode.sql` and `20261029000001_workspace_entry.sql`). Used only to explain gates
 * and to render Help & glossary; the database decides.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  admin: ["creative.approve", "creative.publish", "creative.self_approve", "marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "stock.write", "marketing.read", "marketing.write", "marketing.confirm", "source.import", "review.approve", "report.read", "audit.read", "audit.read_all", "settings.manage", "export.customer", "workspace.operating", "workspace.admin", "admin.coordinate", "preparation.read", "delivery.read_own"],
  management: ["marketing.spend.read", "sales.read", "sales.read_all", "sales.leads.read_all", "contact.reveal", "catalog.read", "price.read", "stock.read", "marketing.read", "report.read", "audit.read", "workspace.operating", "workspace.admin", "overview.read", "admin.coordinate", "preparation.read"],
  sales_manager: ["marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "price.read", "stock.read", "marketing.read", "marketing.write", "report.read", "audit.read", "export.customer", "workspace.operating"],
  sales_rep: ["sales.read_all", "review.approve", "report.read", "sales.read", "sales.leads.read_all", "sales.write", "contact.reveal", "purchase.write", "catalog.read", "price.read", "stock.read", "marketing.read", "marketing.write", "audit.read", "workspace.operating"],
  showroom: ["sales.read", "sales.leads.read_all", "sales.write", "feedback.send", "purchase.write", "catalog.read", "price.read", "stock.read", "audit.read", "workspace.operating"],
  marketing_coordinator: ["creative.approve", "creative.publish", "marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "marketing.read", "marketing.write", "marketing.confirm", "catalog.read", "audit.read", "workspace.operating"],
  catalog_pricing: ["catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "source.import", "review.approve", "audit.read", "workspace.operating"],
  stock_coordinator: ["catalog.read", "price.read", "stock.read", "stock.write", "audit.read", "workspace.operating"],
  analyst: ["marketing.spend.read", "report.read", "catalog.read", "price.read", "workspace.operating"],
  business_admin: ["workspace.admin", "admin.coordinate", "preparation.read"],
  warehouse: ["workspace.admin", "preparation.read"],
  driver: ["workspace.admin", "delivery.read_own"],
  guest: ["creative.approve", "creative.publish", "creative.self_approve", "marketing.spend.read", "marketing.spend.write", "marketing.spend.review", "sales.read", "sales.read_all", "sales.leads.read_all", "sales.write", "sales.assign", "contact.reveal", "identity.merge", "purchase.write", "purchase.correct", "catalog.read", "catalog.write", "price.read", "price.publish", "stock.read", "stock.write", "marketing.read", "marketing.write", "marketing.confirm", "source.import", "review.approve", "report.read", "audit.read", "audit.read_all", "export.customer", "workspace.operating", "workspace.admin", "overview.read", "admin.coordinate", "preparation.read", "delivery.read_own"],
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
  "sales.read_all": "Seeing every salesperson's records is available to sales representatives, sales managers, management and administrators.",
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
  "creative.approve": "Creative approval needs the assigned marketing coordinator or an administrator; creators do not receive approval rights automatically.",
  "creative.publish": "Recording a scheduled or published release needs a marketing coordinator or administrator and an approved version.",
  "creative.self_approve": "Only administrators may approve their own creative submission. Demo guests may exercise the flow inside the isolated demo workspace.",
  "marketing.spend.read": "Marketing costs are visible to marketing coordinators, sales managers, management, administrators and analysts.",
  "marketing.spend.write": "Recording marketing costs needs a marketing coordinator, sales manager or administrator role.",
  "marketing.spend.review": "Correcting marketing costs and confirming complete coverage needs a marketing coordinator, sales manager or administrator role, with a reason.",
  "source.import": "Importing source documents is restricted to catalog/pricing operators.",
  "review.approve": "Approving parsed import items is available to sales representatives, catalog/pricing operators and administrators.",
  "report.read": "Reports are available to sales representatives, sales managers, management, analysts and administrators.",
  "audit.read": "The audit trail is visible to every operational role within its own scope.",
  "audit.read_all": "Seeing the whole workspace's audit trail is restricted to administrators.",
  "settings.manage": "Settings and user management are restricted to administrators.",
  "export.customer": "Exporting customer data is restricted to sales managers and administrators.",
  "workspace.operating": "The Operating System is for sales, showroom, marketing, catalogue, stock and management roles. Admin System roles (admin employee, warehouse, driver) do not enter it.",
  "workspace.admin": "The Admin System is for admin employees, warehouse staff, drivers, management and platform administrators.",
  "overview.read": "The Management Overview is the starting page for management.",
  "admin.coordinate": "The Admin System hub is for admin employees, management and platform administrators.",
  "preparation.read": "The preparation queue is for warehouse staff, admin employees, management and platform administrators.",
  "delivery.read_own": "My Deliveries is for delivery drivers.",
};

export function can(perms: ReadonlySet<string> | string[], permission: PermissionKey): boolean {
  return Array.isArray(perms) ? perms.includes(permission) : perms.has(permission);
}
