/**
 * TILE-65 follow-up: why every spec signs in only accounts it owns. Sign-out
 * ends every session of the account, in every browser (signOutAction's default
 * global scope, kept on purpose), so one spec signing out an account another
 * spec is using redirects that spec to /login mid-test. In CI that showed up as
 * the Stock combined-filter test receiving no rows. This spec pins both halves:
 * the same account's sign-out does end a second browser's Stock session, and a
 * different account's sign-out leaves it, its rows and its token untouched.
 * Runs against a running app and the LOCAL Supabase stack with synthetic
 * accounts only; refuses hosted targets, writes no stock and removes what it
 * created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const run = randomUUID().slice(0, 8);
const account = (key: string) => ({ id: randomUUID(), email: `e2e.session.${key}.${run}@tileconcept.test`, name: `E2E Session ${key}` });
// Administrators here, each signed in from two browsers in its own test.
const SHARED = account("shared");
const READER = account("reader");
// A different administrator here, signed in and out while READER reads Stock.
const LEAVER = account("leaver");
const ALL = [SHARED, READER, LEAVER];

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
       insert into core.memberships(workspace_id,user_id,role_key) values
         ${ALL.map((u) => `('${WORKSPACE}','${u.id}','admin')`).join(",")};`);
});

test.afterAll(() => {
  const ids = ALL.map((u) => `'${u.id}'`).join(",");
  sql(`delete from core.user_preferences where user_id in (${ids});
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.memberships where user_id in (${ids})`), "0");
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form").filter({ has: page.locator("#password") }).locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Through the real user menu, as a person (and workspace-entry.spec.ts) does. */
async function signOut(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: /Sign out|Log keluar/ }).click();
  await page.waitForURL("**/login**");
}

/** A fresh browser — its own cookies — signed in as this account. */
async function browserFor(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** The browser's own Supabase session, read from the SSR auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

/** Whether Auth still accepts the token: the check the proxy makes on every request. */
async function authAccepts(token: string) {
  const res = await fetch(`${API_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  return res.ok;
}

const combo = (page: Page, name: RegExp) => page.getByRole("combobox", { name });
const rowCodes = (page: Page) => page.locator("table tbody tr td:first-child");

async function choose(page: Page, control: RegExp, option: string) {
  await combo(page, control).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectRows(page: Page, codes: string[]) {
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  await expect.poll(async () => (await rowCodes(page).allInnerTexts()).map((t) => t.trim()).sort(), { timeout: 15_000 }).toEqual(codes);
}

const supplierId = () => sql(`select id from merch.suppliers where workspace_id='${WORKSPACE}' and name='Demo Tile Trading'`);
const mosaicId = () => sql(`select id from merch.product_categories where workspace_id='${WORKSPACE}' and label='Mosaic'`);
function expectedCodes(where: string) {
  const out = sql(`select a.product_code from api.stock_availability a
                   left join merch.products p on p.id = a.product_id
                   where a.workspace_id='${WORKSPACE}' and (${where}) order by 1`);
  return out ? out.split("\n") : [];
}

/** Stock filtered to source and supplier: the state the CI failure was in. */
async function openFilteredStock(page: Page) {
  await page.goto("/merchandise/stock");
  await choose(page, /source/i, "Supplier");
  await choose(page, /supplier/i, "Demo Tile Trading");
  await expectRows(page, expectedCodes(`a.source_kind='supplier' and a.supplier_id='${supplierId()}'`));
}

const combinedWhere = () => `a.source_kind='supplier' and a.supplier_id='${supplierId()}' and p.category_id='${mosaicId()}'`;

test("signing out ends the same account's Stock session in another browser", async ({ browser }) => {
  const reading = await browserFor(browser, SHARED.email);
  await openFilteredStock(reading.page);
  const token = await accessToken(reading.context);
  expect(await authAccepts(token)).toBe(true);

  const leaving = await browserFor(browser, SHARED.email);
  await signOut(leaving.page);

  // Global scope: the other browser's session is gone at Auth, and its next
  // filter change is sent to sign in, keeping the full Stock link.
  expect(await authAccepts(token)).toBe(false);
  await choose(reading.page, /categor/i, "Mosaic");
  await expect(reading.page).toHaveURL(/\/login\?next=%2Fmerchandise%2Fstock%3F[^#]*category%3D/);
  await expect(reading.page.locator("#password")).toBeVisible();
  await expect(rowCodes(reading.page)).toHaveCount(0);
  await reading.context.close();
  await leaving.context.close();
});

test("another account signing out leaves a Stock session, its rows and its token intact", async ({ browser }) => {
  const reading = await browserFor(browser, READER.email);
  await openFilteredStock(reading.page);
  const token = await accessToken(reading.context);

  const leaving = await browserFor(browser, LEAVER.email);
  const leaverToken = await accessToken(leaving.context);
  await signOut(leaving.page);
  // The sign-out was real: the leaver's own session is gone.
  expect(await authAccepts(leaverToken)).toBe(false);

  expect(await authAccepts(token)).toBe(true);
  await choose(reading.page, /categor/i, "Mosaic");
  await expect(reading.page).toHaveURL(/\/merchandise\/stock\?/);
  const combined = expectedCodes(combinedWhere());
  expect(combined).toEqual(["MW-PEN-BLK"]);
  await expectRows(reading.page, combined);
  await reading.page.reload();
  await expectRows(reading.page, combined);
  await reading.context.close();
  await leaving.context.close();
});
