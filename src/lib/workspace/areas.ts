import type { PermissionKey } from "@/lib/rbac/matrix";

/**
 * One business, one dataset, two areas of the same workspace. Which areas a
 * member may enter is a permission in `core.role_permissions`; the area a page
 * belongs to is decided by its path. Nothing here grants access — every page
 * still checks its own permission, and the database re-checks every read.
 */
export const AREAS = ["operating", "admin"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_PERMISSION: Record<Area, PermissionKey> = {
  operating: "workspace.operating",
  admin: "workspace.admin",
};

type Perms = ReadonlySet<string> | readonly string[];

/** The keys that decide workspace entry and landing. */
export const ENTRY_PERMISSIONS = ["workspace.operating", "workspace.admin", "overview.read", "admin.coordinate", "preparation.read", "delivery.read_own"] as const satisfies readonly PermissionKey[];

/**
 * `api.my_permissions()` is the union over all of a user's memberships, so a
 * driver here who is a sales rep in another workspace would appear to hold
 * `workspace.operating`. Entry keys therefore come from the acting membership
 * only (`api.my_workspace_permissions()`); every other key is passed through
 * unchanged, which keeps this change from touching existing authorization.
 */
export function scopeEntryPermissions(aggregated: readonly string[], acting: readonly string[]): string[] {
  const entry = new Set<string>(ENTRY_PERMISSIONS);
  return [...aggregated.filter((p) => !entry.has(p)), ...acting.filter((p) => entry.has(p))];
}

function has(perms: Perms, p: PermissionKey): boolean {
  return perms instanceof Set ? perms.has(p) : (perms as readonly string[]).includes(p);
}

export function isArea(value: unknown): value is Area {
  return typeof value === "string" && (AREAS as readonly string[]).includes(value);
}

export function permittedAreas(perms: Perms): Area[] {
  return AREAS.filter((a) => has(perms, AREA_PERMISSION[a]));
}

/** Pages that sit above both areas: the overview and the area chooser. */
export const NEUTRAL_PATHS = ["/overview", "/start"] as const;

export function areaForPath(pathname: string): Area | "neutral" {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if ((NEUTRAL_PATHS as readonly string[]).some((p) => pathname === p || pathname.startsWith(`${p}/`))) return "neutral";
  return "operating";
}

/**
 * Where an area starts for this member. Drivers open straight onto My
 * Deliveries and warehouse staff onto the preparation queue; anyone who
 * coordinates the Admin System gets its hub.
 */
export function areaHome(area: Area, perms: Perms): string {
  if (area === "operating") return "/";
  if (has(perms, "admin.coordinate")) return "/admin";
  if (has(perms, "delivery.read_own")) return "/admin/my-deliveries";
  if (has(perms, "preparation.read")) return "/admin/preparation";
  return "/admin";
}

export type Landing = { kind: "redirect"; href: string } | { kind: "choose"; areas: Area[] } | { kind: "none" };

/**
 * The landing rule, in order:
 *  1. no area at all → nothing to enter (the page says so; no redirect loop);
 *  2. one area → straight into it;
 *  3. both, with overview.read (management) → the Management Overview;
 *  4. both, with a remembered default that is still permitted → that area;
 *  5. both, nothing remembered → ask.
 * A remembered default for an area the member can no longer enter is ignored,
 * which is why storing a preference can never act as a grant.
 */
export function resolveLanding(perms: Perms, defaultArea: string | null | undefined): Landing {
  const areas = permittedAreas(perms);
  if (areas.length === 0) return { kind: "none" };
  if (areas.length === 1) return { kind: "redirect", href: areaHome(areas[0], perms) };
  if (has(perms, "overview.read")) return { kind: "redirect", href: "/overview" };
  if (isArea(defaultArea) && areas.includes(defaultArea)) return { kind: "redirect", href: areaHome(defaultArea, perms) };
  return { kind: "choose", areas };
}

/** Only dual-area members without a fixed overview landing pick a default. */
export function canRememberDefault(perms: Perms): boolean {
  return permittedAreas(perms).length > 1 && !has(perms, "overview.read");
}
