/**
 * Legacy walk-in workbook import, driven through the real browser wizard
 * against the LOCAL Supabase stack: CSV → mapping → preview → Commit → the
 * persisted contact, visit and purchase read back through the app's normal
 * API views and after a browser reload. Also covers the wizard's existing
 * refusals (missing mapping, rejected rows, duplicates) and its role gates,
 * keeping a refused commit distinguishable from a persisted one.
 *
 * Runs in its own disposable workspace with its own users (see the fixture);
 * synthetic rows only, never the shared demo logins.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { WalkinImportFixture, type FixtureUser, type ServiceClient } from "./walkin-import.fixture";

const fx = new WalkinImportFixture();
const RUN = fx.run;
let importer: FixtureUser;
let reader: FixtureUser;
let revoked: FixtureUser;

const ALYA = `E2E Alya ${RUN}`;
const BEN = `E2E Ben ${RUN}`;
const CARLA = `E2E Carla ${RUN}`;
const ORC = `E2E-ORC-${RUN}`;
const SQ1 = `E2E-SQ-${RUN}-1`;
const SQ2 = `E2E-SQ-${RUN}-2`;
const SQ3 = `E2E-SQ-${RUN}-3`;
const SALES_WRITE_REFUSAL = "Creating or editing sales records needs a sales representative, sales manager or showroom role.";

const HEADER = ["Date", "SMP", "Customer Name", "Contact", "From", "Status", "Customer Type", "Area Renovation", "ORC Number", "Collection (RM)", "SQ Number", "Quotation Amount (RM)", "How did you know", "Online Enquiry?", "Walk In?", "Cash", "Card", "Transfer", "E-Wallet"];
type Cells = Partial<Record<(typeof HEADER)[number], string>>;
function csv(rows: Cells[]) {
  const cell = (v = "") => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // Daily Tracker sheets carry a title row above the header row; the wizard must skip it.
  return Buffer.from([`E2E Daily Tracker ${RUN}`, HEADER.join(","), ...rows.map((r) => HEADER.map((h) => cell(r[h])).join(","))].join("\n") + "\n");
}
// Day-first dates with a day above 12 so the sheet parser cannot read them month-first.
function workbook() {
  return csv([
    { Date: "20/10/2026", SMP: importer.fullName, "Customer Name": ALYA, Contact: "012-700 0101", From: "Cheras", Status: "New", "Customer Type": "Homeowner", "Area Renovation": "Wet Kitchen", "ORC Number": ORC, "Collection (RM)": "1250.50", "SQ Number": SQ1, "Quotation Amount (RM)": "4800", "How did you know": "TikTok", "Walk In?": "Y", Cash: "1250.50" },
    { Date: "21/10/2026", SMP: importer.fullName, "Customer Name": BEN, Contact: "+60 12-700 0102", From: "Puchong", Status: "New", "Customer Type": "Contractor", "Area Renovation": "Master Bath", "SQ Number": SQ2, "Quotation Amount (RM)": "2350.75", "Online Enquiry?": "Y" },
    { Date: "22/10/2026", Contact: "012-700 0103", "Area Renovation": "Rejected: no name" },
    { Date: "22/10/2026", "Customer Name": `E2E Rejected Phone ${RUN}`, Contact: "not a phone" },
    { Date: "22/10/2026", "Customer Name": `E2E Rejected Amount ${RUN}`, Contact: "012-700 0105", "Collection (RM)": "12..5" },
    { Date: "not a date", "Customer Name": `E2E Rejected Date ${RUN}`, Contact: "012-700 0106" },
  ]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fx.create();
  importer = await fx.addUser("importer", "showroom");
  reader = await fx.addUser("reader", "management");
  revoked = await fx.addUser("revoked", "showroom");
});

test.afterAll(async () => {
  await fx.destroy();
});

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors, "uncaught browser errors").toEqual([]);
});

async function login(page: Page, user: FixtureUser) {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
async function upload(page: Page, name: string, buffer: Buffer, rows: number) {
  await page.goto("/sales/walk-ins/import");
  await expect(page.getByRole("heading", { name: "Import walk-in workbook" })).toBeVisible();
  await page.getByLabel("Choose .xlsx / .csv").setInputFiles({ name, mimeType: "text/csv", buffer });
  await expect(page.getByText(`${name} · ${rows} rows · ${HEADER.length} columns`)).toBeVisible();
}
/** The Select under a mapping field's label. */
function mapping(page: Page, label: string): Locator {
  return page.locator("label").filter({ hasText: new RegExp(`^${label.replace(/[()/?]/g, "\\$&")}( \\*)?$`) }).locator("xpath=../..").getByRole("combobox");
}
function toast(page: Page, text: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}
function summary(page: Page, label: string): Locator {
  return page.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd");
}
async function visitsFor(client: ServiceClient, contactIds: string[]) {
  const { data, error } = await client.from("visits").select("*").eq("workspace_id", fx.workspaceId).in("contact_id", contactIds).order("occurred_at");
  expect(error).toBeNull();
  return data ?? [];
}
async function contactByName(client: ServiceClient, name: string) {
  const { data, error } = await client.from("contacts").select("*").eq("workspace_id", fx.workspaceId).eq("display_name", name);
  expect(error).toBeNull();
  return data ?? [];
}

