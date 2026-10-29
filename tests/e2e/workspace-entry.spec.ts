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
import { submitPasswordForm } from "./login-form";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
// The seeded administrator, only as a lead owner in a refused command: this
// spec never signs it in, out, or writes its preferences.
const SEED_ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REP = "demo.rep1@tileconcept.test";
const run = randomUUID().slice(0, 8);
// An administrator here, owned by this spec: it signs out (which ends every
// session of that account) and stores a default area, so a shared seed account
// in its place would be signed out under, and re-routed for, the specs running
// alongside this one.
const CHOOSER = { id: randomUUID(), email: `e2e.chooser.${run}@tileconcept.test`, name: "E2E Chooser" };
const USERS = {
  management: { id: randomUUID(), email: `e2e.management.${run}@tileconcept.test`, name: "E2E Management" },
  driver: { id: randomUUID(), email: `e2e.driver.${run}@tileconcept.test`, name: "E2E Driver" },
  warehouse: { id: randomUUID(), email: `e2e.warehouse.${run}@tileconcept.test`, name: "E2E Warehouse" },
  business_admin: { id: randomUUID(), email: `e2e.office.${run}@tileconcept.test`, name: "E2E Office" },
} as const;
// Driver here (the acting, oldest membership) and sales rep in another workspace.
const DUAL = { id: randomUUID(), email: `e2e.dual.${run}@tileconcept.test`, name: "E2E Dual" };
// The reverse (TILE-62): admin in another workspace (acting) and driver here.
const REVERSE = { id: randomUUID(), email: `e2e.reverse.${run}@tileconcept.test`, name: "E2E Reverse" };
const OTHER_WORKSPACE = randomUUID();
const OWNED = [...Object.values(USERS), DUAL, REVERSE, CHOOSER];

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const API_URL: string = status.API_URL;
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const values = OWNED.map((u) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${OWNED.map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.memberships(workspace_id,user_id,role_key) values
         ${Object.entries(USERS).map(([role, u]) => `('${WORKSPACE}','${u.id}','${role}')`).join(",")};
       insert into core.workspaces(id,slug,name) values ('${OTHER_WORKSPACE}','e2e-entry-${run}','E2E other workspace');
       insert into core.memberships(workspace_id,user_id,role_key,created_at) values
         ('${WORKSPACE}','${DUAL.id}','driver',now()-interval '1 day'),
         ('${OTHER_WORKSPACE}','${DUAL.id}','sales_rep',now()),
         ('${OTHER_WORKSPACE}','${REVERSE.id}','admin',now()-interval '1 day'),
         ('${WORKSPACE}','${REVERSE.id}','driver',now()),
         ('${WORKSPACE}','${CHOOSER.id}','admin',now());`);
});

test.afterAll(() => {
  const ids = OWNED.map((u) => `'${u.id}'`).join(",");
  // The other workspace first: the lead the reverse admin created there references its author.
  sql(`delete from core.user_preferences where user_id in (${ids});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.memberships where user_id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.user_preferences where user_id in (${ids})`), "0");
});

async function signIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await submitPasswordForm(page, email, PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/**
 * Sign-out ends every session of the account, in every browser. Only an
 * account this spec owns may be signed out here; see CHOOSER.
 */
async function signOut(page: Page) {
  const { sub } = JSON.parse(Buffer.from((await accessToken(page.context())).split(".")[1], "base64url").toString("utf8"));
  assert(OWNED.some((u) => u.id === sub), `signing out ${sub} would end the sessions of an account this spec does not own`);
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

/** A PostgREST call on the `api` schema with the browser's own session. */
async function rest(context: BrowserContext, method: string, path: string, body?: object) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessToken(context)}`, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

/** Workspace data a borrowed permission could read or change. */
const workspaceFingerprint = () =>
  sql(`select md5(concat_ws('|',
         (select string_agg(to_jsonb(l)::text, ',' order by l.id) from sales.leads l where l.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(c)::text, ',' order by c.id) from identity.contacts c where c.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(i)::text, ',' order by i.id) from core.membership_invites i where i.workspace_id='${WORKSPACE}'),
         (select count(*)::text from audit.audit_events e where e.workspace_id='${WORKSPACE}')))`);

/** Every way the browser session could reach this workspace's customers, refused. */
async function expectNoBorrowedAccess(context: BrowserContext) {
  const contact = sql(`select id from identity.contacts where workspace_id='${WORKSPACE}' and merged_into_contact_id is null order by id limit 1`);
  const lead = sql(`select id from sales.leads where workspace_id='${WORKSPACE}' order by id limit 1`);
  expect((await rest(context, "GET", `leads?workspace_id=eq.${WORKSPACE}&select=id`)).body).toBe("[]");
  expect((await rest(context, "GET", `contacts?workspace_id=eq.${WORKSPACE}&select=id`)).body).toBe("[]");
  expect((await rest(context, "GET", `contact_points?workspace_id=eq.${WORKSPACE}&select=id`)).body).toBe("[]");
  expect((await rpc(context, "reveal_contact_points", { p_contact_id: contact })).status).toBe(403);
  expect((await rpc(context, "assign_lead", { p_lead_id: lead, p_owner_id: SEED_ADMIN_ID })).status).toBe(403);
  expect((await rest(context, "POST", "leads", { workspace_id: WORKSPACE, source_channel: "other" })).status).toBe(403);
  expect((await rest(context, "PATCH", `contacts?workspace_id=eq.${WORKSPACE}`, { display_name: "Borrowed" })).body).toBe("[]");
  expect((await rest(context, "POST", "membership_invites", { workspace_id: WORKSPACE, email: `e2e.borrowed.${run}@tileconcept.test`, role_key: "admin" })).status).toBe(403);
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

  test("a sales role in another workspace does not open the Operating System here", async ({ page, context }) => {
    await signIn(page, DUAL.email);
    await expect(page).toHaveURL(/\/admin\/my-deliveries$/);
    expect(await currentArea(page)).toBe("Admin System");
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin\/my-deliveries$/);
    await page.goto("/overview");
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
    await page.goto("/admin/preparation");
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible();
    const operating = await rpc(context, "set_default_area", { p_area: "operating" });
    expect(operating.status).toBe(403);
    expect(operating.body).toContain("workspace.operating");
    expect(sql(`select count(*) from core.user_preferences where user_id='${DUAL.id}'`)).toBe("0");

    // TILE-62: the sales role elsewhere reaches none of this workspace's data,
    // through the pages or straight at the service, before and after a reload.
    const before = workspaceFingerprint();
    await page.goto("/sales/inbox");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await expectNoBorrowedAccess(context);
    expect((await rpc(context, "command_centre_summary", {})).status).toBe(403);
    expect((await rpc(context, "global_search", { p_query: "a" })).body).toBe("[]");
    await page.reload();
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await expectNoBorrowedAccess(context);
    expect(workspaceFingerprint()).toBe(before);
  });

  test("an admin role elsewhere does not reach this workspace through a driver membership here", async ({ page, context }) => {
    await signIn(page, REVERSE.email);
    // Acting as the admin of the other workspace: its own areas, nothing here.
    const before = workspaceFingerprint();
    await expectNoBorrowedAccess(context);
    expect(JSON.parse((await rpc(context, "global_search", { p_query: "a" })).body)).toEqual([]);
    expect(workspaceFingerprint()).toBe(before);
    // Legitimate: the admin membership still writes its own workspace, and it persists.
    const created = await rest(context, "POST", "leads", { workspace_id: OTHER_WORKSPACE, source_channel: "other" });
    expect(created.status).toBe(201);
    expect(sql(`select count(*) from sales.leads where workspace_id='${OTHER_WORKSPACE}'`)).toBe("1");
    await page.reload();
    expect(JSON.parse((await rest(context, "GET", `leads?workspace_id=eq.${OTHER_WORKSPACE}&select=id`)).body)).toHaveLength(1);
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
    await signIn(page, CHOOSER.email);
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByRole("heading", { name: "Choose a workspace" })).toBeVisible();
    await page.getByText("Remember my choice").click();
    await page.getByRole("button", { name: "Enter: Admin System" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(sql(`select default_area from core.user_preferences where user_id='${CHOOSER.id}'`)).toBe("admin");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Admin System", level: 1 })).toBeVisible();
    await signOut(page);
    await signIn(page, CHOOSER.email);
    await expect(page).toHaveURL(/\/admin$/);

    // Change it from the switcher; the radio reflects the stored value after reload.
    await page.getByRole("button", { name: "Workspace: Admin System" }).click();
    await page.getByRole("menuitemradio", { name: "Operating System" }).click();
    await expect(page.getByText("Start page saved.")).toBeVisible();
    await expect.poll(() => sql(`select default_area from core.user_preferences where user_id='${CHOOSER.id}'`)).toBe("operating");
    await page.reload();
    await page.getByRole("button", { name: "Workspace: Admin System" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Operating System" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await signOut(page);
    await signIn(page, CHOOSER.email);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Command Centre" })).toBeVisible();

    // (A stale default for an area the role can no longer enter is ignored —
    // covered by tests/unit/workspace-entry.test.ts, not here, because changing
    // a shared role's grants would race the other specs' administrator runs.)

    // Clearing brings the chooser back.
    await page.getByRole("button", { name: "Workspace: Operating System" }).click();
    await page.getByRole("menuitemradio", { name: "Ask me each time" }).click();
    await expect(page.getByText("You will be asked each time you sign in.")).toBeVisible();
    await expect.poll(() => sql(`select coalesce(default_area,'∅') from core.user_preferences where user_id='${CHOOSER.id}'`)).toBe("∅");
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
