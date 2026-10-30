/**
 * Accounts & Contacts quick filters against a running app and the LOCAL
 * Supabase stack: Type / Source / Lifecycle / Activity quick filters, the
 * My accounts / Unassigned segments, search, clear, URL state across reload
 * and deep links, the sales.read gate and workspace isolation.
 *
 * Coverage only. It asserts the behaviour the page already has (filters are
 * nuqs URL params; the search box is component state) and does not assert a
 * history or persistence policy the product has not stated.
 */
import { test, expect, type Page } from "@playwright/test";
import { ACCOUNTS, CONTACTS, PASSWORD, PREFIX, USERS, WORKSPACE, OTHER_WORKSPACE, createFixtures, fullName, leftovers, removeFixtures, serviceAs } from "./crm-filters.fixtures";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(60_000);
  await createFixtures();
});

test.afterAll(async () => {
  await removeFixtures();
  expect(leftovers(), "suite-owned rows and users removed").toBe(0);
});

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors, "uncaught browser errors").toEqual([]);
});

async function login(page: Page, user: keyof typeof USERS) {
  await page.goto("/login");
  await page.locator("#email").fill(USERS[user].email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

// The filter bar's selects carry no accessible name of their own, only their
// current value, so they are addressed by position: View, Type, Source,
// Lifecycle, then Activity (contacts only).
const FILTERS = { view: 0, type: 1, source: 2, life: 3, activity: 4 } as const;
const combo = (page: Page, which: keyof typeof FILTERS) => page.getByRole("main").getByRole("combobox").nth(FILTERS[which]);
async function choose(page: Page, which: keyof typeof FILTERS, option: string) {
  await combo(page, which).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(combo(page, which)).toHaveText(option);
}

const search = (page: Page) => page.getByRole("main").getByLabel("Filter rows");
// The "No rows match “…”" row echoes the search, so it is not a fixture row.
const fixtureRows = (page: Page) => page.getByRole("main").getByRole("row").filter({ hasText: PREFIX }).filter({ hasNotText: "No rows match" });
async function expectRows(page: Page, names: string[]) {
  await expect(fixtureRows(page)).toHaveCount(names.length);
  for (const name of names) await expect(fixtureRows(page).filter({ hasText: fullName(name) })).toHaveCount(1);
}
function expectParams(page: Page, expected: Record<string, string | null>) {
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of Object.entries(expected)) expect(params.get(key), `URL param ${key}`).toBe(value);
}
// Narrow the table to this run's rows (accounts sort by name, so they may not
// be on the first page otherwise). Retried so a fill made before hydration is
// redone: done when every body row shown is a fixture row.
async function narrowToFixtures(page: Page) {
  await expect(async () => {
    await search(page).fill(PREFIX);
    await expect(page.getByRole("main").getByRole("row").filter({ hasNotText: PREFIX })).toHaveCount(1, { timeout: 1_000 });
  }).toPass();
}
async function openList(page: Page, query = "") {
  await page.goto(`/sales/accounts${query}`);
  await expect(page.getByRole("heading", { name: "Accounts & Contacts" })).toBeVisible();
  await narrowToFixtures(page);
}

test("contacts: each quick filter, combined filters, changed search, zero results and clear", async ({ page }) => {
  await login(page, "owner");
  await openList(page);
  await expectRows(page, ["Alpha", "Bravo", "Charlie", "Delta"]);

  // Individually.
  await choose(page, "type", "Contractor");
  await expectRows(page, ["Bravo", "Charlie"]);
  expectParams(page, { type: "contractor" });
  await choose(page, "type", "Type: all");
  expectParams(page, { type: null });
  await expectRows(page, ["Alpha", "Bravo", "Charlie", "Delta"]);

  await choose(page, "source", "Walk In");
  await expectRows(page, ["Alpha", "Charlie"]);
  await choose(page, "source", "Source: all");

  await choose(page, "life", "Lapsed");
  await expectRows(page, ["Delta"]);
  await choose(page, "life", "Lifecycle: all");

  // Activity is the most recent activity date; no activity never matches.
  await choose(page, "activity", "Last 7 days");
  await expectRows(page, ["Alpha"]);
  await choose(page, "activity", "Last 30 days");
  await expectRows(page, ["Alpha", "Bravo"]);
  await choose(page, "activity", "Last 90 days");
  await expectRows(page, ["Alpha", "Bravo", "Charlie"]);
  expectParams(page, { activity: "90" });

  // Combined: every filter narrows the others.
  await choose(page, "type", "Contractor");
  await expectRows(page, ["Bravo", "Charlie"]);
  await choose(page, "source", "Walk In");
  await expectRows(page, ["Charlie"]);
  await choose(page, "life", "Repeat");
  await expectRows(page, ["Charlie"]);
  expectParams(page, { type: "contractor", source: "walk_in", life: "repeat", activity: "90" });
  await choose(page, "activity", "Last 30 days");
  await expectRows(page, []);

  // Zero rows from filters plus search, then a changed search over the same filters.
  await choose(page, "activity", "Activity: all");
  await expectRows(page, ["Charlie"]);
  await search(page).fill(fullName("Bravo"));
  await expectRows(page, []);
  await search(page).fill(fullName("Charlie"));
  await expectRows(page, ["Charlie"]);
  await search(page).fill(`${PREFIX} no such contact`);
  await expect(page.getByRole("main").getByText(`No rows match “${PREFIX} no such contact”.`)).toBeVisible();

  // Clear drops the view and every quick filter from the URL; search is the table's own box.
  await search(page).fill(PREFIX);
  await page.getByRole("main").getByRole("button", { name: "Clear" }).click();
  await expectRows(page, ["Alpha", "Bravo", "Charlie", "Delta"]);
  expectParams(page, { view: null, type: null, source: null, life: null, activity: null });
  await expect(page.getByRole("main").getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(combo(page, "type")).toHaveText("Type: all");
});

test("accounts: My accounts and Unassigned segments with quick filters", async ({ page }) => {
  await login(page, "owner");
  await openList(page, "?tab=accounts");
  await expectRows(page, ["Acme", "Beacon", "Cobalt", "Dune"]);
  await expect(page.getByRole("main").getByRole("combobox"), "Activity is a contacts-only filter").toHaveCount(4);

  await choose(page, "view", "My accounts");
  await expectRows(page, ["Acme"]);
  await expect(fixtureRows(page).first()).toContainText(USERS.owner.name);
  expectParams(page, { tab: "accounts", view: "mine" });

  await choose(page, "view", "Unassigned");
  await expectRows(page, ["Beacon", "Dune"]);
  await choose(page, "type", "Designer");
  await expectRows(page, ["Dune"]);
  await choose(page, "life", "New");
  await expectRows(page, []);
  await choose(page, "life", "Lifecycle: all");
  await choose(page, "type", "Type: all");
  await choose(page, "source", "Tiktok");
  await expectRows(page, ["Beacon"]);
  expectParams(page, { view: "unassigned", source: "tiktok", type: null });

  // The segment and quick filters compose: Customers is active, repeat or reactivated.
  await choose(page, "source", "Source: all");
  await choose(page, "view", "Customers");
  await expectRows(page, ["Acme", "Cobalt"]);
  await choose(page, "type", "Contractor");
  await expectRows(page, ["Acme", "Cobalt"]);
  await choose(page, "view", "My accounts");
  await expectRows(page, ["Acme"]);

  await page.getByRole("main").getByRole("button", { name: "Clear" }).click();
  await expectRows(page, ["Acme", "Beacon", "Cobalt", "Dune"]);
  expectParams(page, { tab: "accounts", view: null, type: null });
});

test("accounts: My accounts follows the signed-in member", async ({ page }) => {
  await login(page, "peer");
  await openList(page, "?tab=accounts&view=mine");
  await expectRows(page, ["Cobalt"]);
  await expect(fixtureRows(page).first()).toContainText(USERS.peer.name);
});

test("URL state: reload keeps filters, a deep link applies them, back restores the earlier list", async ({ page }) => {
  await login(page, "owner");
  await openList(page);
  await choose(page, "type", "Contractor");
  await choose(page, "activity", "Last 30 days");
  await expectRows(page, ["Bravo"]);

  // Filters are URL state and survive a reload; the search box is not in the URL.
  await page.reload();
  expectParams(page, { type: "contractor", activity: "30" });
  await expect(combo(page, "type")).toHaveText("Contractor");
  await expect(combo(page, "activity")).toHaveText("Last 30 days");
  test.info().annotations.push({ type: "observed", description: `search box after reload: "${await search(page).inputValue()}" (component state, not asserted)` });
  await narrowToFixtures(page);
  await expectRows(page, ["Bravo"]);

  // A deep link renders the same filtered list from a cold document.
  await page.goto("/sales/accounts?tab=accounts&view=unassigned&type=designer");
  await expect(combo(page, "view")).toHaveText("Unassigned");
  await expect(combo(page, "type")).toHaveText("Designer");
  await narrowToFixtures(page);
  await expectRows(page, ["Dune"]);

  // Back to the previous document restores its filters (not the in-page steps).
  await page.goBack();
  await expect(page).toHaveURL(/\/sales\/accounts\?.*type=contractor/);
  expectParams(page, { tab: null, type: "contractor", activity: "30" });
  await narrowToFixtures(page);
  await expectRows(page, ["Bravo"]);
});

test("sales.read gate: a catalogue role is refused in the page and at the service", async ({ page }) => {
  await login(page, "denied");
  await page.goto("/sales/accounts?tab=accounts&view=unassigned");
  await expect(page.getByRole("heading", { name: /^Not available/ })).toBeVisible();
  await expect(page.getByRole("main").getByLabel("Filter rows")).toHaveCount(0);
  // Suite users are named with the prefix too, so look for record names only.
  for (const { name } of [...CONTACTS, ...ACCOUNTS]) await expect(page.getByText(fullName(name))).toHaveCount(0);

  const denied = await serviceAs("denied");
  for (const view of ["contacts", "accounts"]) {
    const { data, error } = await denied.from(view).select("id").limit(1);
    expect(error, `${view}: RLS filters rather than errors`).toBeNull();
    expect(data, `${view}: no rows without sales.read`).toEqual([]);
  }
});

test("workspace isolation: each member reads only its own workspace's rows", async ({ page }) => {
  // Service: the same prefix exists in both workspaces; each user sees only its own.
  const expected = (workspace: string) => ({
    contacts: CONTACTS.filter((c) => c.workspace === workspace).map((c) => fullName(c.name)).sort(),
    accounts: ACCOUNTS.filter((a) => a.workspace === workspace).map((a) => fullName(a.name)).sort(),
  });
  for (const [user, workspace] of [["owner", WORKSPACE], ["foreign", OTHER_WORKSPACE]] as const) {
    const client = await serviceAs(user);
    const contacts = await client.from("contacts").select("display_name, workspace_id").like("display_name", `${PREFIX} %`);
    const accounts = await client.from("accounts").select("name, workspace_id").like("name", `${PREFIX} %`);
    expect(contacts.error).toBeNull();
    expect(accounts.error).toBeNull();
    expect(contacts.data!.map((r) => r.display_name).sort(), `${user}: contacts`).toEqual(expected(workspace).contacts);
    expect(accounts.data!.map((r) => r.name).sort(), `${user}: accounts`).toEqual(expected(workspace).accounts);
    expect(new Set([...contacts.data!, ...accounts.data!].map((r) => r.workspace_id))).toEqual(new Set([workspace]));
  }

  // UI: the other workspace holds only this suite's rows, so its counts are exact
  // and a filter with no match shows the empty state rather than a search miss.
  await login(page, "foreign");
  await page.goto("/sales/accounts");
  await expect(page.getByRole("tab", { name: /^Contacts\s*2$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Accounts\s*2$/ })).toBeVisible();
  await expectRows(page, ["Foreign Echo", "Foreign Fox"]);
  await choose(page, "type", "Contractor");
  await expectRows(page, ["Foreign Echo"]);
  await expect(page.getByRole("main").getByText("1 of 2", { exact: true })).toBeVisible();
  await choose(page, "life", "New");
  await expect(page.getByText("No contacts match")).toBeVisible();

  await page.goto("/sales/accounts?tab=accounts&view=unassigned");
  await expectRows(page, ["Foreign Halo"]);
  await choose(page, "view", "My accounts");
  await expectRows(page, ["Foreign Gamma"]);
  for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Acme", "Beacon", "Cobalt", "Dune"]) {
    await expect(page.getByText(fullName(name))).toHaveCount(0);
  }
});