test("showroom importer maps, previews and commits a legacy CSV; rows persist and survive reload", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, importer);
  await upload(page, "e2e-walkins.csv", workbook(), 6);
  await expect(page.getByText("Read 6 rows from Sheet1.")).toBeVisible();

  // Column guesses for the tracker headers, including the tracker-only fields.
  for (const [label, column] of [["Date", "Date"], ["Salesperson", "SMP"], ["Customer name", "Customer Name"], ["Contact phone", "Contact"], ["Area / renovation", "Area Renovation"], ["ORC number", "ORC Number"], ["Collection amount", "Collection (RM)"], ["SQ / quotation number", "SQ Number"], ["Quotation amount", "Quotation Amount (RM)"], ["How customer heard", "How did you know"], ["Payment: cash (flag/amount)", "Cash"]] as const) {
    await expect(mapping(page, label), `${label} mapping`).toHaveText(column);
  }
  await expect(page.getByRole("combobox").filter({ hasText: fx.locationName }), "default location is the suite's showroom").toBeVisible();

  // A required column left unmapped blocks the preview until it is mapped again.
  const preview = page.getByRole("button", { name: "Preview rows" });
  await mapping(page, "Contact phone").click();
  await page.getByRole("option", { name: "Not mapped" }).click();
  await expect(page.getByText("Map Contact phone")).toBeVisible();
  await expect(preview).toBeDisabled();
  await mapping(page, "Contact phone").click();
  await page.getByRole("option", { name: "Contact", exact: true }).click();
  await expect(page.getByText("Required columns mapped.")).toBeVisible();
  await preview.click();

  // Preview: two importable rows (phones normalised), four rejected with reasons; nothing written yet.
  await expect(page.getByText("0 valid", { exact: true })).toBeVisible();
  await expect(page.getByText("2 corrected", { exact: true })).toBeVisible();
  await expect(page.getByText("0 duplicate (skipped)", { exact: true })).toBeVisible();
  await expect(page.getByText("4 rejected", { exact: true })).toBeVisible();
  const previewRow = (text: string) => page.getByRole("row").filter({ hasText: text });
  await expect(previewRow(ALYA)).toContainText("2026-10-20");
  await expect(previewRow(ALYA)).toContainText("Phone normalized to +60127000101");
  await expect(previewRow(ALYA)).toContainText("Homeowner · Cheras · Wet Kitchen");
  await expect(previewRow(ALYA)).toContainText("cash");
  await expect(previewRow(BEN)).toContainText("Phone normalized to +60127000102");
  await expect(previewRow("Rejected: no name")).toContainText("Missing customer name");
  await expect(previewRow(`E2E Rejected Phone ${RUN}`)).toContainText("Missing/invalid phone");
  await expect(previewRow(`E2E Rejected Amount ${RUN}`)).toContainText("Amount is not a number");
  await expect(previewRow(`E2E Rejected Date ${RUN}`)).toContainText("Bad or missing date");
  const service = await fx.serviceClient(importer);
  expect(await contactByName(service, ALYA)).toHaveLength(0);

  await page.getByRole("button", { name: "Commit 2 rows" }).click();
  await expect(page.getByText("Import committed")).toBeVisible({ timeout: 30_000 });
  await expect(toast(page, "Imported 2 visits, 1 purchase.")).toBeVisible();
  await expect(summary(page, "Visits")).toHaveText("2");
  await expect(summary(page, "Purchases")).toHaveText("1");
  await expect(summary(page, "Contacts created")).toHaveText("2");
  await expect(summary(page, "Contacts reused")).toHaveText("0");
  await expect(summary(page, "Skipped")).toHaveText("0");

  // Persistence, read back through the API views as the importer.
  const [alya] = await contactByName(service, ALYA);
  const [ben] = await contactByName(service, BEN);
  expect(alya).toMatchObject({ customer_type: "homeowner", is_provisional: false });
  expect(ben).toMatchObject({ customer_type: "contractor", is_provisional: false });
  const { data: points, error: pointsError } = await service.from("contact_points").select("contact_id, kind, normalized_value").in("contact_id", [alya.id, ben.id]).order("normalized_value");
  expect(pointsError).toBeNull();
  expect(points).toEqual([
    { contact_id: alya.id, kind: "phone", normalized_value: "+60127000101" },
    { contact_id: ben.id, kind: "phone", normalized_value: "+60127000102" },
  ]);
  const visits = await visitsFor(service, [alya.id, ben.id]);
  expect(visits).toHaveLength(2);
  expect(visits[0]).toMatchObject({
    contact_id: alya.id, location_id: fx.locationId, staff_user_id: importer.id, created_by: importer.id,
    occurred_at: "2026-10-20T00:00:00+00:00", origin_area: "Cheras", customer_type: "homeowner", inquiry_source: "tiktok",
    purpose: "purchase", is_new_customer: true, renovation_area: "Wet Kitchen", quotation_ref: SQ1, quotation_amount: 4800,
  });
  expect(visits[0].notes).toContain("sheet said New");
  expect(visits[1]).toMatchObject({
    contact_id: ben.id, location_id: fx.locationId, staff_user_id: importer.id,
    occurred_at: "2026-10-21T00:00:00+00:00", origin_area: "Puchong", customer_type: "contractor", inquiry_source: "website",
    purpose: "browse", is_new_customer: true, renovation_area: "Master Bath", quotation_ref: SQ2, quotation_amount: 2350.75,
  });
  const { data: purchases, error: purchaseError } = await service.from("purchases").select("*").eq("workspace_id", fx.workspaceId);
  expect(purchaseError).toBeNull();
  expect(purchases).toHaveLength(1);
  expect(purchases![0]).toMatchObject({ contact_id: alya.id, visit_id: visits[0].id, external_ref: ORC, amount: 1250.5, purchase_source: "walk_in", location_id: fx.locationId, salesperson_id: importer.id, purchased_at: "2026-10-20T00:00:00+00:00" });
  const { data: payments, error: paymentError } = await service.from("purchase_payments").select("method, amount").eq("purchase_id", purchases![0].id);
  expect(paymentError).toBeNull();
  expect(payments).toEqual([{ method: "cash", amount: 1250.5 }]);

  // The ledger shows the imported rows, and still does after a reload.
  await page.getByRole("link", { name: "Open walk-ins" }).click();
  await page.waitForURL("**/sales/walk-ins");
  for (const pass of ["first render", "after reload"]) {
    const alyaRow = page.getByRole("row").filter({ hasText: ALYA });
    const benRow = page.getByRole("row").filter({ hasText: BEN });
    await expect(alyaRow, pass).toContainText("Wet Kitchen");
    await expect(alyaRow, pass).toContainText(ORC);
    await expect(alyaRow, pass).toContainText(SQ1);
    await expect(alyaRow, pass).toContainText("4,800.00");
    await expect(alyaRow, pass).toContainText("Cheras");
    await expect(benRow, pass).toContainText("Master Bath");
    await expect(benRow, pass).toContainText(SQ2);
    await expect(benRow, pass).toContainText("2,350.75");
    await expect(benRow, pass).toContainText("Puchong");
    if (pass === "first render") await page.reload();
  }

  // Importing the same workbook again: both rows are duplicates and nothing is committable.
  await upload(page, "e2e-walkins-again.csv", workbook(), 6);
  await page.getByRole("button", { name: "Preview rows" }).click();
  await expect(page.getByText("2 duplicate (skipped)", { exact: true })).toBeVisible();
  await expect(previewRow(ALYA)).toContainText(`ORC ${ORC} already recorded`);
  await expect(previewRow(BEN)).toContainText("A visit for this phone already exists on that date");
  await expect(page.getByRole("button", { name: "Commit 0 rows" })).toBeDisabled();
  expect(await visitsFor(service, [alya.id, ben.id])).toHaveLength(2);
});

