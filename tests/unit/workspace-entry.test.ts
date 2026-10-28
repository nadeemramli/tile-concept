import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS, ROLES, type RoleKey } from "@/lib/rbac/matrix";
import { areaForPath, areaHome, canRememberDefault, permittedAreas, resolveLanding, scopeEntryPermissions } from "@/lib/workspace/areas";
import { sidebarRoutes } from "@/lib/nav/routes";
import { DEFAULT_LOCALE, parseLocale } from "@/lib/i18n/locale";
import { MESSAGES } from "@/lib/i18n/messages";
import { safeAuthNext } from "@/lib/auth-links";

const perms = (role: RoleKey) => new Set<string>(ROLE_PERMISSIONS[role]);

describe("workspace areas", () => {
  it("gives every role a deliberate set of areas", () => {
    const areas = Object.fromEntries(ROLES.map((r) => [r, permittedAreas(perms(r))]));
    expect(areas).toEqual({
      admin: ["operating", "admin"],
      management: ["operating", "admin"],
      sales_manager: ["operating"],
      sales_rep: ["operating"],
      showroom: ["operating"],
      marketing_coordinator: ["operating"],
      catalog_pricing: ["operating"],
      stock_coordinator: ["operating"],
      analyst: ["operating"],
      business_admin: ["admin"],
      warehouse: ["admin"],
      driver: ["admin"],
      guest: ["operating", "admin"],
    });
  });

  it("lands each role where the brief says", () => {
    const land = (role: RoleKey, def: string | null = null) => resolveLanding(perms(role), def);
    expect(land("management")).toEqual({ kind: "redirect", href: "/overview" });
    expect(land("driver")).toEqual({ kind: "redirect", href: "/admin/my-deliveries" });
    expect(land("warehouse")).toEqual({ kind: "redirect", href: "/admin/preparation" });
    expect(land("business_admin")).toEqual({ kind: "redirect", href: "/admin" });
    for (const role of ["sales_manager", "sales_rep", "showroom", "marketing_coordinator", "catalog_pricing", "stock_coordinator", "analyst"] as const) {
      expect(land(role), role).toEqual({ kind: "redirect", href: "/" });
    }
    // Dual-area without a fixed overview: ask, then honour the remembered area.
    expect(land("admin")).toEqual({ kind: "choose", areas: ["operating", "admin"] });
    expect(land("admin", "admin")).toEqual({ kind: "redirect", href: "/admin" });
    expect(land("admin", "operating")).toEqual({ kind: "redirect", href: "/" });
  });

  it("never lets a remembered area act as a grant", () => {
    // A driver whose stored default somehow says "operating" still lands in the Admin System.
    expect(resolveLanding(perms("driver"), "operating")).toEqual({ kind: "redirect", href: "/admin/my-deliveries" });
    // A dual-area member whose operating access was removed: the stale default is ignored.
    const reduced = new Set(perms("admin"));
    reduced.delete("workspace.operating");
    expect(resolveLanding(reduced, "operating")).toEqual({ kind: "redirect", href: "/admin" });
    // Garbage is ignored.
    expect(resolveLanding(perms("admin"), "everything")).toEqual({ kind: "choose", areas: ["operating", "admin"] });
    // No area at all: nothing to redirect to (and so no loop through / and /start).
    expect(resolveLanding(new Set(["sales.read"]), "operating")).toEqual({ kind: "none" });
  });

  it("offers a remembered default only to dual-area roles without the overview", () => {
    expect(canRememberDefault(perms("admin"))).toBe(true);
    expect(canRememberDefault(perms("management"))).toBe(false);
    expect(canRememberDefault(perms("driver"))).toBe(false);
    expect(canRememberDefault(perms("sales_rep"))).toBe(false);
  });

  it("classifies paths into areas without disturbing existing bookmarks", () => {
    expect(areaForPath("/")).toBe("operating");
    expect(areaForPath("/sales/inbox")).toBe("operating");
    expect(areaForPath("/platform/help")).toBe("operating");
    expect(areaForPath("/admin")).toBe("admin");
    expect(areaForPath("/admin/my-deliveries")).toBe("admin");
    expect(areaForPath("/administrator")).toBe("operating");
    expect(areaForPath("/overview")).toBe("neutral");
    expect(areaForPath("/start")).toBe("neutral");
    expect(areaHome("operating", perms("admin"))).toBe("/");
  });
});

