/**
 * TILE-23: imported commercial proposals (price candidates) are approved or
 * rejected by a person in Imports & OCR Review; an unstated field blocks
 * approval and nothing is defaulted. LOCAL stack, synthetic items, cleaned up.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const WS = "11111111-1111-1111-1111-111111111111";
const tag = randomUUID().slice(0, 6).toUpperCase();
const approveId = randomUUID(), rejectId = randomUUID();
const CODE = `E2E-PX-${tag}`;
function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const [brand, unit, list] = sql(`select (select id from merch.brands where workspace_id='${WS}' order by name limit 1), (select id from merch.units_of_measure where workspace_id='${WS}' and code='sqm'), (select id from merch.price_lists where workspace_id='${WS}' order by name limit 1)`).split("|");
  assert(brand && unit && list, "seeded brand, unit and price list required");
  // Everything stated except the tax basis, which the source never said.
  const proposed = JSON.stringify({ name: `E2E proposal ${tag}`, code: CODE, amount: "41.20", currency: "MYR", brand_id: brand, unit_id: unit, min_quantity: "1", price_list_id: list, price_type: "retail", market: "MY", valid_from: "2026-10-01", source_ref: `Synthetic list ${tag} p.2` });
  sql(`insert into ingest.review_items(id,workspace_id,item_type,proposed,status,confidence) values
    ('${approveId}','${WS}','price','${proposed}'::jsonb,'pending',0.9),
    ('${rejectId}','${WS}','price','${JSON.stringify({ name: `E2E rejected ${tag}`, code: `${CODE}-R`, amount: "9.99", currency: "MYR" })}'::jsonb,'pending',0.5)`);
});

test.afterAll(() => {
  sql(`delete from merch.products where code='${CODE}' and workspace_id='${WS}'; delete from ingest.review_items where id in ('${approveId}','${rejectId}');`);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("TileDemo!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test("operator approves a stated price only after naming the tax basis, and rejects another with a reason", async ({ page }) => {
  await login(page, "demo.admin@tileconcept.test");
  await page.goto(`/sources/review?status=pending&item=${approveId}`);
  await expect(page.locator("#f-code")).toHaveValue(CODE);
  const approve = page.getByRole("button", { name: /approve/i }).last();
  await expect(approve).toBeDisabled(); // tax basis not established
  await page.locator("#f-tax_basis").click();
  await page.getByRole("option", { name: "Tax exclusive" }).click();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Published. The price is a draft until it is published on the price list.")).toBeVisible();
  const [state, amount, currency, tax] = sql(`select ri.status, vp.amount, vp.currency, vp.tax_basis from ingest.review_items ri join merch.variant_prices vp on vp.id = ri.published_object_id where ri.id='${approveId}'`).split("|");
  expect(["approved", "corrected"]).toContain(state);
  expect([Number(amount), currency, tax]).toEqual([41.2, "MYR", "exclusive"]);

  await page.goto(`/sources/review?status=pending&item=${rejectId}`);
  await expect(page.locator("#f-code")).toHaveValue(`${CODE}-R`);
  await page.getByRole("button", { name: "Reject" }).click();
  await page.locator("#reject-reason").fill("Synthetic: superseded by the newer list");
  await page.getByRole("button", { name: "Reject row" }).click();
  await expect(page.getByText("Rejected. The correction is kept as parser feedback.")).toBeVisible();
  await page.reload();
  expect(sql(`select status || '|' || coalesce(decision_note,'') from ingest.review_items where id='${rejectId}'`)).toBe("rejected|Synthetic: superseded by the newer list");
  await page.goto(`/sources/review?status=${state}&item=${approveId}`); // persisted decision after reload
  await expect(page.locator("#f-code")).toHaveValue(CODE);
});

test("a sales role without review access cannot approve", async ({ page }) => {
  await login(page, "demo.showroom@tileconcept.test");
  await page.goto("/sources/review");
  // The denial heading can render twice during the route transition; one is enough.
  await expect(page.getByRole("heading", { name: /^Not available/ }).first()).toBeVisible();
});