test("a role without sales.write cannot open the import, cannot write through the API, and still reads the ledger", async ({ page }) => {
  await login(page, reader);
  await page.goto("/sales/walk-ins/import");
  await expect(page.getByRole("heading", { name: /^Not available to / })).toBeVisible();
  await expect(page.getByText(SALES_WRITE_REFUSAL)).toBeVisible();
  await expect(page.getByLabel("Choose .xlsx / .csv")).toHaveCount(0);

  // The database is the authority: the visit RPC the import uses refuses this role directly.
  const service = await fx.serviceClient(reader);
  const [alya] = await contactByName(service, ALYA);
  expect(alya, "reader can see the imported contact").toBeTruthy();
  const refused = await service.rpc("record_showroom_visit", { p_request_id: crypto.randomUUID(), p_input: { contact_id: alya.id, occurred_at: "2026-10-24T00:00:00+00:00", renovation_area: "Refused write", purpose: "browse" } });
  expect(refused.error?.message).toMatch(/permission denied/i);
  expect(await visitsFor(service, [alya.id])).toHaveLength(1);

  await page.goto("/sales/walk-ins");
  await expect(page.getByRole("row").filter({ hasText: ALYA })).toContainText("Wet Kitchen");
  await expect(page.getByRole("row").filter({ hasText: "Refused write" })).toHaveCount(0);
});

