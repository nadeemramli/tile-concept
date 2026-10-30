/**
 * Weekly forecast review against a running app and a LOCAL Supabase stack.
 * The suite creates its own synthetic users, company and opportunities, signs
 * each user in within its own browser context (no global sign-out), and
 * removes everything afterwards. Refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { addWeeks, currentWeekStart, formatWeek, weekEndOf } from "../../src/features/forecast/week";

const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const PASSWORD = `E2e!${randomUUID()}`;
const tag = randomUUID().slice(0, 8);

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
function stack(): { url: string; key: string } {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  const s = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  return { url: s.API_URL, key: s.SERVICE_ROLE_KEY ?? s.SECRET_KEY };
}
const { url, key } = stack();
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const admin = createClient(url, key, { auth: { persistSession: false } });

const users = {
  rep: { email: `e2e.forecast.${tag}.rep@tileconcept.test`, role: "sales_rep", name: `E2E Forecast Rep ${tag}`, id: "" },
  showroom: { email: `e2e.forecast.${tag}.showroom@tileconcept.test`, role: "showroom", name: `E2E Forecast Showroom ${tag}`, id: "" },
  catalog: { email: `e2e.forecast.${tag}.catalog@tileconcept.test`, role: "catalog_pricing", name: `E2E Forecast Catalog ${tag}`, id: "" },
};
const week = currentWeekStart();
const sunday = weekEndOf(week);
const lastWeek = addWeeks(week, -1);
const ids = { account: randomUUID(), old: randomUUID(), unforecast: randomUUID(), won: randomUUID(), passed: randomUUID(), quoted: randomUUID() };
const NAMES = {
  old: `E2E old pursuit ${tag}`,
  unforecast: `E2E unforecast pursuit ${tag}`,
  won: `E2E won pursuit ${tag}`,
  passed: `E2E passed pursuit ${tag}`,
  quoted: `E2E quoted pursuit ${tag}`,
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error || !data.user) throw error ?? new Error("user not created");
    u.id = data.user.id;
    sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${WORKSPACE}','${u.id}','${u.role}') on conflict (workspace_id,user_id) do update set role_key=excluded.role_key, status='active';
         update core.profiles set full_name='${u.name}' where user_id='${u.id}';`);
  }
  const rep = users.rep.id;
  const opp = (id: string, name: string, stage: string, status: string, close: string | null, band: string | null, value: number | null, createdAt = "now()") =>
    `('${id}','${WORKSPACE}','${name}','${ids.account}','${rep}','${stage}','${status}',${close ? `'${close}'` : "null"},${band ? `'${band}'` : "null"},${value ?? "null"},'MYR','Call the customer',now()+interval '2 days',${createdAt})`;
  sql(`insert into identity.accounts(id,workspace_id,name) values ('${ids.account}','${WORKSPACE}','E2E forecast company ${tag}');
       insert into sales.opportunities(id,workspace_id,name,account_id,owner_id,stage_key,status,expected_close_date,probability_band,estimated_value,currency,next_action,next_action_due_at,created_at) values
       ${opp(ids.old, NAMES.old, "quote_sent", "open", sunday, "high", 1000, "'2025-01-15'")},
       ${opp(ids.unforecast, NAMES.unforecast, "qualified", "open", null, null, null, "'2025-03-01'")},
       ${opp(ids.won, NAMES.won, "won", "won", sunday, "high", 900)},
       ${opp(ids.passed, NAMES.passed, "quote_sent", "open", "2026-01-05", "medium", 300, "'2025-06-01'")},
       ${opp(ids.quoted, NAMES.quoted, "consultation", "open", null, null, null)};
       insert into sales.opportunity_forecast_history(workspace_id,opportunity_id,recorded_at,kind,status,stage_key,archived,owner_id,expected_close_date,probability_band,estimated_value,currency)
       values ('${WORKSPACE}','${ids.passed}',('${lastWeek}'::date+2)::timestamp at time zone 'Asia/Kuala_Lumpur','change','open','quote_sent',false,'${rep}','${lastWeek}'::date+4,'low',250,'MYR');`);
});

test.afterAll(async () => {
  const opps = Object.values(ids).filter((id) => id !== ids.account).map((id) => `'${id}'`).join(",");
  const people = Object.values(users).filter((u) => u.id).map((u) => `'${u.id}'`).join(",");
  sql(`delete from sales.activities where opportunity_id in (${opps});
       delete from sales.quote_versions where quote_id in (select id from sales.quotes where opportunity_id in (${opps}));
       delete from sales.quotes where opportunity_id in (${opps});
       delete from sales.opportunities where id in (${opps});
       delete from identity.accounts where id='${ids.account}';
       ${people ? `delete from core.memberships where user_id in (${people});` : ""}`);
  for (const u of Object.values(users)) if (u.id) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
const forecastUrl = (extra = "") => `/sales/pipeline/forecast?owner=${users.rep.id}${extra}`;
const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("dialog").last().getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("salesperson reviews the selected week, works the exception queues and corrects a forecast", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, users.rep.email);
  await page.goto(forecastUrl());

  // Selected week first, with its declared basis and complete scoped counts.
  await expect(page.getByTestId("forecast-week")).toHaveText(formatWeek(week));
  await expect(page.getByTestId("forecast-declaration")).toContainText("Current forecast as of");
  await expect(page.getByTestId("forecast-declaration")).toContainText("Population: 4 active opportunities");
  await expect(row(page, NAMES.old)).toBeVisible(); // created in 2025, closing this week
  await expect(row(page, NAMES.won)).toHaveCount(0);
  await expect(page.getByTestId("forecast-excluded")).toContainText("1 won");
  await expect(page.getByTestId("forecast-bands")).toContainText("High likelihood1RM 1,000.00");
  await expect(page.getByTestId("forecast-range")).toHaveText("1–1 of 1");

  // A passed date is queued as it was, never rolled forward.
  await page.getByRole("tab", { name: /Close date passed/ }).click();
  await expect(row(page, NAMES.passed)).toContainText("5 Jan 2026");

  // Unforecast legacy work is queued, not dropped or filled in.
  await page.getByRole("tab", { name: /No close date/ }).click();
  await expect(row(page, NAMES.unforecast)).toContainText("Unknown");
  await expect(row(page, NAMES.unforecast)).toContainText("Never");

  // Review it: date, likelihood, value, evidence and next step.
  await row(page, NAMES.unforecast).getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Expected close", { exact: true }).fill(sunday);
  await chooseOption(page, "Likelihood", "Medium");
  await dialog.getByLabel("Estimated value", { exact: true }).fill("2500");
  await dialog.getByLabel("Evidence", { exact: true }).fill(`E2E evidence ${tag}: budget confirmed on site`);
  await dialog.getByLabel(/^Next step/).fill("Send revised layout");
  await dialog.getByLabel(/^Due \(Malaysia time\)/).fill(`${sunday}T10:00`);
  await dialog.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Forecast reviewed.")).toBeVisible();

  // Persisted across a reload: it moved from the queue into the week.
  await page.goto(forecastUrl());
  await expect(row(page, NAMES.unforecast)).toContainText("Medium");
  await expect(row(page, NAMES.unforecast)).toContainText("RM 2,500.00");
  await expect(row(page, NAMES.unforecast)).toContainText(users.rep.name);
  await expect(page.getByTestId("forecast-bands")).toContainText("Medium likelihood1RM 2,500.00");
  await page.goto(forecastUrl("&list=missing_date"));
  await expect(row(page, NAMES.unforecast)).toHaveCount(0);

  // Correction: a later review changes the current view and keeps the earlier one in history.
  await page.goto(forecastUrl());
  await row(page, NAMES.unforecast).getByRole("button", { name: "Review" }).click();
  await chooseOption(page, "Likelihood", "High");
  await page.getByRole("dialog").getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Forecast reviewed.")).toBeVisible();
  await page.reload();
  await expect(row(page, NAMES.unforecast)).toContainText("High");
  await page.goto(`/sales/pipeline?opportunity=${ids.unforecast}`);
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(`E2E evidence ${tag}`);
  await drawer.getByText(/Forecast history/).click();
  await expect(drawer.getByText("Reviewed", { exact: true })).toHaveCount(2);

  // Stale write: someone else changed the opportunity while the dialog was open.
  await page.goto(forecastUrl());
  await row(page, NAMES.old).getByRole("button", { name: "Review" }).click();
  sql(`update sales.opportunities set notes='E2E concurrent edit' where id='${ids.old}'`);
  await page.getByRole("dialog").getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Opportunity changed. Refresh and try again.")).toBeVisible();
});

test("as-recorded view rebuilds an earlier week from history, and current does not", async ({ page }) => {
  await login(page, users.rep.email);
  await page.goto(forecastUrl(`&week=${lastWeek}&mode=recorded`));
  await expect(page.getByTestId("forecast-declaration")).toContainText("As recorded");
  await expect(page.getByTestId("forecast-declaration")).toContainText("Later corrections are not applied");
  await expect(row(page, NAMES.passed)).toContainText("Low");
  await expect(row(page, NAMES.passed)).toContainText("RM 250.00");
  await expect(row(page, NAMES.passed).getByRole("button", { name: "Review" })).toBeDisabled();
  await page.getByRole("radio", { name: "Current" }).click();
  await expect(page.getByTestId("forecast-declaration")).toContainText("Current forecast as of");
  await expect(row(page, NAMES.passed)).toHaveCount(0);
});

test("a quotation is recorded without a forecast, and a stage change can capture one", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, users.rep.email);
  await page.goto(`/sales/pipeline?opportunity=${ids.quoted}`);
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Quote version" }).click();
  await page.getByRole("dialog", { name: /Add quote/ }).getByRole("button", { name: "Issue version" }).click();
  await expect(page.getByText("Quote version 1 added.")).toBeVisible();
  await page.goto(forecastUrl("&list=missing_date"));
  await expect(row(page, NAMES.quoted)).toBeVisible();

  await page.goto(`/sales/pipeline?opportunity=${ids.quoted}`);
  await page.getByRole("dialog").getByRole("button", { name: "Stage" }).click();
  const stage = page.getByRole("dialog", { name: "Change stage" });
  await stage.getByRole("combobox").first().click();
  await page.getByRole("option", { name: /Negotiation/ }).click();
  await stage.getByLabel("Expected close", { exact: true }).fill(sunday);
  await chooseOption(page, "Likelihood", "Low");
  await stage.getByRole("button", { name: "Move stage" }).click();
  await expect(page.getByText("Stage updated.")).toBeVisible();
  await page.goto(forecastUrl());
  await expect(row(page, NAMES.quoted)).toContainText("Low");
  await expect(row(page, NAMES.quoted)).toContainText("Negotiation");
});

test("showroom staff without shared sales scope cannot see another salesperson's forecast", async ({ page }) => {
  await login(page, users.showroom.email);
  await page.goto(forecastUrl());
  await expect(page.getByRole("heading", { name: "Weekly forecast" })).toBeVisible();
  await expect(row(page, NAMES.old)).toHaveCount(0);
  await expect(page.getByTestId("forecast-declaration")).toContainText("Population: 0 active opportunities");
});

test("a role without sales access is refused", async ({ page }) => {
  await login(page, users.catalog.email);
  await page.goto("/sales/pipeline/forecast");
  await expect(page.getByRole("heading", { name: /Not available/ })).toBeVisible();
  await expect(page.getByTestId("forecast-bands")).toHaveCount(0);
});