describe("dual membership", () => {
  it("takes entry keys from the acting membership only", () => {
    // Driver in the acting workspace, sales rep in another: the union says
    // "operating", the acting role does not.
    const union = [...new Set([...ROLE_PERMISSIONS.driver, ...ROLE_PERMISSIONS.sales_rep])];
    const scoped = scopeEntryPermissions(union, ROLE_PERMISSIONS.driver);
    expect(permittedAreas(scoped)).toEqual(["admin"]);
    expect(resolveLanding(scoped, "operating")).toEqual({ kind: "redirect", href: "/admin/my-deliveries" });
    // Non-entry keys are passed through untouched (existing behaviour, recorded gap).
    expect(scoped).toContain("sales.read");
    // And the reverse: a sales rep here who drives elsewhere gets no Admin System.
    const reverse = scopeEntryPermissions(union, ROLE_PERMISSIONS.sales_rep);
    expect(permittedAreas(reverse)).toEqual(["operating"]);
    expect(reverse).not.toContain("delivery.read_own");
  });
});

describe("area sidebars", () => {
  const keys = (role: RoleKey, area: "operating" | "admin") => sidebarRoutes(perms(role), area).map((r) => r.key);

  it("keeps the Operating System sidebar unchanged and free of admin queues", () => {
    expect(keys("admin", "operating")).not.toContain("preparation");
    expect(keys("admin", "operating")).not.toContain("my-deliveries");
    expect(keys("sales_rep", "operating")).toEqual(["pipeline", "projects", "walkins", "feedback", "inbox", "accounts", "creative", "content-opps", "shoot-calendar", "catalog", "pricing", "stock", "reports"]);
  });

  it("gives a driver exactly one menu item and nothing from sales", () => {
    expect(keys("driver", "admin")).toEqual(["my-deliveries"]);
    expect(keys("driver", "operating")).toEqual([]);
    expect(keys("warehouse", "admin")).toEqual(["preparation"]);
    expect(keys("management", "admin")).toEqual(["admin-home", "preparation"]);
  });
});

describe("management oversight stays oversight", () => {
  it("adds no approval, posting or user-management permission", () => {
    const m = perms("management");
    for (const p of ["stock.write", "settings.manage", "purchase.correct", "price.publish", "review.approve", "marketing.spend.review", "marketing.spend.write", "identity.merge", "catalog.write", "sales.assign", "export.customer"]) {
      expect(m.has(p), p).toBe(false);
    }
  });

  it("keeps the business admin employee distinct from the platform administrator", () => {
    const b = perms("business_admin");
    for (const p of ["settings.manage", "audit.read_all", "sales.read", "contact.reveal", "workspace.operating"]) expect(b.has(p), p).toBe(false);
  });

  it("gives drivers no sales, customer or catalogue access", () => {
    expect([...perms("driver")].sort()).toEqual(["delivery.read_own", "workspace.admin"]);
  });
});

describe("language", () => {
  it("defaults to Bahasa Melayu and accepts only known locales", () => {
    expect(DEFAULT_LOCALE).toBe("ms");
    expect(parseLocale(undefined)).toBe("ms");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("fr")).toBe("ms");
  });

  it("has every message in both languages, none empty", () => {
    const flatten = (o: object, prefix = ""): Record<string, string> =>
      Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => (typeof v === "string" ? { ...acc, [prefix + k]: v } : { ...acc, ...flatten(v, `${prefix}${k}.`) }), {});
    const ms = flatten(MESSAGES.ms);
    const en = flatten(MESSAGES.en);
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(ms), ...Object.entries(en)]) expect(v.trim(), k).not.toBe("");
    expect(ms["login.signIn"]).not.toBe(en["login.signIn"]);
  });
});

describe("deep links after sign-in", () => {
  it("keeps the full in-app destination and defaults to the landing rule", () => {
    expect(safeAuthNext("/sales/inbox?view=unassigned&lead=abc", "/start")).toBe("/sales/inbox?view=unassigned&lead=abc");
    expect(safeAuthNext(undefined, "/start")).toBe("/start");
    expect(safeAuthNext("//evil.example", "/start")).toBe("/start");
  });
});
