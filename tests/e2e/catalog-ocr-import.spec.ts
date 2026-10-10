/**
 * TILE-22: OCR-assisted scanned catalogue import, end to end.
 *
 * Real path: the browser uploads a synthetic scanned PDF to private storage →
 * the app parses it and queues the scanned pages → the OCR worker
 * (`pnpm ocr:worker --once`, local Tesseract) reads them → a reviewer edits and
 * approves a proposal → the product and draft price persist with source/page
 * provenance. Plus the fallbacks: unreadable page, manual entry, engine
 * outage + retry, encrypted and undecodable files, duplicate upload, no
 * approval, permissions and another workspace.
 *
 * LOCAL stack only (refuses hosted targets); synthetic fixtures, removed after.
 * Needs `tesseract` (with eng) and `gs` on the machine running the worker.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { jpegsToPdf, renderScan, syntheticCatalogue } from "../fixtures/ocr/synthetic-scan";

const PASSWORD = "TileDemo!2026";
const WS = "11111111-1111-1111-1111-111111111111";
const OTHER_WS = randomUUID();
const otherAsset = randomUUID();
// Letters only: OCR confuses 1/l and 0/O, and the tag must survive a scan.
const tag = Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ"[Math.floor(Math.random() * 23)]).join("");
const CODE = `SYN-${tag}-6060G`;
const MANUAL_CODE = `SYN-${tag}-HAND1`;
const files = { scan: `e2e-scan-${tag}.pdf`, locked: `e2e-locked-${tag}.pdf`, broken: `e2e-broken-${tag}.png`, photo: `e2e-photo-${tag}.jpg` };

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json", ...(process.env.E2E_SUPABASE_WORKDIR ? ["--workdir", process.env.E2E_SUPABASE_WORKDIR] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const SECRET = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
const admin = createClient(status.API_URL, SECRET, { auth: { persistSession: false } });
const dir = mkdtempSync(join(tmpdir(), "tile-ocr-e2e-"));
let codes: { code: string; price: string }[] = [];

/** Run the real worker once, as the operator would: drain due jobs and exit. */
function worker(env: Record<string, string> = {}) {
  return execFileSync("pnpm", ["--silent", "ocr:worker", "--once"], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_URL: status.API_URL, SUPABASE_SECRET_KEY: SECRET, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const assetId = (name: string) => sql(`select id from ingest.source_assets where workspace_id='${WS}' and name='${name}'`);
const job = (asset: string) => sql(`select status || '|' || coalesce(failure_kind,'') || '|' || attempts from ingest.ingestion_jobs where source_asset_id='${asset}' and job_type='ocr'`);

// Each journey runs the real OCR worker as a separate process; under a full
// parallel suite that alone can take tens of seconds, so the budget is explicit.
test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  const cat = await syntheticCatalogue(tag);
  codes = cat.codes;
  writeFileSync(join(dir, files.scan), cat.pdf);
  // Same scan, password-protected by Ghostscript.
  const plain = join(dir, "plain.pdf");
  writeFileSync(plain, await jpegsToPdf([await renderScan({ lines: [`Code: SYN-${tag}-LOCK1  Price: RM 10.00`] })]));
  execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-sOwnerPassword=synthetic-owner", "-sUserPassword=synthetic-user", "-dEncryptionR=3", "-dKeyLength=128", `-sOutputFile=${join(dir, files.locked)}`, plain]);
  writeFileSync(join(dir, files.broken), Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(`not really a png ${tag}`)]));
  writeFileSync(join(dir, files.photo), await renderScan({ lines: [`Code: SYN-${tag}-PHOTO  Price: RM 20.00 per pc`, "Finish: Gloss"], width: 1000, height: 500 }));
  // Another workspace's scanned source, for the isolation check.
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WS}','E2E OCR other ${tag}','e2e-ocr-other-${tag.toLowerCase()}');
       insert into ingest.source_assets(id,workspace_id,name,kind,storage_path,checksum,mime_type) values ('${otherAsset}','${OTHER_WS}','Other ${tag}.pdf','pdf','${OTHER_WS}/x.pdf','other-${tag}','application/pdf');`);
});

test.afterAll(async () => {
  const ids = sql(`select coalesce(string_agg(id::text, ','), '') from ingest.source_assets where workspace_id='${WS}' and name like 'e2e-%-${tag}.%'`);
  const paths = sql(`select coalesce(string_agg(storage_path, ','), '') from ingest.source_assets where workspace_id='${WS}' and name like 'e2e-%-${tag}.%'`).split(",").filter(Boolean);
  const jobs = ids ? sql(`select coalesce(string_agg(id::text, ','), '') from ingest.ingestion_jobs where source_asset_id in (${ids.split(",").map((i) => `'${i}'`).join(",")}) and job_type='ocr'`).split(",").filter(Boolean) : [];
  for (const j of jobs) {
    const { data } = await admin.storage.from("ingest-artifacts").list(`${WS}/ocr/${j}`);
    if (data?.length) await admin.storage.from("ingest-artifacts").remove(data.map((f) => `${WS}/ocr/${j}/${f.name}`));
  }
  if (paths.length) await admin.storage.from("source-assets").remove(paths);
  sql(`delete from merch.variant_prices where variant_id in (select v.id from merch.product_variants v join merch.products p on p.id=v.product_id where p.workspace_id='${WS}' and p.code like 'SYN-${tag}-%');
       delete from merch.product_variants where product_id in (select id from merch.products where workspace_id='${WS}' and code like 'SYN-${tag}-%');
       delete from merch.products where workspace_id='${WS}' and code like 'SYN-${tag}-%';
       delete from ingest.data_quality_issues where object_id in (select id from ingest.ingestion_jobs where source_asset_id in (select id from ingest.source_assets where workspace_id='${WS}' and name like 'e2e-%-${tag}.%'));
       delete from ingest.source_assets where workspace_id='${WS}' and name like 'e2e-%-${tag}.%';
       delete from ingest.source_assets where id='${otherAsset}';
       delete from core.workspaces where id='${OTHER_WS}';`);
  rmSync(dir, { recursive: true, force: true });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

async function upload(page: Page, name: string) {
  await page.goto("/sources/library");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.locator("#source-file").setInputFiles(join(dir, name));
  await page.getByRole("button", { name: "Upload and read" }).click();
}

async function choose(page: Page, field: string, option: string | RegExp) {
  await page.locator(`#f-${field}`).click();
  await page.getByRole("option", { name: option }).first().click();
}

