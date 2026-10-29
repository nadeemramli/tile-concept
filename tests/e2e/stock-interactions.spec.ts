/**
 * TILE-65: the Stock module's tabs, search and filters are server-driven — the
 * page reads them from the URL and fetches the matching rows. A click must show
 * the right tab and the right rows without a manual reload, and URL, reload and
 * back/forward must agree. Runs against a running app and the LOCAL Supabase
 * stack with synthetic accounts only; refuses hosted targets, writes no stock
 * and removes everything it created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const run = randomUUID().slice(0, 8);
// Every account here belongs to this spec. A shared seed administrator would be
// signed out under these tests whenever a spec running alongside signs it out,
// since sign-out ends every session of an account (TILE-65 CI interference).
const USERS = {
  admin: { id: randomUUID(), email: `e2e.stock.admin.${run}@tileconcept.test`, name: "E2E Stock Admin" },
  management: { id: randomUUID(), email: `e2e.stock.management.${run}@tileconcept.test`, name: "E2E Stock Management" },
  sales_rep: { id: randomUUID(), email: `e2e.stock.rep.${run}@tileconcept.test`, name: "E2E Stock Rep" },
  analyst: { id: randomUUID(), email: `e2e.stock.analyst.${run}@tileconcept.test`, name: "E2E Stock Analyst" },
} as const;
// Admin of a workspace with no stock at all: it must never see this workspace's rows.
const OTHER_ADMIN = { id: randomUUID(), email: `e2e.stock.other.${run}@tileconcept.test`, name: "E2E Stock Other" };
// Signed in, but a member of nothing.
const NO_MEMBER = { id: randomUUID(), email: `e2e.stock.none.${run}@tileconcept.test`, name: "E2E Stock None" };
const OTHER_WORKSPACE = randomUUID();
const ALL_USERS = [...Object.values(USERS), OTHER_ADMIN, NO_MEMBER];

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");

/** Every stock table this workspace owns, hashed: the spec must leave it untouched. */
const stockFingerprint = () =>
  sql(`select md5(concat_ws('|',
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from stock.supplier_availability_snapshots s where s.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from stock.inventory_snapshots s where s.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from stock.inventory_item_mappings s where s.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from stock.stock_reconciliation_cases s where s.workspace_id='${WORKSPACE}'),
         (select string_agg(to_jsonb(s)::text, ',' order by s.id) from stock.inventory_movements s where s.workspace_id='${WORKSPACE}')))`);

/**
 * The product codes the server should return for a filter, straight from the
 * database (this workspace only), sorted. Duplicates are kept: one code can
 * have an in-house and a supplier line.
 */
function expectedCodes(where = "true") {
  const out = sql(`select a.product_code from api.stock_availability a
                   left join merch.products p on p.id = a.product_id
                   where a.workspace_id='${WORKSPACE}' and (${where}) order by 1`);
  return out ? out.split("\n") : [];
}
const supplierId = (name: string) => sql(`select id from merch.suppliers where workspace_id='${WORKSPACE}' and name='${name}'`);
const categoryId = (label: string) => sql(`select id from merch.product_categories where workspace_id='${WORKSPACE}' and label='${label}'`);

let before = "";
// Every page error or console error during a test fails it (the original bug was silent).
let browserErrors: string[] = [];

// Not serial: the tests share the accounts created here, and one failure must
// not hide the others.
test.beforeAll(() => {
  before = stockFingerprint();
  const values = ALL_USERS.map((u) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${ALL_USERS.map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.memberships(workspace_id,user_id,role_key) values
         ${Object.entries(USERS).map(([role, u]) => `('${WORKSPACE}','${u.id}','${role}')`).join(",")};
       insert into core.workspaces(id,slug,name) values ('${OTHER_WORKSPACE}','e2e-stock-${run}','E2E stock other workspace');
       insert into core.memberships(workspace_id,user_id,role_key) values ('${OTHER_WORKSPACE}','${OTHER_ADMIN.id}','admin');`);
});

test.afterAll(() => {
  const ids = ALL_USERS.map((u) => `'${u.id}'`).join(",");
  sql(`delete from core.user_preferences where user_id in (${ids});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
  assert.equal(sql(`select count(*) from core.memberships where user_id in (${ids})`), "0");
  // Reading, searching and switching tabs never writes stock.
  assert.equal(stockFingerprint(), before, "stock tables changed during a read-only spec");
});

test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
});

