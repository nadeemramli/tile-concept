/**
 * TILE-80: walk-in import dates must keep the calendar day the file states,
 * whatever the browser's timezone. Runs the same journeys with the browser in
 * UTC and in Asia/Kuala_Lumpur against the LOCAL Supabase stack, each in its
 * own disposable workspace (see walkin-import.fixture.ts).
 *
 * The first CSV is the coordinator's original synthetic reproduction,
 * verbatim: 05/10/2026 previewed as 2026-05-10 (UTC) / 2026-05-09 (KL) while
 * 25/10/2026 previewed correctly.
 */
import * as XLSX from "xlsx";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { WalkinImportFixture, type FixtureUser } from "./walkin-import.fixture";

const DECLARED_CSV = `TILE80 declared dates DD/MM/YYYY
Date (DD/MM/YYYY),Name,Phone,Notes
05/10/2026,QC80 Date fifth October,+60100008001,Synthetic fixture only
25/10/2026,QC80 Date twenty fifth October,+60100008002,Synthetic fixture only
`;
const FIFTH = "QC80 Date fifth October";
const TWENTY_FIFTH = "QC80 Date twenty fifth October";

// Controls the fix must keep: ISO text, day-first and ISO dates that do not
// exist, a leap day, a written-out date that JavaScript reads in local time,
// and a full ISO date-time without an offset, which keeps its existing
// browser-local reading to the second.
const TEXT_CONTROLS_CSV = `Date,Customer Name,Contact
2026-10-05,E2E ISO text,012-700 0301
31/02/2026,E2E Rollover,012-700 0302
29/02/2024,E2E Leap day,012-700 0303
5 Oct 2026,E2E Written date,012-700 0304
2026-02-30T14:30:00Z,E2E ISO rollover,012-700 0305
2026-10-05T14:30:45,E2E ISO date-time,012-700 0306
`;
const ISO_DATE_TIME_AS_READ = { UTC: "2026-10-05T14:30:45+00:00", "Asia/Kuala_Lumpur": "2026-10-05T06:30:45+00:00" } as const;

/** Typed workbook cells: a date cell, a date-time cell, a bare serial and ISO text. */
function typedWorkbook(bookType: "xlsx" | "biff8") {
  const ws: XLSX.WorkSheet = {
    "!ref": "A1:C5",
    A1: { t: "s", v: "Date" }, B1: { t: "s", v: "Customer Name" }, C1: { t: "s", v: "Contact" },
    A2: { t: "n", v: 46300, z: "dd/mm/yyyy" }, B2: { t: "s", v: "E2E Typed date only" }, C2: { t: "s", v: "012-700 0401" },
    A3: { t: "n", v: 46320.6041666667, z: "dd/mm/yyyy hh:mm" }, B3: { t: "s", v: "E2E Typed date-time" }, C3: { t: "s", v: "012-700 0402" },
    A4: { t: "n", v: 46300 }, B4: { t: "s", v: "E2E Bare serial" }, C4: { t: "s", v: "012-700 0403" },
    A5: { t: "s", v: "2026-10-05" }, B5: { t: "s", v: "E2E Workbook ISO text" }, C5: { t: "s", v: "012-700 0404" },
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "October");
  return Buffer.from(XLSX.write(wb, { type: "array", bookType }));
}

