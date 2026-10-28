/**
 * TILE-32: one shared sign-in, Operating System / Admin System entry, role
 * landings, the remembered default, deep links, denials and BM/EN — against a
 * running app and the LOCAL Supabase stack. Synthetic accounts only; refuses
 * hosted targets and removes everything it created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN = "demo.admin@tileconcept.test";
const REP = "demo.rep1@tileconcept.test";
const run = randomUUID().slice(0, 8);
const USERS = {
  management: { id: randomUUID(), email: `e2e.management.${run}@tileconcept.test`, name: "E2E Management" },
  driver: { id: randomUUID(), email: `e2e.driver.${run}@tileconcept.test`, name: "E2E Driver" },
  warehouse: { id: randomUUID(), email: `e2e.warehouse.${run}@tileconcept.test`, name: "E2E Warehouse" },
  business_admin: { id: randomUUID(), email: `e2e.office.${run}@tileconcept.test`, name: "E2E Office" },
} as const;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const API_URL: string = status.API_URL;
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const values = Object.entries(USERS).map(([, u]) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${Object.values(USERS).map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.memberships(workspace_id,user_id,role_key) values
         ${Object.entries(USERS).map(([role, u]) => `('${WORKSPACE}','${u.id}','${role}')`).join(",")};
       delete from core.user_preferences where user_id='${ADMIN_ID}';`);
});

test.afterAll(() => {
  sql(`delete from core.user_preferences where user_id='${ADMIN_ID}';
       delete from auth.users where id in (${Object.values(USERS).map((u) => `'${u.id}'`).join(",")});`);
});

async function signIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form").filter({ has: page.locator("#password") }).locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: /Sign out|Log keluar/ }).click();
  await page.waitForURL("**/login**");
}

/** The browser's own Supabase session, read from the SSR auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

async function rpc(context: BrowserContext, fn: string, body: object) {
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessToken(context)}`, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
/** The visible area label (the short and full forms are swapped by breakpoint). */
const currentArea = (page: Page) => page.getByTestId("workspace-current").innerText();