test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form").filter({ has: page.locator("#password") }).locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const searchBox = (page: Page) => page.getByRole("textbox", { name: "Search availability" });
const combo = (page: Page, name: RegExp) => page.getByRole("combobox", { name });
const rowCodes = (page: Page) => page.locator("table tbody tr td:first-child");

/** Settled: no pending server navigation is still dimming the page. */
async function settled(page: Page) {
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
}

/** The visible Overview rows are exactly these codes (or the empty state). */
async function expectRows(page: Page, codes: string[]) {
  await settled(page);
  if (codes.length === 0) {
    await expect(page.getByText("No availability recorded")).toBeVisible();
    await expect(rowCodes(page)).toHaveCount(0);
    return;
  }
  await expect.poll(async () => (await rowCodes(page).allInnerTexts()).map((t) => t.trim()).sort(), { timeout: 15_000 }).toEqual(codes);
}

/** Which tab's content is on screen — each has text no other tab shows. */
const MARKERS = {
  overview: (page: Page) => searchBox(page),
  suppliers: (page: Page) => page.getByRole("heading", { name: "Record a supplier update" }),
  sql: (page: Page) => page.getByRole("heading", { name: "Item mapping" }),
  reconciliation: (page: Page) => page.getByText("A case records that two sources disagree", { exact: false }),
} as const;
type TabKey = keyof typeof MARKERS;
const TAB_NAME: Record<TabKey, string> = { overview: "Overview", suppliers: "Supplier updates", sql: "SQL Account", reconciliation: "Reconciliation" };

async function expectTab(page: Page, key: TabKey, { checkUrl = true } = {}) {
  await settled(page);
  await expect(tab(page, TAB_NAME[key])).toHaveAttribute("aria-selected", "true");
  await expect(MARKERS[key](page)).toBeVisible();
  for (const other of Object.keys(MARKERS) as TabKey[]) {
    if (other !== key) await expect(MARKERS[other](page)).toHaveCount(0);
  }
  if (checkUrl) expect(new URL(page.url()).searchParams.get("tab") ?? "overview").toBe(key);
}

async function search(page: Page, term: string) {
  await searchBox(page).fill(term);
  await searchBox(page).press("Enter");
}

async function choose(page: Page, control: RegExp, option: string) {
  await combo(page, control).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("Stock tabs", () => {
  test("every tab shows its own content on click, and URL, reload and history agree", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    await page.goto("/merchandise/stock");
    await expectTab(page, "overview");
    await expectRows(page, expectedCodes());

    for (const key of ["suppliers", "sql", "reconciliation"] as TabKey[]) {
      await tab(page, TAB_NAME[key]).click();
      await expect(page).toHaveURL(new RegExp(`[?&]tab=${key}(&|$)`));
      await expectTab(page, key);
    }
    await tab(page, "Overview").click();
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expectTab(page, "overview");

    // Each tab click is its own history entry: back walks them in reverse.
    await page.goBack();
    await expectTab(page, "reconciliation");
    await page.goBack();
    await expectTab(page, "sql");
    await page.goForward();
    await expectTab(page, "reconciliation");

    // A reload and a deep link land on the same tab.
    await page.reload();
    await expectTab(page, "reconciliation");
    await page.goto("/merchandise/stock?tab=sql");
    await expectTab(page, "sql");
    // An unknown tab falls back to Overview rather than selecting nothing.
    await page.goto("/merchandise/stock?tab=bogus");
    await expectTab(page, "overview", { checkUrl: false });
  });

  test("the SQL Account tab states that saving a DO in SQL Account deducts stock, once", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    await page.goto("/merchandise/stock?tab=sql");
    await expectTab(page, "sql");
    const copy = page.getByTestId("sql-stock-authority");
    await expect(copy).toContainText("Saving a delivery order in SQL Account deducts the stock there");
    await expect(copy).toContainText("never deducts it a second time");
    await expect(copy).not.toContainText("not yet been tested and agreed");
  });

  test("switching tabs keeps the Overview search and filters", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    const supplier = supplierId("Demo Tile Trading");
    await page.goto(`/merchandise/stock?supplier=${supplier}&q=MW`);
    const want = expectedCodes(`a.supplier_id='${supplier}' and (a.product_code || ' ' || a.product_name || ' ' || coalesce(a.supplier_name,'') || ' ' || a.source_name) ilike '%MW%'`);
    await expectRows(page, want);
    await tab(page, "SQL Account").click();
    await expectTab(page, "sql");
    expect(new URL(page.url()).searchParams.get("q")).toBe("MW");
    expect(new URL(page.url()).searchParams.get("supplier")).toBe(supplier);
    await tab(page, "Overview").click();
    await expectTab(page, "overview");
    await expect(searchBox(page)).toHaveValue("MW");
    await expect(combo(page, /supplier/i)).toHaveText("Demo Tile Trading");
    await expectRows(page, want);
  });
});