async function login(page: Page, user: FixtureUser) {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
const FILE_LABEL = "Choose .xlsx / .csv";
/**
 * The import form's file input, bound to the page rendered in main#main.
 * While Next streams the route, React can hold a hidden copy of the page in a
 * <div hidden id="S:n"> outside main until it reveals the Suspense boundary,
 * and the label is screen-reader-only in both copies, so visibility cannot
 * tell them apart. Before using the input, require that the document holds
 * exactly one file input, that it is this one, and that React has hydrated it
 * (an unhydrated input would drop the change event).
 */
async function importFileInput(page: Page, timeout?: number) {
  const input = page.locator("main#main").getByLabel(FILE_LABEL);
  await expect(page.locator('input[type="file"]'), "exactly one file input in the document").toHaveCount(1, { timeout });
  await expect(input, "the document's file input is the one in main#main").toHaveCount(1, { timeout });
  await expect.poll(() => input.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps$"))), { message: "file input hydrated by React", timeout }).toBe(true);
  return input;
}
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/sales/walk-ins/import");
  await expect(page.locator("main#main").getByRole("heading", { name: "Import walk-in workbook" })).toBeVisible();
  await (await importFileInput(page)).setInputFiles(file);
  await expect(page.locator("main#main").getByText(new RegExp(`${file.name.replace(/\./g, "\\.")} · \\d+ rows`))).toBeVisible();
}
function mapping(page: Page, label: string): Locator {
  return page.locator("label").filter({ hasText: new RegExp(`^${label}( \\*)?$`) }).locator("xpath=../..").getByRole("combobox");
}
async function mapTo(page: Page, label: string, column: string) {
  await mapping(page, label).click();
  await page.getByRole("option", { name: column, exact: true }).click();
}
/** The preview's Date cell for the row naming `customer`. */
function previewDate(page: Page, customer: string): Locator {
  return page.getByRole("row").filter({ hasText: customer }).getByRole("cell").nth(2);
}
function previewRow(page: Page, customer: string): Locator {
  return page.getByRole("row").filter({ hasText: customer });
}
const csvFile = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

for (const timezoneId of ["UTC", "Asia/Kuala_Lumpur"] as const) {
  test.describe(`browser in ${timezoneId}`, () => {
    test.describe.configure({ mode: "serial" });
    test.use({ timezoneId });

    const fx = new WalkinImportFixture();
    let importer: FixtureUser;
    test.beforeAll(async () => {
      await fx.create();
      importer = await fx.addUser("dates", "showroom");
    });
    test.afterAll(async () => {
      await fx.destroy();
    });

    let pageErrors: string[] = [];
    test.beforeEach(async ({ page }) => {
      pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
    });
    test.afterEach(() => {
      expect(pageErrors, "uncaught browser errors").toEqual([]);
    });

    test("declared DD/MM/YYYY rows keep their day through preview, commit, API reads, reload and re-import", async ({ page }) => {
      test.setTimeout(180_000);
      await login(page, importer);
      await upload(page, csvFile("tile80-declared-dates.csv", DECLARED_CSV));
      // The title row has no customer column, so the wizard treats it as the
      // header row; the operator maps name and phone by hand, as the
      // coordinator did when reproducing the defect.
      await expect(mapping(page, "Date")).toHaveText("TILE80 declared dates DD/MM/YYYY");
      await mapTo(page, "Customer name", "Column 2");
      await mapTo(page, "Contact phone", "Column 3");
      await page.getByRole("button", { name: "Preview rows" }).click();

      await expect(previewDate(page, FIFTH)).toHaveText("2026-10-05");
      await expect(previewDate(page, TWENTY_FIFTH)).toHaveText("2026-10-25");
      // The real header row lands as data and is refused, not imported.
      await expect(page.getByText("1 rejected", { exact: true })).toBeVisible();
      await expect(previewRow(page, "Bad or missing date")).toContainText("Missing/invalid phone");

      await page.getByRole("button", { name: "Commit 2 rows" }).click();
      await expect(page.getByText("Import committed")).toBeVisible({ timeout: 30_000 });

      const service = await fx.serviceClient(importer);
      const visits = async () => {
        const { data, error } = await service.from("visits").select("occurred_at, contact_id").eq("workspace_id", fx.workspaceId).order("occurred_at");
        expect(error).toBeNull();
        return data ?? [];
      };
      expect((await visits()).map((v) => v.occurred_at)).toEqual(["2026-10-05T00:00:00+00:00", "2026-10-25T00:00:00+00:00"]);

      // The ledger's date cell carries the full Kuala Lumpur date-time in its title.
      await page.goto("/sales/walk-ins");
      for (const pass of ["first render", "after reload"]) {
        await expect(page.getByRole("row").filter({ hasText: FIFTH }).locator("span[title]").first(), pass).toHaveAttribute("title", /\b5 Oct 2026\b/);
        await expect(page.getByRole("row").filter({ hasText: TWENTY_FIFTH }).locator("span[title]").first(), pass).toHaveAttribute("title", /\b25 Oct 2026\b/);
        if (pass === "first render") await page.reload();
      }

      // Same file again: both rows match the visits just written on the same day.
      await upload(page, csvFile("tile80-declared-dates-again.csv", DECLARED_CSV));
      await mapTo(page, "Customer name", "Column 2");
      await mapTo(page, "Contact phone", "Column 3");
      await page.getByRole("button", { name: "Preview rows" }).click();
      await expect(page.getByText("2 duplicate (skipped)", { exact: true })).toBeVisible();
      await expect(previewRow(page, FIFTH)).toContainText("A visit for this phone already exists on that date");
      await expect(page.getByRole("button", { name: "Commit 0 rows" })).toBeDisabled();
      expect(await visits()).toHaveLength(2);
    });

    test("ISO, leap-day, written dates and ISO date-times persist as read; impossible dates are refused, not rolled over", async ({ page }) => {
      await login(page, importer);
      await upload(page, csvFile("tile80-text-controls.csv", TEXT_CONTROLS_CSV));
      await page.getByRole("button", { name: "Preview rows" }).click();
      await expect(previewDate(page, "E2E ISO text")).toHaveText("2026-10-05");
      await expect(previewDate(page, "E2E Leap day")).toHaveText("2024-02-29");
      await expect(previewDate(page, "E2E Written date")).toHaveText("2026-10-05");
      await expect(previewDate(page, "E2E ISO date-time")).toHaveText("2026-10-05");
      for (const refused of ["E2E Rollover", "E2E ISO rollover"]) {
        await expect(previewDate(page, refused), refused).toHaveText("—");
        await expect(previewRow(page, refused), refused).toContainText("Bad or missing date");
      }

      await page.getByRole("button", { name: "Commit 4 rows" }).click();
      await expect(page.getByText("Import committed")).toBeVisible({ timeout: 30_000 });
      const service = await fx.serviceClient(importer);
      const names = ["E2E ISO text", "E2E Leap day", "E2E Written date", "E2E ISO date-time", "E2E Rollover", "E2E ISO rollover"];
      const { data: contacts, error: contactError } = await service.from("contacts").select("id, display_name").eq("workspace_id", fx.workspaceId).in("display_name", names);
      expect(contactError).toBeNull();
      const nameOf = new Map((contacts ?? []).map((c) => [c.id, c.display_name]));
      const { data: visits, error: visitError } = await service.from("visits").select("contact_id, occurred_at").eq("workspace_id", fx.workspaceId).in("contact_id", [...nameOf.keys()]);
      expect(visitError).toBeNull();
      expect(Object.fromEntries((visits ?? []).map((v) => [nameOf.get(v.contact_id!), v.occurred_at]))).toEqual({
        "E2E ISO text": "2026-10-05T00:00:00+00:00",
        "E2E Leap day": "2024-02-29T00:00:00+00:00",
        "E2E Written date": "2026-10-05T00:00:00+00:00",
        "E2E ISO date-time": ISO_DATE_TIME_AS_READ[timezoneId],
      });
    });

    for (const [bookType, name] of [["xlsx", "tile80-typed.xlsx"], ["biff8", "tile80-typed.xls"]] as const) {
      test(`typed ${bookType === "xlsx" ? ".xlsx" : ".xls"} date cells and serials keep their day`, async ({ page }) => {
        await login(page, importer);
        await upload(page, { name, mimeType: "application/octet-stream", buffer: typedWorkbook(bookType) });
        await page.getByRole("button", { name: "Preview rows" }).click();
        await expect(previewDate(page, "E2E Typed date only")).toHaveText("2026-10-05");
        await expect(previewDate(page, "E2E Typed date-time")).toHaveText("2026-10-25");
        await expect(previewDate(page, "E2E Bare serial")).toHaveText("2026-10-05");
        await expect(previewDate(page, "E2E Workbook ISO text")).toHaveText("2026-10-05");
      });
    }

    test("the upload binding refuses a hidden streamed copy of the form and uses the rendered one", async ({ page }) => {
      await login(page, importer);
      await page.goto("/sales/walk-ins/import");
      await expect(page.locator("main#main").getByRole("heading", { name: "Import walk-in workbook" })).toBeVisible();
      // The shape root QC's trace captured on eceac25: a second, screen-reader-only
      // copy of the form in a hidden streaming segment outside main.
      await page.evaluate((label) => {
        document.body.insertAdjacentHTML("beforeend", `<div hidden id="S:e2e-copy"><label>${label}<input type="file" class="sr-only"></label></div>`);
      }, FILE_LABEL);
      await expect(page.getByLabel(FILE_LABEL), "the unscoped eceac25 binding is ambiguous").toHaveCount(2);
      await expect(page.locator("main#main").getByLabel(FILE_LABEL)).toHaveCount(1);
      const refused = await importFileInput(page, 1_000).then(() => null, (error: Error) => error.message);
      expect(refused, "not ready while a hidden copy exists").toContain("exactly one file input in the document");

      await page.evaluate(() => document.getElementById("S:e2e-copy")?.remove());
      await (await importFileInput(page)).setInputFiles(csvFile("tile80-binding.csv", DECLARED_CSV));
      await expect(page.locator("main#main").getByText(/tile80-binding\.csv · 3 rows · 4 columns/)).toBeVisible();
    });
  });
}
