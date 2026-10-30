/**
 * TILE-23: imported media review journey against a running app and the LOCAL
 * Supabase stack. Synthetic fixtures only (real JPEGs rendered by ffmpeg),
 * removed afterwards; refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "TileDemo!2026";
const WS = "11111111-1111-1111-1111-111111111111";
const tag = randomUUID().slice(0, 6).toUpperCase();
const productId = randomUUID(), variantA = randomUUID(), variantB = randomUUID(), sourceId = randomUUID();
const assets = { code: randomUUID(), page: randomUUID(), reject: randomUUID() };
const links = { code: randomUUID(), page: randomUUID(), reject: randomUUID() };
const PRODUCT = `E2E review fixture ${tag}`;
const SKU_A = `E2E-RVA-${tag}`, SKU_B = `E2E-RVB-${tag}`;
const SOURCE = `E2E brochure ${tag}`;
const objectPath = (name: string) => `${WS}/sources/e2e-${tag}/images/${name}.jpg`;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json", ...(process.env.E2E_SUPABASE_WORKDIR ? ["--workdir", process.env.E2E_SUPABASE_WORKDIR] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
const dir = mkdtempSync(join(tmpdir(), "tile-review-e2e-"));
const jpeg = (name: string, pattern: string) => {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `${pattern}=size=320x240`, "-frames:v", "1", join(dir, name)]);
  return readFileSync(join(dir, name));
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const files = { code: jpeg("code.jpg", "testsrc"), page: jpeg("page.jpg", "smptebars"), reject: jpeg("reject.jpg", "rgbtestsrc") };
  for (const [k, bytes] of Object.entries(files)) {
    const { error } = await admin.storage.from("product-media").upload(objectPath(k), bytes, { contentType: "image/jpeg" });
    assert.ifError(error);
  }
  sql(`insert into merch.products(id,workspace_id,name,status) values ('${productId}','${WS}','${PRODUCT}','active');
    insert into merch.product_variants(id,workspace_id,product_id,sku) values ('${variantA}','${WS}','${productId}','${SKU_A}'),('${variantB}','${WS}','${productId}','${SKU_B}');
    insert into ingest.source_assets(id,workspace_id,name,kind) values ('${sourceId}','${WS}','${SOURCE}','pdf');
    insert into ingest.media_assets(id,workspace_id,source_asset_id,external_key,asset_kind,storage_bucket,object_path,content_checksum,mime_type,page_number,source_path) values
      ('${assets.code}','${WS}','${sourceId}','e2e:${tag}:code','product_crop','product-media','${objectPath("code")}',repeat('1',64),'image/jpeg',null,'E2E/${tag}/brochure.pdf'),
      ('${assets.page}','${WS}','${sourceId}','e2e:${tag}:page','pdf_page_render','product-media','${objectPath("page")}',repeat('2',64),'image/jpeg',4,'E2E/${tag}/brochure.pdf'),
      ('${assets.reject}','${WS}','${sourceId}','e2e:${tag}:reject','room_scene','product-media','${objectPath("reject")}',repeat('3',64),'image/jpeg',null,'E2E/${tag}/brochure.pdf');
    insert into ingest.media_asset_variant_links(id,workspace_id,media_asset_id,external_key,product_variant_id,source_code_raw,link_basis,page_number,confidence) values
      ('${links.code}','${WS}','${assets.code}','e2e:${tag}:l-code','${variantA}','RVB-${tag}','exact_ocr_code',null,0.71),
      ('${links.page}','${WS}','${assets.page}','e2e:${tag}:l-page',null,null,'same_source_document',4,null),
      ('${links.reject}','${WS}','${assets.reject}','e2e:${tag}:l-reject','${variantB}',null,'same_catalog_page',null,0.4);`);
});

test.afterAll(async () => {
  await admin.storage.from("product-media").remove(Object.keys(assets).map(objectPath));
  // Evidence first (an approved link may not lose its variant); append-only
  // review decisions for these synthetic ids remain in the local database.
  sql(`delete from ingest.source_assets where id='${sourceId}'; delete from merch.products where id='${productId}';`);
  rmSync(dir, { recursive: true, force: true });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
async function imageLoaded(img: Locator) {
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}
const queue = (page: Page, view: string) => page.goto(`/merchandise/catalog/media-review?view=${view}&q=${encodeURIComponent(tag)}`);
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });
const drawer = (page: Page) => page.getByRole("dialog");
async function chooseVariant(page: Page, sku: string) {
  await drawer(page).getByLabel("Find another variant").fill(sku);
  await drawer(page).getByRole("button", { name: "Search", exact: true }).click();
  await drawer(page).getByLabel("Variant", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(sku) }).click();
}

test("admin reviews imported media: correct, evidence, rights, publish, reject; persisted after reload", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "demo.admin@tileconcept.test");
  await page.goto("/merchandise/catalog");
  await page.getByRole("link", { name: "Imported media review" }).click();
  await expect(page.getByRole("heading", { name: "Imported media review" })).toBeVisible();
  await expect(page.getByTestId("coverage-asof")).toContainText("Live counts as of");

  await queue(page, "open");
  await expect(page.getByRole("row")).toHaveCount(4); // header + 3 fixtures

  // 1. OCR proposed variant A; the page shows B. Publishing is blocked until every gate passes.
  await row(page, "product crop").getByText(SOURCE).click();
  await imageLoaded(drawer(page).getByRole("img").first());
  await expect(drawer(page).getByRole("button", { name: "Publish" })).toBeDisabled();
  await chooseVariant(page, SKU_B);
  await drawer(page).getByLabel("Note (optional)").fill("Code on the page reads RVB");
  await drawer(page).getByRole("button", { name: "Confirm chosen variant" }).click();
  await expect(page.getByText("Association confirmed")).toBeVisible();
  await expect(drawer(page).getByRole("button", { name: "Publish" })).toBeDisabled(); // evidence + rights still open
  await drawer(page).getByRole("button", { name: "Approve evidence" }).click();
  await expect(page.getByText("Evidence approved")).toBeVisible();
  await drawer(page).getByLabel("Rights decision").click();
  await page.getByRole("option", { name: /^Accepted/ }).click();
  await drawer(page).getByLabel("Basis for this decision").fill(`Synthetic supplier licence ${tag}`);
  await drawer(page).getByRole("button", { name: "Record rights" }).click();
  await expect(page.getByText("Usage rights recorded")).toBeVisible();
  await drawer(page).getByLabel("Alt text").fill(`E2E reviewed ${tag}`);
  await drawer(page).getByRole("checkbox", { name: /primary image/ }).check();
  await drawer(page).getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published as the primary catalogue image")).toBeVisible();

  // 2. Same-document context is not a match: confirming it records a new human match.
  await page.keyboard.press("Escape");
  await queue(page, "open");
  await row(page, "Page 4").getByText(SOURCE).click();
  await expect(drawer(page).getByRole("button", { name: "Confirm proposed variant" })).toHaveCount(0);
  await chooseVariant(page, SKU_A);
  await drawer(page).getByRole("button", { name: "Confirm chosen variant" }).click();
  await expect(page.getByText("Association confirmed")).toBeVisible();
  await expect(drawer(page).getByText("Human match")).toBeVisible();

  // 3. Reject with a reason.
  await page.keyboard.press("Escape");
  await queue(page, "open");
  await row(page, "room scene").getByText(SOURCE).click();
  await expect(drawer(page).getByRole("button", { name: "Reject association" })).toBeDisabled();
  await drawer(page).getByLabel("Reason to reject").fill("Room scene shows a different series");
  await drawer(page).getByRole("button", { name: "Reject association" }).click();
  await expect(page.getByText("Association rejected; the evidence is kept")).toBeVisible();

  // Persistence after reload, per view.
  await queue(page, "published");
  await expect(row(page, "product crop")).toContainText(SKU_B);
  await expect(row(page, "product crop")).toContainText("Published · primary");
  await queue(page, "rejected");
  await expect(row(page, "room scene")).toContainText("Rejected");
  await expect(row(page, "Page 4")).toContainText("Superseded");
  await queue(page, "approved");
  await expect(row(page, SKU_A)).toContainText("Human match");
  await page.reload();
  await expect(row(page, SKU_A)).toContainText("Confirmed");

  // The product page shows the published image as primary.
  await page.goto(`/merchandise/catalog/${productId}`);
  await page.getByRole("tab", { name: /^Media/ }).click();
  const card = page.locator("li").filter({ hasText: "Primary image" });
  await expect(card).toContainText(SKU_B);
  await imageLoaded(card.getByRole("img"));
  expect(sql(`select count(*) from ingest.review_decisions where review_target_id in ('${links.code}','${links.page}','${links.reject}','${assets.code}')`)).not.toBe("0");
});

test("sales sees only the published image and cannot open the review queue", async ({ page }) => {
  await login(page, "demo.rep1@tileconcept.test");
  await page.goto(`/merchandise/catalog/${productId}`);
  await page.getByRole("tab", { name: /^Media/ }).click();
  await expect(page.getByRole("tab", { name: "Media (1)" })).toBeVisible();
  const card = page.locator("li").filter({ hasText: SKU_B });
  await imageLoaded(card.getByRole("img"));
  await expect(page.getByRole("tabpanel").getByRole("button", { name: /Replace|Archive|Set primary|Edit details/ })).toHaveCount(0);
  await page.goto("/merchandise/catalog");
  await expect(page.getByRole("link", { name: "Imported media review" })).toHaveCount(0);
  await page.goto("/merchandise/catalog/media-review");
  // The denial heading can render twice during the route transition; one is enough.
  await expect(page.getByRole("heading", { name: /^Not available/ }).first()).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(0);
});

test("withdrawing rights removes the image from sales after reload", async ({ browser }) => {
  const operator = await browser.newPage();
  await login(operator, "demo.admin@tileconcept.test");
  await queue(operator, "published");
  await row(operator, "product crop").getByText(SOURCE).click();
  await drawer(operator).getByLabel("Rights decision").click();
  await operator.getByRole("option", { name: /^Denied/ }).click();
  await drawer(operator).getByLabel("Basis for this decision").fill("Supplier withdrew permission (synthetic)");
  await drawer(operator).getByRole("button", { name: "Record rights" }).click();
  await expect(operator.getByText("1 published image(s) withdrawn")).toBeVisible();
  await operator.close();

  const sales = await browser.newPage();
  await login(sales, "demo.rep1@tileconcept.test");
  await sales.goto(`/merchandise/catalog/${productId}`);
  await sales.getByRole("tab", { name: /^Media/ }).click();
  await expect(sales.getByRole("tab", { name: "Media (0)" })).toBeVisible();
  await expect(sales.getByText(/No approved media for this product yet/)).toBeVisible();
  await sales.close();
});