test.describe("Stock search and filters", () => {
  test("search, changed search, no matches and clear return the server's rows immediately", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    await page.goto("/merchandise/stock");
    const all = expectedCodes();
    expect(all.length).toBeGreaterThan(2);
    await expectRows(page, all);

    await search(page, "MW-HEX-WHT");
    await expect(page).toHaveURL(/[?&]q=MW-HEX-WHT(&|$)/);
    const hex = expectedCodes("a.product_code = 'MW-HEX-WHT'");
    expect(hex).toEqual(["MW-HEX-WHT", "MW-HEX-WHT"]);
    await expectRows(page, hex);

    // A changed query replaces the rows; nothing from the previous one lingers.
    await search(page, "Grout");
    await expect(page).toHaveURL(/[?&]q=Grout(&|$)/);
    await expectRows(page, expectedCodes("a.product_name ilike '%Grout%'"));

    // Another workspace's product is not a match here: zero rows, not a leak.
    await search(page, "CS-HEX-WHT");
    await expectRows(page, []);

    await search(page, "zz-no-such-product");
    await expectRows(page, []);

    // Back returns the previous search, its rows and its text in the box.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]q=CS-HEX-WHT(&|$)/);
    await expect(searchBox(page)).toHaveValue("CS-HEX-WHT");
    await expectRows(page, []);
    await page.goBack();
    await expect(searchBox(page)).toHaveValue("Grout");
    await expectRows(page, expectedCodes("a.product_name ilike '%Grout%'"));

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(searchBox(page)).toHaveValue("");
    await expectRows(page, all);

    // Emptying the box and searching is the same as clearing it.
    await search(page, "MW-HEX-WHT");
    await expectRows(page, hex);
    await search(page, "");
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expectRows(page, all);
  });

  test("source, supplier, category and availability filters, alone and combined, agree with reload", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    await page.goto("/merchandise/stock");
    const supplier = supplierId("Demo Tile Trading");
    const mosaic = categoryId("Mosaic");

    await choose(page, /source/i, "Supplier");
    await expect(page).toHaveURL(/[?&]sourceKind=supplier(&|$)/);
    await expectRows(page, expectedCodes("a.source_kind='supplier'"));

    await choose(page, /supplier/i, "Demo Tile Trading");
    await expect(page).toHaveURL(new RegExp(`[?&]supplier=${supplier}(&|$)`));
    const tileTrading = expectedCodes(`a.source_kind='supplier' and a.supplier_id='${supplier}'`);
    await expectRows(page, tileTrading);

    await choose(page, /categor/i, "Mosaic");
    const combined = expectedCodes(`a.source_kind='supplier' and a.supplier_id='${supplier}' and p.category_id='${mosaic}'`);
    expect(combined).toEqual(["MW-PEN-BLK"]);
    await expectRows(page, combined);

    // The selected controls and the rows survive a reload unchanged.
    await page.reload();
    await expect(combo(page, /source/i)).toHaveText("Supplier");
    await expect(combo(page, /supplier/i)).toHaveText("Demo Tile Trading");
    await expect(combo(page, /categor/i)).toHaveText("Mosaic");
    await expectRows(page, combined);

    // Back undoes one filter at a time, controls included.
    await page.goBack();
    await expect(combo(page, /categor/i)).toHaveText("All categories");
    await expectRows(page, tileTrading);
    await page.goForward();
    await expectRows(page, combined);

    // A filter with no match shows the empty state, then clearing restores all.
    await choose(page, /availability/i, "Out of stock");
    await expectRows(page, []);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(combo(page, /source/i)).toHaveText("Both sources");
    await expect(combo(page, /supplier/i)).toHaveText("All suppliers");
    await expectRows(page, expectedCodes());

    // Unknown is its own state with no quantity — never a zero.
    await choose(page, /availability/i, "Unknown");
    const unknown = expectedCodes("a.availability='unknown'");
    expect(unknown.length).toBeGreaterThan(0);
    await expectRows(page, unknown);
    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(firstRow.locator("td").nth(4)).toHaveText("—");
  });

  test("a deep link with a search and filters renders exactly those rows", async ({ page }) => {
    await signIn(page, USERS.admin.email);
    await page.goto("/merchandise/stock?q=MW-HEX-WHT&sourceKind=in_house");
    await expect(searchBox(page)).toHaveValue("MW-HEX-WHT");
    await expect(combo(page, /source/i)).toHaveText("In-house");
    await expectRows(page, expectedCodes("a.product_code='MW-HEX-WHT' and a.source_kind='in_house'"));
  });
});

