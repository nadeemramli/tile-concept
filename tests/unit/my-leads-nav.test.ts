import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, ROLES } from "@/lib/rbac/matrix";
import { areaForPath } from "@/lib/workspace/areas";
import { chromeRoutes, routeLabel, ROUTES, sidebarRoutes } from "@/lib/nav/routes";

const perms = (role: (typeof ROLES)[number]) => new Set<string>(ROLE_PERMISSIONS[role]);
const myLeads = ROUTES.find((r) => r.key === "my-leads")!;

describe("My Leads navigation (TILE-56)", () => {
  it("is a top-bar shortcut for members who work leads, never a sidebar item", () => {
    const shortcut = ROLES.filter((role) => chromeRoutes(perms(role), "top-bar").some((r) => r.key === "my-leads"));
    expect(shortcut.sort()).toEqual(ROLES.filter((role) => perms(role).has("sales.write")).sort());
    expect(shortcut).toEqual(expect.arrayContaining(["sales_rep", "sales_manager", "showroom"]));
    for (const role of ROLES) expect(sidebarRoutes(perms(role)).map((r) => r.key)).not.toContain("my-leads");
  });

  it("gives drivers, warehouse and office staff no shortcut", () => {
    for (const role of ["driver", "warehouse", "business_admin", "marketing_coordinator"] as const) {
      expect(chromeRoutes(perms(role), "top-bar").map((r) => r.key)).not.toContain("my-leads");
    }
  });

  it("is labelled in both languages and belongs to the Operating System", () => {
    expect(routeLabel(myLeads, "ms")).toBe("Prospek Saya");
    expect(routeLabel(myLeads, "en")).toBe("My Leads");
    expect(areaForPath(myLeads.path)).toBe("operating");
  });
});