test("admin imports a scanned catalogue; OCR proposals are edited, approved and persist with page provenance", async ({ page }) => {
  await login(page, "demo.admin@tileconcept.test");
  await upload(page, files.scan);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/2 scanned page\(s\) queued for OCR/)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Nothing has been published — every row waits in the review queue.")).toBeVisible();
  const asset = assetId(files.scan);
  expect(job(asset)).toBe("queued||0");
  // Nothing exists until the worker reads it and a person approves it.
  expect(sql(`select count(*) from merch.products where workspace_id='${WS}' and code like 'SYN-${tag}-%'`)).toBe("0");

  // Duplicate upload of identical bytes: recognised, no second asset or job.
  await page.keyboard.press("Escape");
  await upload(page, files.scan);
  await expect(page.getByRole("dialog").getByText("This exact file is already in the library").first()).toBeVisible({ timeout: 30_000 });
  expect(sql(`select count(*) from ingest.source_assets where workspace_id='${WS}' and name='${files.scan}'`)).toBe("1");
  expect(sql(`select count(*) from ingest.ingestion_jobs where source_asset_id='${asset}' and job_type='ocr'`)).toBe("1");

  // The real worker reads the scan with Tesseract.
  const out = worker();
  expect(out).toContain('"msg":"job completed"');
  expect(job(asset)).toBe("succeeded||1");
  expect(sql(`select string_agg(page_no || ':' || outcome, ',' order by page_no) from ingest.ocr_page_results where job_id=(select id from ingest.ingestion_jobs where source_asset_id='${asset}' and job_type='ocr')`)).toBe("1:read,2:unreadable");
  const proposals = Number(sql(`select count(*) from ingest.review_items ri join ingest.ingestion_records r on r.id=ri.record_id where ri.source_asset_id='${asset}' and r.page_no=1 and ri.status='pending' and not (r.issues @> '[{"code":"needs_manual"}]')`));
  expect(proposals).toBeGreaterThanOrEqual(2);
  expect(sql(`select count(*) from ingest.review_items ri join ingest.ingestion_records r on r.id=ri.record_id where ri.source_asset_id='${asset}' and r.page_no=2 and r.issues @> '[{"code":"needs_manual"}]'`)).toBe("1");
  // Evidence stored privately for every page read, readable or not: page image + raw TSV.
  const jobId = sql(`select id from ingest.ingestion_jobs where source_asset_id='${asset}' and job_type='ocr'`);
  const { data: artefacts } = await admin.storage.from("ingest-artifacts").list(`${WS}/ocr/${jobId}`);
  expect((artefacts ?? []).map((f) => f.name).sort()).toEqual(["page-1.png", "page-1.tsv.txt", "page-2.png", "page-2.tsv.txt"]);

  // The drawer shows the job, the per-page outcome and confidence.
  await page.goto(`/sources/library?asset=${asset}`);
  const ocrJob = page.getByTestId("ocr-job");
  await expect(ocrJob.getByText("Succeeded")).toBeVisible();
  await expect(ocrJob.getByText("Read", { exact: true })).toBeVisible();
  await expect(ocrJob.getByText("Unreadable")).toBeVisible();

  // Review the first catalogue entry: its price proposal.
  const itemId = sql(`select ri.id from ingest.review_items ri join ingest.ingestion_records r on r.id=ri.record_id where ri.source_asset_id='${asset}' and r.page_no=1 and ri.item_type='price' order by r.row_no limit 1`);
  await page.goto(`/sources/review?status=pending&asset=${asset}&item=${itemId}`);
  await expect(page.getByText(/Read by OCR \(tesseract/)).toBeVisible();
  await expect(page.getByRole("img", { name: /as read by OCR/ })).toBeVisible();
  const proposedCode = await page.locator("#f-code").inputValue();
  expect(proposedCode).toMatch(/^SYN-/);
  await page.locator("#f-code").focus();
  await expect(page.getByTestId("ocr-region")).toBeVisible();
  await expect(page.getByText(/Source text for code/)).toBeVisible();

  // Edit: state exactly what the page says, whatever OCR made of it.
  await page.locator("#f-code").fill(CODE);
  await page.locator("#f-name").fill(`Synthetic grey matt ${tag}`);
  await page.locator("#f-amount").fill(codes[0].price);
  await page.locator("#f-currency").fill("MYR");
  const [brandName, unitLabel, listName] = sql(`select (select name from merch.brands where workspace_id='${WS}' order by name limit 1), (select label from merch.units_of_measure where workspace_id='${WS}' and code='sqm'), (select name from merch.price_lists where workspace_id='${WS}' order by name limit 1)`).split("|");
  await choose(page, "brand_id", brandName);
  await choose(page, "unit_id", unitLabel);
  await choose(page, "price_list_id", listName);
  await choose(page, "price_type", "Retail");
  await choose(page, "tax_basis", "Tax exclusive");
  await page.locator("#f-market").fill("MY");
  await page.locator("#f-min_quantity").fill("1");
  await page.locator("#f-valid_from").fill("2026-10-01");
  await page.locator("#review-note").fill("Checked against page 1 of the synthetic scan");
  const approve = page.getByRole("button", { name: /approve/i }).last();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Published. The price is a draft until it is published on the price list.")).toBeVisible();

  // Persisted with provenance; the reviewer's corrections are kept beside the OCR reading.
  const [state, amount, priceSource, pageRef, productSource, productCode, corrected] = sql(
    `select ri.status, vp.amount, vp.source_asset_id, coalesce(vp.source_page_or_row,''), p.source_asset_id, p.code,
            (select corrected_value->>'name' from ingest.review_decisions d where d.review_target_id=ri.id order by d.created_at desc limit 1)
     from ingest.review_items ri join merch.variant_prices vp on vp.id=ri.published_object_id
     join merch.product_variants v on v.id=vp.variant_id join merch.products p on p.id=v.product_id where ri.id='${itemId}'`,
  ).split("|");
  expect(state).toBe("corrected");
  expect(Number(amount)).toBe(Number(codes[0].price));
  expect(priceSource).toBe(asset);
  expect(productSource).toBe(asset);
  expect(pageRef).toMatch(/^page 1, line \d+$/);
  expect(productCode).toBe(CODE);
  expect(corrected).toBe(`Synthetic grey matt ${tag}`);
  expect(sql(`select ri.proposed->>'code' from ingest.review_items ri where ri.id='${itemId}'`)).toBe(proposedCode); // the OCR reading is kept as read

  // Reload: the decision and the corrected value are what the queue shows.
  await page.goto(`/sources/review?status=corrected&asset=${asset}&item=${itemId}`);
  await expect(page.locator("#f-code")).toHaveValue(CODE);
  await expect(page.getByText(/published this on/)).toBeVisible();

  // The second entry was never approved: still pending, still nowhere in the catalogue.
  expect(sql(`select count(*) from ingest.review_items ri join ingest.ingestion_records r on r.id=ri.record_id where ri.source_asset_id='${asset}' and r.page_no=1 and ri.status='pending'`)).not.toBe("0");
  expect(sql(`select count(*) from merch.products where workspace_id='${WS}' and code like 'SYN-${tag}-3060%'`)).toBe("0");

  // Admin finds the approved product in the catalogue.
  await page.goto(`/merchandise/catalog?view=all&q=${encodeURIComponent(CODE)}`); // the price is a draft until published on its list
  await expect(page.getByText(`Synthetic grey matt ${tag}`).first()).toBeVisible();
});

