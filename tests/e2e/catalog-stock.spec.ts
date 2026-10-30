/**
 * Product Stock tab against a running app and the LOCAL Supabase stack.
 * Balances change only through the existing stock RPCs (the SQL Account
 * connector's record_inventory_snapshot and supplier updates); this checks the
 * persisted result after reload. Synthetic fixtures; refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const SUPPLIER = "34343434-0000-0000-0000-000000000001";
const productId = randomUUID();
const variantA = randomUUID();
const variantB = randomUUID();
const tag = productId.slice(0, 6).toUpperCase();
const ITEM = `E2E-ITEM-${tag}`;
const WH_A = `E2E-WH-A-${tag}`;
const WH_B = `E2E-WH-B-${tag}`;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json", ...(process.env.E2E_SUPABASE_WORKDIR ? ["--workdir", process.env.E2E_SUPABASE_WORKDIR] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
// A real stock writer session calling the same RPCs the app's stock workflows use.
const writer = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { db: { schema: "api" }, auth: { persistSession: false } });

async function snapshot(location: string, onHand: number, allocated: number, available: number) {
  const { error } = await writer.rpc("record_inventory_snapshot", { p_source_key: "sql_account", p_external_item_code: ITEM, p_on_hand: onHand, p_allocated: allocated, p_available: available, p_location_code: location });
  assert.ifError(error);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql(`insert into merch.products(id,workspace_id,name,code) values ('${productId}','${WORKSPACE}','E2E stock fixture ${tag}','E2E-STK-${tag}');
       insert into merch.product_variants(id,workspace_id,product_id,sku) values ('${variantA}','${WORKSPACE}','${productId}','E2E-A-${tag}'),('${variantB}','${WORKSPACE}','${productId}','E2E-B-${tag}');
       insert into stock.inventory_item_mappings(workspace_id,source_id,external_item_code,variant_id,status)
         select '${WORKSPACE}', id, '${ITEM}', '${variantA}', 'mapped' from stock.inventory_sources where workspace_id='${WORKSPACE}' and key='sql_account';`);
  const { error } = await writer.auth.signInWithPassword({ email: "demo.admin@tileconcept.test", password: PASSWORD });
  assert.ifError(error);
});

test.afterAll(() => {
  sql(`delete from stock.inventory_snapshots where external_item_code='${ITEM}';
       delete from stock.supplier_availability_snapshots where variant_id in ('${variantA}','${variantB}');
       delete from stock.inventory_item_mappings where external_item_code='${ITEM}';
       delete from stock.inventory_locations where external_code in ('${WH_A}','${WH_B}');
       delete from merch.products where id='${productId}';`);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
async function openStock(page: Page) {
  await page.goto(`/merchandise/catalog/${productId}`);
  await page.getByRole("tab", { name: "Stock" }).click();
}
const row = (page: Page, text: string) => page.getByRole("table", { name: "Stock by variant and warehouse" }).getByRole("row").filter({ hasText: text });

test("sales sees per-warehouse balances, and persisted stock changes after reload", async ({ page }) => {
  await login(page, "demo.rep1@tileconcept.test");

  // Before any record: each variant says so, nothing reads as zero.
  await openStock(page);
  await expect(row(page, `E2E-A-${tag}`)).toContainText("No stock record for this variant");
  await expect(row(page, `E2E-B-${tag}`)).toContainText("No stock record for this variant");

  // Connector snapshots for two warehouses.
  await snapshot(WH_A, 40, 5, 35);
  await snapshot(WH_B, 12, 0, 12);
  await openStock(page);
  await expect(row(page, WH_A)).toContainText("Available");
  await expect(row(page, WH_A)).toContainText("35");
  await expect(row(page, WH_A)).toContainText("40");
  await expect(row(page, WH_B)).toContainText("12");
  await expect(row(page, "In-house total across warehouses")).toContainText("47");
  await expect(row(page, `E2E-B-${tag}`)).toContainText("No stock record for this variant");

  // Stock moves out of WH-A: the newer snapshot wins after reload, never summed with the old one.
  await snapshot(WH_A, 8, 3, 5);
  await page.reload();
  await page.getByRole("tab", { name: "Stock" }).click();
  await expect(row(page, WH_A)).toContainText("Low");
  await expect(row(page, WH_A)).toContainText("5");
  // No cell still shows the old 35. Checked per cell: the whole row also holds
  // the random fixture tag, which can itself contain "35".
  await expect(row(page, WH_A).getByRole("cell").filter({ hasText: /^35$/ })).toHaveCount(0);
  await expect(row(page, "In-house total across warehouses")).toContainText("17");

  // Supplier evidence for variant B appears as its own dated line, not as in-house stock.
  const { error } = await writer.rpc("record_supplier_availability", { p_supplier_id: SUPPLIER, p_availability: "ask_supplier", p_variant_id: variantB, p_source_channel: "call", p_notes: "E2E synthetic" });
  assert.ifError(error);
  await openStock(page);
  const supplierRow = row(page, "Demo Mosaic Supplier Sdn Bhd");
  await expect(supplierRow).toContainText(`E2E-B-${tag}`);
  await expect(supplierRow).toContainText("Supplier");
  await expect(supplierRow).toContainText("Ask supplier");
  await expect(row(page, `E2E-B-${tag}`).filter({ hasText: "No stock record" })).toHaveCount(0);

  // The Stock module still lists the same lines.
  await page.getByRole("link", { name: "Open in Stock module" }).click();
  await expect(page).toHaveURL(/\/merchandise\/stock\?q=E2E-STK-/);
  await expect(page.getByText(`E2E stock fixture ${tag}`).first()).toBeVisible();
});

test("a role without stock access is told so instead of seeing stock", async ({ page }) => {
  await login(page, "demo.marketing@tileconcept.test");
  await openStock(page);
  await expect(page.getByRole("table", { name: "Stock by variant and warehouse" })).toHaveCount(0);
  await expect(page.getByRole("tabpanel")).toContainText(/stock/i);
  // The database agrees: RLS returns nothing for this role even if asked directly.
  const reader = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { db: { schema: "api" }, auth: { persistSession: false } });
  await reader.auth.signInWithPassword({ email: "demo.marketing@tileconcept.test", password: PASSWORD });
  const { data } = await reader.from("stock_availability").select("variant_id").eq("product_id", productId);
  expect(data ?? []).toHaveLength(0);
});