test.describe("landings and denials", () => {
  test("a driver lands on My Deliveries with no sales surface", async ({ page, context }) => {
    await signIn(page, USERS.driver.email);
    await expect(page).toHaveURL(/\/admin\/my-deliveries$/);
    await expect(page.getByRole("heading", { name: "My Deliveries", level: 1 })).toBeVisible();
    await expect(page.getByText("The delivery list is not built yet")).toBeVisible();
    await expect(primaryNav(page).getByRole("link")).toHaveText(["My Deliveries"]);
    await expect(page.getByRole("button", { name: "Open global search" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
    expect(await currentArea(page)).toBe("Admin System");

    // The Command Centre bookmark sends a driver home instead of a sales dashboard.
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin\/my-deliveries$/);
    // Sales pages and other admin queues refuse.
    await page.goto("/sales/inbox");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await page.goto("/sales/pipeline?view=overdue");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    for (const path of ["/admin/preparation", "/overview"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to my start page" })).toHaveAttribute("href", "/admin/my-deliveries");
    }

    // Commands against the real service with the driver's own browser session.
    expect((await rpc(context, "command_centre_summary", {})).status).toBe(403);
    expect((await rpc(context, "global_search", { p_query: "a" })).body).toBe("[]");
    const operating = await rpc(context, "set_default_area", { p_area: "operating" });
    expect(operating.status).toBe(403);
    expect(operating.body).toContain("workspace.operating");
    expect(sql(`select count(*) from core.user_preferences where user_id='${USERS.driver.id}'`)).toBe("0");
  });

  test("warehouse lands on preparation and an admin employee on the Admin System hub", async ({ page }) => {
    await signIn(page, USERS.warehouse.email);
    await expect(page).toHaveURL(/\/admin\/preparation$/);
    await expect(page.getByRole("heading", { name: "Order preparation", level: 1 })).toBeVisible();
    await expect(page.getByText("The preparation queue is not built yet")).toBeVisible();
    await expect(primaryNav(page).getByRole("link")).toHaveText(["Order preparation"]);
    await signOut(page);

    await signIn(page, USERS.business_admin.email);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin System", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open: Order preparation" })).toBeVisible();
    await expect(page.getByText("Not built yet").first()).toBeVisible();
    await page.goto("/platform/settings");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await page.goto("/sales/accounts");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
  });

  test("a sales representative still lands on the Command Centre", async ({ page }) => {
    await signIn(page, REP);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();
    expect(await currentArea(page)).toBe("Operating System");
    await expect(primaryNav(page).getByRole("link", { name: "Pipeline" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Order preparation" })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
  });
});

test.describe("management and dual-area members", () => {
  test("management starts on the overview and browses both systems in one session", async ({ page }) => {
    await signIn(page, USERS.management.email);
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole("heading", { name: "Management Overview", level: 1 })).toBeVisible();
    await expect(page.getByText(/does not include stock, accounting or user-management approval/)).toBeVisible();
    await expect(page.getByText("Not built yet", { exact: true })).toHaveCount(2);

    const visited: string[] = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname); });
    const before = await accessToken(page.context());

    await page.getByRole("link", { name: "Open: Operating System" }).click();
    await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();
    await expect(page.getByText("All sales records")).toBeVisible();

    await page.getByRole("button", { name: "Workspace: Operating System" }).click();
    await page.getByRole("menuitem", { name: "Admin System" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin System", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Workspace: Admin System" }).click();
    // Management's landing is fixed; there is no start-page choice to make.
    await expect(page.getByText("Ask me each time")).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Management Overview" }).click();
    await expect(page).toHaveURL(/\/overview$/);

    expect(visited.filter((p) => p.startsWith("/login"))).toEqual([]);
    expect(await accessToken(page.context())).toBe(before);

    // Browsing both systems grants no approval or administration.
    await page.goto("/platform/settings");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await page.goto("/admin/my-deliveries");
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
  });

  test("a dual-area member chooses, and the remembered default survives reload and sign-in", async ({ page }) => {
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByRole("heading", { name: "Choose a workspace" })).toBeVisible();
    await page.getByText("Remember my choice").click();
    await page.getByRole("button", { name: "Enter: Admin System" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(sql(`select default_area from core.user_preferences where user_id='${ADMIN_ID}'`)).toBe("admin");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin System", level: 1 })).toBeVisible();
    await signOut(page);
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/admin$/);

    // Change it from the switcher; the radio reflects the stored value after reload.
    await page.getByRole("button", { name: "Workspace: Admin System" }).click();
    await page.getByRole("menuitemradio", { name: "Operating System" }).click();
    await expect(page.getByText("Start page saved.")).toBeVisible();
    await expect.poll(() => sql(`select default_area from core.user_preferences where user_id='${ADMIN_ID}'`)).toBe("operating");
    await page.reload();
    await page.getByRole("button", { name: "Workspace: Admin System" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Operating System" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await signOut(page);
    await signIn(page, ADMIN);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();

    // (A stale default for an area the role can no longer enter is ignored —
    // covered by tests/unit/workspace-entry.test.ts, not here, because changing
    // a shared role's grants would race the other specs' administrator runs.)

    // Clearing brings the chooser back.
    await page.getByRole("button", { name: "Workspace: Operating System" }).click();
    await page.getByRole("menuitemradio", { name: "Ask me each time" }).click();
    await expect(page.getByText("You will be asked each time you sign in.")).toBeVisible();
    await expect.poll(() => sql(`select coalesce(default_area,'∅') from core.user_preferences where user_id='${ADMIN_ID}'`)).toBe("∅");
    await page.goto("/start");
    await expect(page.getByRole("heading", { name: "Choose a workspace" })).toBeVisible();
    // The chooser is not the Management Overview, and the switcher says so.
    await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
  });
});

test.describe("deep links", () => {
  test("an authorised deep link survives sign-in, query string included", async ({ page }) => {
    await page.goto("/sales/inbox?view=unassigned");
    await expect(page).toHaveURL(/\/login\?next=%2Fsales%2Finbox%3Fview%3Dunassigned$/);
    await signIn(page, REP, page.url());
    await expect(page).toHaveURL(/\/sales\/inbox\?view=unassigned$/);
  });

  test("management's deep link wins over the overview landing", async ({ page }) => {
    await page.goto("/merchandise/catalog");
    await signIn(page, USERS.management.email, page.url());
    await expect(page).toHaveURL(/\/merchandise\/catalog$/);
  });

  test("an unauthorised deep link is still refused after sign-in", async ({ page }) => {
    await page.goto("/sales/pipeline");
    await signIn(page, USERS.driver.email, page.url());
    await expect(page).toHaveURL(/\/sales\/pipeline$/);
    await expect(page.getByText(/Not available/).first()).toBeVisible();
  });

  test("a signed-in visit to /login follows its next link", async ({ page }) => {
    await signIn(page, REP);
    await page.goto("/login?next=%2Fsales%2Ftasks");
    await expect(page).toHaveURL(/\/sales\/tasks$/);
  });
});

test.describe("Bahasa Melayu by default", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-in is in Bahasa Melayu, switches to English and the choice survives reload", async ({ page }) => {
    await page.goto("/login");
    // The document stays English (most screens are); the translated sign-in declares Malay.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("[lang='ms-MY']").filter({ has: page.locator("#email") })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Log masuk" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk sebagai tetamu" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).first().click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("[lang='ms-MY']").filter({ has: page.locator("#email") })).toHaveCount(0);
    await page.getByRole("button", { name: "Bahasa Melayu" }).first().click();
    await expect(page.getByRole("button", { name: "Log masuk" })).toBeVisible();
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("a driver gets a compact Bahasa Melayu screen with one obvious action", async ({ page }) => {
      await page.goto("/login");
      await page.locator("#email").fill(USERS.driver.email);
      await page.locator("#password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log masuk" }).click();
      await page.waitForURL("**/admin/my-deliveries");
      await expect(page.getByRole("heading", { name: "Penghantaran Saya", level: 1 })).toBeVisible();
      await expect(page.getByText("Belum dibina").first()).toBeVisible();
      await expect(page.locator("main").getByRole("button")).toHaveText(["Semak semula"]);
      await page.locator("main").getByRole("button", { name: "Semak semula" }).click();
      await expect(page.getByRole("heading", { name: "Penghantaran Saya", level: 1 })).toBeVisible();
      // The language switch is in the header itself for a role with no search or Create.
      await expect(page.getByRole("group", { name: "Bahasa / Language" }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog").getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveText(["Penghantaran Saya"]);
    });

    test("a sales representative's phone header fits and the menu holds only the Operating System", async ({ page }) => {
      await signIn(page, REP);
      await expect(page).toHaveURL(/\/$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Nothing in the header is clipped: the user menu ends inside the screen.
      const menu = await page.getByRole("button", { name: "User menu" }).boundingBox();
      expect(menu && menu.x + menu.width).toBeLessThanOrEqual(390);
      await page.getByRole("button", { name: "Open navigation" }).click();
      // The switcher moves into the phone menu, with its full label.
      expect(await page.getByRole("dialog").getByTestId("workspace-current").innerText()).toBe("Sistem Operasi");
      const nav = page.getByRole("dialog").getByRole("navigation", { name: "Primary" });
      await expect(nav.getByRole("link", { name: "Pipeline" })).toBeVisible();
      await expect(nav.getByRole("link", { name: /Penyediaan pesanan|Order preparation/ })).toHaveCount(0);
    });
  });
});