test("manual fallback: an unreadable page is entered by hand and approved through the same gate", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  const asset = assetId(files.scan);
  await page.goto(`/sources/library?asset=${asset}`);
  await page.locator("#manual-page").fill("2");
  await page.getByRole("button", { name: "Add manual row" }).click();
  await page.waitForURL(/\/sources\/review\?status=pending&item=/);
  await expect(page.getByText("Needs manual entry").first()).toBeVisible();
  await expect(page.getByText(/page 2/).first()).toBeVisible();
  await page.locator("#f-code").fill(MANUAL_CODE);
  await page.locator("#f-name").fill(`Synthetic hand-entered ${tag}`);
  const [brandName, categoryName, unitLabel] = sql(`select (select name from merch.brands where workspace_id='${WS}' order by name limit 1), (select label from merch.product_categories where workspace_id='${WS}' and is_active order by position, label limit 1), (select label from merch.units_of_measure where workspace_id='${WS}' and code='sqm')`).split("|");
  await choose(page, "brand_id", brandName);
  await choose(page, "category_id", categoryName);
  await choose(page, "unit_id", unitLabel);
  await page.getByRole("button", { name: /approve/i }).last().click();
  await expect(page.locator("#main").getByText("Published to the catalog.")).toBeVisible();
  expect(sql(`select p.source_asset_id || '|' || r.page_no from merch.products p join ingest.review_items ri on ri.published_object_id=p.id join ingest.ingestion_records r on r.id=ri.record_id where p.code='${MANUAL_CODE}'`)).toBe(`${asset}|2`);
  await page.reload();
  expect(sql(`select count(*) from merch.products where code='${MANUAL_CODE}'`)).toBe("1");
});