test("a commit refused after the role is revoked shows the refusal and persists nothing", async ({ page }) => {
  await login(page, revoked);
  const buffer = csv([{ Date: "23/10/2026", SMP: revoked.fullName, "Customer Name": CARLA, Contact: "012-700 0107", From: "Klang", "Customer Type": "Designer", "Area Renovation": "Living Hall", "SQ Number": SQ3, "Quotation Amount (RM)": "990" }]);
  await upload(page, "e2e-walkins-revoked.csv", buffer, 1);
  await page.getByRole("button", { name: "Preview rows" }).click();
  await expect(page.getByText("1 corrected", { exact: true })).toBeVisible();
  const commit = page.getByRole("button", { name: "Commit 1 row" });
  await expect(commit).toBeEnabled();

  fx.setRole(revoked, "management");
  await commit.click();
  // The refusal arrives as the commit's own error toast while the preview stays
  // put; a committed-then-rerendered page would show the result card or the
  // PermissionDenied page instead.
  await expect(toast(page, SALES_WRITE_REFUSAL)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Import committed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Import walk-in workbook" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: CARLA })).toContainText("Living Hall");
  await expect(page.getByRole("button", { name: "Commit 1 row" })).toBeEnabled();

  // Failure, not persistence: no contact, visit or quotation was written for the refused row.
  const service = await fx.serviceClient(reader);
  expect(await contactByName(service, CARLA)).toHaveLength(0);
  const { data: quoted, error } = await service.from("visits").select("id").eq("workspace_id", fx.workspaceId).eq("quotation_ref", SQ3);
  expect(error).toBeNull();
  expect(quoted).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Not available to / })).toBeVisible();
  await expect(page.getByLabel("Choose .xlsx / .csv")).toHaveCount(0);
});
