/**
 * TILE-67: a signed-in account without an active membership must reach a
 * stable, readable explanation with a way out — not bounce between /start and
 * /login forever. Covers no membership, a membership suspended or removed after
 * sign-in, an alternate membership taking over by the acting rule, sign-out
 * and account switch, anonymous and revoked sessions, both languages and
 * reload. Runs against a running app and the LOCAL Supabase stack with
 * synthetic accounts only; refuses hosted targets and removes what it created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const run = randomUUID().slice(0, 8);
const account = (key: string) => ({ id: randomUUID(), email: `e2e.access.${key}.${run}@tileconcept.test`, name: `E2E Access ${key}` });
// Every account below belongs to this suite: no shared seed account is signed
// in, signed out or revoked here, so a concurrent suite cannot be affected by
// (or affect) these sessions.
// Never had a membership.
const NONE = account("none");
// Never had a membership; signs out (which revokes only its own sessions).
const LEAVER = account("leaver");
// An admin here: the authorised account switched to after signing out.
const SWITCHER = account("switcher");
// A sole sales membership here, suspended after sign-in.
const SUSPENDED = account("suspended");
// A sole sales membership here, removed after sign-in.
const REMOVED = account("removed");
// Sales here (older, so acting) and driver in another workspace (newer).
const ALTERNATE = account("alternate");
// Signed in, then its Auth sessions are revoked server-side.
const REVOKED = account("revoked");
const ALL = [NONE, LEAVER, SWITCHER, SUSPENDED, REMOVED, ALTERNATE, REVOKED];
const OTHER_WORKSPACE = randomUUID();

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const API_URL: string = status.API_URL;
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.beforeAll(() => {
  const values = ALL.map((u) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${ALL.map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.workspaces(id,slug,name) values ('${OTHER_WORKSPACE}','e2e-access-${run}','E2E access other workspace');
       insert into core.memberships(workspace_id,user_id,role_key,created_at) values
         ('${WORKSPACE}','${SWITCHER.id}','admin',now()),
         ('${WORKSPACE}','${SUSPENDED.id}','sales_rep',now()),
         ('${WORKSPACE}','${REMOVED.id}','sales_rep',now()),
         ('${WORKSPACE}','${REVOKED.id}','sales_rep',now()),
         ('${WORKSPACE}','${ALTERNATE.id}','sales_rep',now()-interval '1 day'),
         ('${OTHER_WORKSPACE}','${ALTERNATE.id}','driver',now());`);
});

test.afterAll(() => {
  const ids = ALL.map((u) => `'${u.id}'`).join(",");
  sql(`delete from core.user_preferences where user_id in (${ids});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.memberships where user_id in (${ids})`), "0");
});

/** Every page error fails the test. */
let browserErrors: string[] = [];
// TILE-67 DIAGNOSTIC (temporary): the main frame's navigation lifecycle, so a
// navigation inside expectStable's window can be told apart (document load,
// same-document history update, or a redirect loop).
let navLog: string[] = [];
let t0 = 0;
const stamp = () => `${String(Date.now() - t0).padStart(6)}ms`;
test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  navLog = [];
  t0 = Date.now();
  await page.addInitScript(() => {
    const w = window as unknown as { __tcDoc: string; __tcHist: string[] };
    w.__tcDoc = Math.random().toString(36).slice(2, 8);
    w.__tcHist = [];
    for (const fn of ["pushState", "replaceState"] as const) {
      const original = history[fn].bind(history);
      history[fn] = (data: unknown, unused: string, url?: string | URL | null) => {
        w.__tcHist.push(`${Math.round(performance.now())} ${fn} ${url ?? "(same)"} -> doc ${w.__tcDoc}`);
        return original(data, unused, url);
      };
    }
    document.addEventListener("DOMContentLoaded", () => w.__tcHist.push(`${Math.round(performance.now())} DOMContentLoaded doc ${w.__tcDoc} ${location.pathname}`));
  });
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navLog.push(`${stamp()} document request ${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
  });
  page.on("response", (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) navLog.push(`${stamp()} document response ${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navLog.push(`${stamp()} framenavigated ${new URL(f.url()).pathname}${new URL(f.url()).search}`);
  });
  page.on("domcontentloaded", () => navLog.push(`${stamp()} domcontentloaded ${new URL(page.url()).pathname}`));
  page.on("load", () => navLog.push(`${stamp()} load ${new URL(page.url()).pathname}`));
});
test.afterEach(async ({ page }, testInfo) => {
  if (navLog.length) {
    const hist = await page.evaluate(() => (window as unknown as { __tcHist?: string[] }).__tcHist ?? []).catch((e) => [`(unreadable: ${String(e).slice(0, 80)})`]);
    console.log(`[TILE-67 diag] ${testInfo.title}\n  ${navLog.join("\n  ")}\n  -- history/DOM log of the last document --\n  ${hist.join("\n  ")}`);
  }
  expect(browserErrors).toEqual([]);
});

