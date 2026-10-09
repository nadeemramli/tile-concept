/**
 * TILE-21: human-confirmed catalogue product merge against a running app and
 * the LOCAL Supabase stack. Synthetic fixtures only, removed afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const WS = "11111111-1111-1111-1111-111111111111";
const LIST = "37373737-0000-0000-0000-000000000001";
const tag = randomUUID().slice(0, 6).toUpperCase();
const keep = randomUUID(), dup = randomUUID(), c1 = randomUUID(), c2 = randomUUID();
const keepV = randomUUID(), dupV = randomUUID(), dupV2 = randomUUID(), c1V = randomUUID(), c2V = randomUUID();
const priceId = randomUUID(), snapId = randomUUID(), lineId = randomUUID();
const KEEP = `E2E merge keep ${tag}`, DUP = `E2E merge dup ${tag}`;
const SKU = `E2E-MV-${tag}`, SKU2 = `E2E-MV2-${tag}`;
function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  sql(`insert into merch.products(id,workspace_id,name,code,status) values
      ('${keep}','${WS}','${KEEP}','E2E-MK-${tag}','active'), ('${dup}','${WS}','${DUP}','E2E-MD-${tag}','active'),
      ('${c1}','${WS}','E2E clash one ${tag}','E2E-C1-${tag}','active'), ('${c2}','${WS}','E2E clash two ${tag}','E2E-C2-${tag}','active');
    insert into merch.product_variants(id,workspace_id,product_id,sku,is_default) values
      ('${keepV}','${WS}','${keep}','${SKU}',true), ('${dupV}','${WS}','${dup}','${SKU}',true), ('${dupV2}','${WS}','${dup}','${SKU2}',false),
      ('${c1V}','${WS}','${c1}','E2E-CV-${tag}',true), ('${c2V}','${WS}','${c2}','E2E-CV-${tag}',true);
    insert into merch.variant_prices(id,workspace_id,price_list_id,variant_id,amount,currency,min_quantity,state,review_state,valid_from) values
      ('${priceId}','${WS}','${LIST}','${dupV}',77.5,'MYR',1,'current','reviewed','2026-09-01'),
      (gen_random_uuid(),'${WS}','${LIST}','${c1V}',10,'MYR',1,'current','reviewed','2026-09-01'),
      (gen_random_uuid(),'${WS}','${LIST}','${c2V}',11,'MYR',1,'current','reviewed','2026-09-01');
    insert into stock.inventory_snapshots(id,workspace_id,source_id,location_id,variant_id,on_hand,available)
      select '${snapId}','${WS}',s.id,l.id,'${dupV}',9,9 from stock.inventory_sources s join stock.inventory_locations l on l.source_id=s.id
      where s.workspace_id='${WS}' and s.key='sql_account' and l.external_code='WH-01';
    insert into sales.purchase_items(id,purchase_id,description,product_variant_id) select '${lineId}', id, 'E2E merge line ${tag}', '${dupV}' from sales.purchases where workspace_id='${WS}' limit 1;`);
  assert.equal(sql(`select (select count(*) from stock.inventory_snapshots where id='${snapId}') + (select count(*) from sales.purchase_items where id='${lineId}')`), "2");
});

test.afterAll(() => {
  sql(`delete from sales.purchase_items where id='${lineId}'; delete from stock.inventory_snapshots where id='${snapId}';
       delete from merch.products where id in ('${dup}','${c1}','${c2}'); delete from merch.products where id='${keep}';`);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("TileDemo!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test("operator reviews, previews and confirms a product merge; references survive reload", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "demo.admin@tileconcept.test");
  await page.goto(`/merchandise/catalog/${keep}`);
  const suggestion = page.locator("li").filter({ hasText: DUP });
  await expect(suggestion).toBeVisible();
  await suggestion.getByRole("link", { name: "Review merge" }).click();
  await expect(page.getByRole("heading", { name: "Review product merge" })).toBeVisible();

  // Comparison and the suggested pairing (same SKU) — never applied without the reviewer.
  await expect(page.getByRole("columnheader", { name: new RegExp(`Keep ${KEEP}`) })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: new RegExp(DUP) })).toBeVisible();
  await expect(page.getByLabel(`Decision for ${SKU}`)).toContainText(`Merge into ${SKU} (same code)`);
  await expect(page.getByLabel(`Decision for ${SKU2}`)).toContainText("Move to the surviving product");
  const impact = page.getByTestId("merge-impact");
  await expect(impact.locator("li").filter({ hasText: "Prices" })).toContainText("1");
  await expect(impact.locator("li").filter({ hasText: "Stock records" })).toContainText("1");
  await expect(impact.locator("li").filter({ hasText: "Purchase and quote lines" })).toContainText("1");
  await expect(impact.locator("li").filter({ hasText: "Variants merged" })).toContainText("1");

  // Explicit confirmation: reason + tick, otherwise the button stays disabled.
  const mergeButton = page.getByRole("button", { name: "Merge products" });
  await expect(mergeButton).toBeDisabled();
  await page.getByLabel("Why are these the same product?").fill(`Same tile imported twice (synthetic ${tag})`);
  await expect(mergeButton).toBeDisabled();
  await page.getByRole("checkbox", { name: /I compared both products/ }).check();
  await expect(mergeButton).toBeEnabled();

  // Changing a decision re-previews and clears the confirmation.
  await page.getByLabel(`Decision for ${SKU}`).click();
  await page.getByRole("option", { name: "Move to the surviving product" }).click();
  await expect(impact.locator("li").filter({ hasText: "Variants merged" })).toContainText("0");
  await expect(page.getByRole("checkbox", { name: /I compared both products/ })).not.toBeChecked();
  await page.getByLabel(`Decision for ${SKU}`).click();
  await page.getByRole("option", { name: `Merge into ${SKU} (same code)` }).click();
  await expect(impact.locator("li").filter({ hasText: "Variants merged" })).toContainText("1");
  await page.getByRole("checkbox", { name: /I compared both products/ }).check();
  await mergeButton.click();
  await page.waitForURL(`**/merchandise/catalog/${keep}`);
  await expect(page.getByText("Products merged; the duplicate is archived and points here")).toBeVisible();

  // Persisted after reload: moved variant, price, aliases.
  await page.reload();
  await page.getByRole("tab", { name: /^Variants/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText(SKU2);
  await page.getByRole("tab", { name: /^Pricing/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("77.50");
  await page.getByRole("tab", { name: /^Aliases/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText(DUP);
  await expect(page.locator("li").filter({ hasText: DUP }).getByRole("link", { name: "Review merge" })).toHaveCount(0); // no longer suggested

  // The duplicate remains, archived, pointing at the survivor.
  await page.goto(`/merchandise/catalog/${dup}`);
  await expect(page.getByRole("status").filter({ hasText: "Merged into" })).toBeVisible();
  await page.getByRole("link", { name: "the surviving product" }).click();
  await page.waitForURL(`**/merchandise/catalog/${keep}`);

  const [priceVariant, snapVariant, lineVariant, merges] = sql(`select (select variant_id from merch.variant_prices where id='${priceId}'), (select variant_id from stock.inventory_snapshots where id='${snapId}'),
    (select product_variant_id from sales.purchase_items where id='${lineId}'), (select count(*) from merch.product_merges where merged_product_id='${dup}')`).split("|");
  expect([priceVariant, snapVariant, lineVariant, merges]).toEqual([keepV, keepV, keepV, "1"]);
});

test("a conflicting merge is blocked with the reason, and nothing moves", async ({ page }) => {
  await login(page, "demo.admin@tileconcept.test");
  await page.goto(`/merchandise/catalog/merge?survivor=${c1}&merged=${c2}`);
  const blocked = page.getByRole("alert").filter({ hasText: "Merge blocked" });
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("both have a current price on the same list");
  await page.getByLabel("Why are these the same product?").fill("Synthetic conflict check");
  await page.getByRole("checkbox", { name: /I compared both products/ }).check();
  await expect(page.getByRole("button", { name: "Merge products" })).toBeDisabled();
  expect(sql(`select count(*) from merch.product_merges where merged_product_id='${c2}'`)).toBe("0");
});

test("sales cannot open or start a merge", async ({ page }) => {
  await login(page, "demo.rep1@tileconcept.test");
  await page.goto(`/merchandise/catalog/merge?survivor=${c1}&merged=${c2}`);
  await expect(page.getByText(/^Not available/)).toBeVisible();
  await page.goto(`/merchandise/catalog/${c1}`);
  await expect(page.getByRole("link", { name: "Review merge" })).toHaveCount(0);
});