test("engine outage dead-letters to manual rows; retry reads it and supersedes the placeholders", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  await upload(page, files.photo);
  await expect(page.getByRole("dialog").getByText("Queued for OCR", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const asset = assetId(files.photo);
  // A worker host without Tesseract: every attempt fails the same way.
  const out = worker({ OCR_TESSERACT_BIN: "/nonexistent/tesseract" });
  expect(out).toContain("engine_unavailable");
  expect(job(asset)).toBe("dead_letter|engine_unavailable|1");
  expect(sql(`select count(*) from ingest.review_items ri where ri.source_asset_id='${asset}' and ri.status='pending'`)).toBe("1");

  await page.goto(`/sources/library?asset=${asset}`);
  const ocrJob = page.getByTestId("ocr-job");
  await expect(ocrJob.getByText("OCR engine missing")).toBeVisible();
  await ocrJob.getByRole("button", { name: "Retry OCR" }).click();
  await expect(ocrJob.getByText("Queued")).toBeVisible();
  expect(job(asset)).toBe("queued||1");

  worker();
  expect(job(asset)).toBe("succeeded||2");
  expect(sql(`select string_agg(ri.status, ',' order by ri.created_at) from ingest.review_items ri join ingest.ingestion_records r on r.id=ri.record_id where ri.source_asset_id='${asset}' and r.issues @> '[{"code":"needs_manual"}]'`)).toBe("rejected");
  expect(Number(sql(`select count(*) from ingest.review_items where source_asset_id='${asset}' and status='pending'`))).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(page.getByTestId("ocr-job").getByText("Succeeded")).toBeVisible();
});

test("encrypted and undecodable files fail safely to manual entry and are not retried", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  await upload(page, files.locked);
  await expect(page.getByRole("dialog").getByText(/password-protected/).first()).toBeVisible({ timeout: 30_000 });
  const locked = assetId(files.locked);
  expect(sql(`select count(*) from ingest.ingestion_jobs where source_asset_id='${locked}' and job_type='ocr'`)).toBe("0");
  // Asking OCR anyway: the worker reports it as encrypted, not a crash.
  await page.goto(`/sources/library?asset=${locked}`);
  await page.getByRole("button", { name: "Read every page with OCR" }).click();
  await expect(page.getByTestId("ocr-job").getByText("Queued")).toBeVisible();
  worker();
  expect(job(locked)).toBe("failed|encrypted|1");
  await page.reload();
  const lockedJob = page.getByTestId("ocr-job");
  await expect(lockedJob.getByText("Encrypted PDF")).toBeVisible();
  await expect(lockedJob.getByRole("button", { name: "Retry OCR" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await upload(page, files.broken);
  await expect(page.getByRole("dialog").getByText("Queued for OCR", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const broken = assetId(files.broken);
  worker();
  expect(job(broken)).toBe("failed|unsupported|1");
  expect(sql(`select count(*) from ingest.review_items where source_asset_id='${broken}' and status='pending'`)).toBe("1");
});

test("sales finds the approved product but cannot import, run OCR or open another workspace's source", async ({ page, browser }) => {
  await login(page, "demo.rep1@tileconcept.test");
  await page.goto(`/merchandise/catalog?view=all&q=${encodeURIComponent(CODE)}`); // the price is a draft until published on its list
  await expect(page.getByText(`Synthetic grey matt ${tag}`).first()).toBeVisible();
  await page.goto("/sources/library");
  await expect(page.getByRole("heading", { name: /^Not available/ }).first()).toBeVisible();
  // Sales may approve review rows but cannot see import staging (source.import).
  await page.goto(`/sources/review?asset=${assetId(files.scan)}`);
  await expect(page.getByText(`SYN-${tag}`)).toHaveCount(0);

  // An admin of this workspace cannot open another workspace's source by id.
  const ctx = await browser.newContext();
  const adminPage = await ctx.newPage();
  await login(adminPage, "demo.admin@tileconcept.test");
  await adminPage.goto(`/sources/library?asset=${otherAsset}`);
  await expect(adminPage.getByRole("heading", { name: "Source Library" }).first()).toBeVisible();
  await expect(adminPage.getByText(`Other ${tag}.pdf`)).toHaveCount(0);
  await expect(adminPage.getByTestId("ocr-job")).toHaveCount(0);
  await ctx.close();
});