/** TILE-67 DIAGNOSTIC (temporary): every element whose text is the email, and why it is or is not visible. */
async function logIdentity(page: Page, email: string, where: string) {
  const rows = await page
    .evaluate((email) => {
      const out: string[] = [];
      const w = window as unknown as { __tcDoc?: string };
      out.push(`doc ${w.__tcDoc} readyState=${document.readyState} meta-redirect=${!!document.getElementById("__next-page-redirect")} url=${location.pathname}${location.search}`);
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (el.children.length === 0 && el.textContent === email) {
          const hidden = el.closest("[hidden]");
          const r = el.getBoundingClientRect();
          out.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute("class")}"> hiddenAncestor=${hidden ? `${hidden.tagName}#${hidden.id}` : "none"} rect=${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    }, email)
    .catch((e) => [`(unreadable: ${String(e).slice(0, 80)})`]);
  navLog.push(`${stamp()} identity @${where}: ${rows.join(" | ")}`);
}

async function submitLogin(page: Page, email: string) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form").filter({ has: page.locator("#password") }).locator("button[type=submit]").click();
}

async function signIn(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await submitLogin(page, email);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

const noAccessHeading = (page: Page) => page.getByRole("heading", { level: 1, name: /^(No workspace access|Tiada akses ruang kerja)$/ });
const signOutButton = (page: Page) => page.getByRole("button", { name: /^(Sign out and use another account|Log keluar dan guna akaun lain)$/ });

/** The page stays put: no further navigation in the window, which a loop never allows. */
async function expectStable(page: Page) {
  navLog.push(`${stamp()} expectStable window opens at ${new URL(page.url()).pathname}`);
  try {
    await expect(page.waitForEvent("framenavigated", { timeout: 2_000 })).rejects.toThrow(/Timeout/);
  } finally {
    navLog.push(`${stamp()} expectStable window closes`);
  }
}

/** The explanation, readable and stable, with the way out. */
async function expectNoAccess(page: Page, email: string) {
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(noAccessHeading(page)).toBeVisible();
  await logIdentity(page, email, "before email assertion");
  await expect(page.getByText(email)).toBeVisible();
  await expect(signOutButton(page)).toBeVisible();
  await expectStable(page);
  // No app shell, no workspace, no business data.
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByTestId("workspace-current")).toHaveCount(0);
}

/**
 * Follows a request one hop at a time with the browser's own session cookies,
 * counting both HTTP redirects and the streamed meta redirects Next sends after
 * a response has started. Returns the hops; a loop exhausts the budget.
 */
async function followRedirects(request: APIRequestContext, start: string, budget = 6) {
  const hops: string[] = [];
  let path = start;
  for (let i = 0; i < budget; i++) {
    const res = await request.get(path, { maxRedirects: 0 });
    const body = await res.text();
    const streamed = /NEXT_REDIRECT;(?:replace|push);([^;]+);/.exec(body)?.[1];
    const next = res.status() >= 300 && res.status() < 400 ? res.headers().location : streamed;
    hops.push(`${res.status()} ${path}`);
    if (!next) return { hops, final: path, status: res.status(), body };
    path = new URL(next, "http://localhost").pathname + new URL(next, "http://localhost").search;
  }
  return { hops, final: null, status: 0, body: "" };
}

/** The browser's own Supabase session, read from the SSR auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

/** A PostgREST read on the `api` schema with the browser's own session. */
async function read(context: BrowserContext, path: string) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessToken(context)}`, "Accept-Profile": "api" },
  });
  return res.text();
}

/** Nothing of this workspace reaches the session, page or service. */
async function expectNoWorkspaceData(context: BrowserContext) {
  for (const path of [`leads?workspace_id=eq.${WORKSPACE}&select=id`, `contacts?workspace_id=eq.${WORKSPACE}&select=id`, `stock_availability?workspace_id=eq.${WORKSPACE}&select=product_code`]) {
    expect(await read(context, path)).toBe("[]");
  }
}

test.describe("no active membership", () => {
  test("sign-in lands on a stable explanation that survives reload and deep links", async ({ page, context }) => {
    await signIn(page, NONE.email);
    await expectNoAccess(page, NONE.email);
    await expect(page.getByText("Ask your administrator to send an invitation or restore your access.")).toBeVisible();

    await page.reload();
    await expectNoAccess(page, NONE.email);

    for (const path of ["/start", "/merchandise/stock?tab=sql&q=MW-HEX-WHT", "/admin/my-deliveries", "/sales/inbox", "/login?reason=no-membership"]) {
      await page.goto(path);
      await expectNoAccess(page, NONE.email);
      await expect(page.getByText("MW-HEX-WHT")).toHaveCount(0);
    }
    await expectNoWorkspaceData(context);
  });

  test("real SSR with the session cookies settles in a few hops, never a /start ⇄ /login cycle", async ({ page }) => {
    await signIn(page, NONE.email);
    for (const path of ["/start", "/login?reason=no-membership", "/merchandise/stock?tab=sql", "/no-access"]) {
      const { hops, final, status: code, body } = await followRedirects(page.request, path);
      expect(final, hops.join(" → ")).toBe("/no-access");
      expect(code).toBe(200);
      expect(hops.length).toBeLessThanOrEqual(3);
      for (const leak of ["Hexagon Mosaic White", "Main warehouse", "Command Centre"]) expect(body).not.toContain(leak);
    }
  });

  test("the explanation is in Bahasa Melayu by default and in English on request, across reload", async ({ page, context }) => {
    await context.clearCookies({ name: "tc.locale" });
    await signIn(page, NONE.email);
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tiada akses ruang kerja" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log keluar dan guna akaun lain" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Tiada akses ruang kerja" })).toBeVisible();
    await expectStable(page);

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "No workspace access" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "No workspace access" })).toBeVisible();
    await expectStable(page);
  });

  test("sign out recovers, and switching to an authorised account keeps its deep link", async ({ page }) => {
    await signIn(page, LEAVER.email);
    await expectNoAccess(page, LEAVER.email);
    await signOutButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("#password")).toBeVisible();
    await page.reload();
    await expect(page.locator("#password")).toBeVisible();
    await expectStable(page);

    // Signed out for real: protected pages and the explanation ask for sign-in.
    await page.goto("/start");
    await expect(page).toHaveURL(/\/login\?next=%2Fstart$/);
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/login\?next=%2Fno-access$/);

    // Another account, through a deep link.
    await page.goto("/merchandise/stock?tab=sql");
    await expect(page).toHaveURL(/\/login\?next=/);
    await submitLogin(page, SWITCHER.email);
    await page.waitForURL(/\/merchandise\/stock\?tab=sql$/);
    await expect(page.getByRole("tab", { name: "SQL Account", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name: "SQL Account", exact: true })).toHaveAttribute("aria-selected", "true");
    // A member who opens the explanation is sent on, not stuck there.
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/start$/);
    await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
  });
});

test.describe("membership changes after sign-in", () => {
  test("a suspended sole membership is denied on the next request and restored when reactivated", async ({ page, context }) => {
    await signIn(page, SUSPENDED.email);
    await expect(page.getByTestId("workspace-current")).toBeVisible();
    sql(`update core.memberships set status='suspended' where user_id='${SUSPENDED.id}'`);

    await page.goto("/sales/inbox");
    await expectNoAccess(page, SUSPENDED.email);
    await page.reload();
    await expectNoAccess(page, SUSPENDED.email);
    await expectNoWorkspaceData(context);

    sql(`update core.memberships set status='active' where user_id='${SUSPENDED.id}'`);
    await page.getByRole("link", { name: /^(Check again|Semak semula)$/ }).click();
    await expect(page).not.toHaveURL(/\/no-access/);
    await expect(page.getByTestId("workspace-current")).toBeVisible();
  });

  test("a removed sole membership is denied the same way", async ({ page, context }) => {
    await signIn(page, REMOVED.email);
    await expect(page.getByTestId("workspace-current")).toBeVisible();
    sql(`delete from core.memberships where user_id='${REMOVED.id}'`);
    await page.goto("/merchandise/stock");
    await expectNoAccess(page, REMOVED.email);
    await expectNoWorkspaceData(context);
  });

  test("a still-valid alternate membership takes over by the acting rule, borrowing nothing", async ({ page, context }) => {
    await signIn(page, ALTERNATE.email);
    // Acting: the older sales membership here.
    await expect(page).toHaveURL(/\/$/);
    expect(await page.getByTestId("workspace-current").innerText()).toBe("Operating System");

    sql(`update core.memberships set status='suspended' where user_id='${ALTERNATE.id}' and workspace_id='${WORKSPACE}'`);
    await page.goto("/start");
    // Now acting as the driver in the other workspace: its landing, its area.
    await expect(page).toHaveURL(/\/admin\/my-deliveries$/);
    await expect(page.getByRole("heading", { name: "My Deliveries", level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "My Deliveries", level: 1 })).toBeVisible();
    await page.goto("/sales/inbox");
    await expect(page.getByText(/Not available/).first()).toBeVisible();
    await expectNoWorkspaceData(context);
  });
});

test.describe("anonymous and revoked sessions", () => {
  test("an anonymous visit to the explanation asks for sign-in; a reason never grants access or redirects off-site", async ({ page }) => {
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/login\?next=%2Fno-access$/);
    await page.goto("/login?reason=no-membership&next=https%3A%2F%2Fevil.example%2F");
    await expect(page.locator("#password")).toBeVisible();
    await submitLogin(page, SWITCHER.email);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
    expect(page.url()).not.toContain("evil.example");
  });

  test("a session revoked at the service is treated as signed out, not as no membership", async ({ page }) => {
    await signIn(page, REVOKED.email);
    await expect(page.getByTestId("workspace-current")).toBeVisible();
    sql(`delete from auth.sessions where user_id='${REVOKED.id}'`);
    await page.goto("/merchandise/stock");
    await expect(page).toHaveURL(/\/login\?next=%2Fmerchandise%2Fstock$/);
    await expect(page.locator("#password")).toBeVisible();
    await expect(noAccessHeading(page)).toHaveCount(0);
  });
});