test.describe("Stock access", () => {
  for (const role of ["management", "sales_rep"] as const) {
    test(`${role} reads stock, filters it, and cannot write`, async ({ page }) => {
      await signIn(page, USERS[role].email);
      await page.goto("/merchandise/stock");
      await expectTab(page, "overview");
      await expectRows(page, expectedCodes());
      await search(page, "MW-HEX-WHT");
      await expectRows(page, expectedCodes("a.product_code = 'MW-HEX-WHT'"));

      await tab(page, "Reconciliation").click();
      await expectTab(page, "reconciliation");
      await expect(page.getByRole("button", { name: /Open a case/ })).toBeDisabled();
      await tab(page, "SQL Account").click();
      await expectTab(page, "sql");
      await expect(page.getByRole("heading", { name: "In-house snapshots" })).toBeVisible();
    });
  }

  test("a role without stock.read is refused, and a direct tab link does not get around it", async ({ page }) => {
    await signIn(page, USERS.analyst.email);
    for (const path of ["/merchandise/stock", "/merchandise/stock?tab=sql&q=MW-HEX-WHT"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: /Not available to/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: "SQL Account" })).toHaveCount(0);
      await expect(page.getByText("MW-HEX-WHT")).toHaveCount(0);
    }
  });

  test("an admin of another workspace sees none of this workspace's stock", async ({ page }) => {
    await signIn(page, OTHER_ADMIN.email);
    await page.goto("/merchandise/stock?q=MW-HEX-WHT");
    await expectRows(page, []);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expectRows(page, []);
    await tab(page, "SQL Account").click();
    await expectTab(page, "sql");
    await expect(page.getByText("No snapshots")).toBeVisible();
  });

  test("a signed-in account with no membership is refused before any stock renders", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(NO_MEMBER.email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("form").filter({ has: page.locator("#password") }).locator("button[type=submit]").click();
    // TILE-67: the account lands on the no-access explanation, not a /start ⇄ /login loop.
    await page.waitForURL((url) => url.pathname === "/no-access", { timeout: 30_000 });
    // The Stock route itself answers with the no-access redirect (an HTTP 307,
    // or streamed after the loading shell with status 200) and carries no stock.
    for (const path of ["/merchandise/stock", "/merchandise/stock?tab=sql&q=MW-HEX-WHT"]) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      const body = await res.text();
      const target = res.status() === 307 ? res.headers().location : /NEXT_REDIRECT;replace;([^;]+);/.exec(body)?.[1];
      expect(target).toBe("/no-access");
      for (const leak of ["Hexagon Mosaic White", "Tile Grout White", "Main warehouse", "Demo Tile Trading", "Item mapping"]) expect(body).not.toContain(leak);
      // And in the browser: the explanation, with no stock and no tabs.
      await page.goto(path);
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(page.getByRole("heading", { level: 1, name: "No workspace access" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "SQL Account" })).toHaveCount(0);
      for (const leak of ["Hexagon Mosaic White", "Main warehouse"]) await expect(page.getByText(leak)).toHaveCount(0);
    }
  });
});
