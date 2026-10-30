/**
 * TILE-24: a source original (supplier catalogue, price list) is opened only by
 * importers and catalogue operators of its workspace. Sales, showroom, sales
 * manager, marketing and stock users cannot sign, download or overwrite it by
 * its known path; a stock coordinator can still attach supplier evidence.
 * Against a running app and the LOCAL Supabase stack; synthetic fixtures;
 * refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "TileDemo!2026";
const WS = "11111111-1111-1111-1111-111111111111";
const tag = randomUUID().slice(0, 8);
const assetId = randomUUID();
const ORIGINAL = `${WS}/e2e-t24-${tag}/catalogue.pdf`;
const BYTES = Buffer.from(`%PDF-1.4\n% synthetic TILE-24 ${tag}\n%%EOF\n`);
const STOCK_EMAIL = `e2e-t24-stock-${tag}@tileconcept.test`;
const EVIDENCE = `e2e-t24-${tag}.png`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json", ...(process.env.E2E_SUPABASE_WORKDIR ? ["--workdir", process.env.E2E_SUPABASE_WORKDIR] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let stockUserId = "";

async function storedHash() {
  const { data, error } = await admin.storage.from("source-assets").download(ORIGINAL);
  assert.ifError(error);
  return sha(new Uint8Array(await data!.arrayBuffer()));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { error } = await admin.storage.from("source-assets").upload(ORIGINAL, BYTES, { contentType: "application/pdf" });
  assert.ifError(error);
  sql(`insert into ingest.source_assets(id,workspace_id,name,kind,storage_bucket,storage_path,mime_type,size_bytes)
       values ('${assetId}','${WS}','E2E original ${tag}.pdf','pdf','source-assets','${ORIGINAL}','application/pdf',${BYTES.length});`);
  const { data, error: userErr } = await admin.auth.admin.createUser({ email: STOCK_EMAIL, password: PASSWORD, email_confirm: true });
  assert.ifError(userErr);
  stockUserId = data.user!.id;
  sql(`insert into core.memberships(workspace_id,user_id,role_key,status) values ('${WS}','${stockUserId}','stock_coordinator','active');`);
});

test.afterAll(async () => {
  const evidence = sql(`select coalesce(string_agg(name, ','), '') from storage.objects where bucket_id='source-assets' and name like '${WS}/supplier-evidence/%${EVIDENCE}'`);
  await admin.storage.from("source-assets").remove([ORIGINAL, ...evidence.split(",").filter(Boolean)]);
  sql(`delete from ingest.source_assets where id='${assetId}';`);
  if (stockUserId) {
    sql(`delete from core.memberships where user_id='${stockUserId}';`);
    await admin.auth.admin.deleteUser(stockUserId);
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

// The drawer opens the signed link in a new tab; capture it instead.
async function openOriginal(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __opened: string | null }).__opened = null;
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string | null }).__opened = String(url);
      return null;
    }) as typeof window.open;
  });
  await page.getByRole("button", { name: "Original" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string | null }).__opened)).not.toBeNull();
  return (await page.evaluate(() => (window as unknown as { __opened: string | null }).__opened))!;
}

test("a catalogue operator opens the original from the Source Library, and again after reload", async ({ page }) => {
  await login(page, "demo.catalog@tileconcept.test");
  await page.goto(`/sources/library?asset=${assetId}`);
  await expect(page.getByRole("dialog").getByText(`E2E original ${tag}.pdf`).first()).toBeVisible();
  for (const pass of ["first", "after reload"]) {
    const url = await openOriginal(page);
    expect(url, pass).toContain("/storage/v1/object/sign/source-assets/");
    const res = await page.request.get(url);
    expect(res.status(), pass).toBe(200);
    expect(sha(await res.body()), pass).toBe(sha(BYTES));
    if (pass === "first") {
      await page.reload();
      await expect(page.getByRole("dialog").getByText(`E2E original ${tag}.pdf`).first()).toBeVisible();
    }
  }
});

test("sales, showroom, manager, marketing and stock cannot sign, download or overwrite the original by its known path", async ({ page }) => {
  // The screen is closed to sales.
  await login(page, "demo.rep1@tileconcept.test");
  await page.goto(`/sources/library?asset=${assetId}`);
  await expect(page.getByRole("heading", { name: /^Not available/ }).first()).toBeVisible();

  // And the storage API refuses a direct request with the known path.
  for (const email of ["demo.rep1@tileconcept.test", "demo.showroom@tileconcept.test", "demo.manager@tileconcept.test", "demo.marketing@tileconcept.test", STOCK_EMAIL]) {
    const c = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { db: { schema: "api" }, auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    assert.ifError(error);
    const s = c.storage.from("source-assets");
    expect((await s.createSignedUrl(ORIGINAL, 60)).error, `${email} sign`).not.toBeNull();
    expect((await s.download(ORIGINAL)).error, `${email} download`).not.toBeNull();
    expect((await s.upload(ORIGINAL, Buffer.from(`%PDF swapped by ${email}`), { upsert: true, contentType: "application/pdf" })).error, `${email} upsert`).not.toBeNull();
    expect((await s.update(ORIGINAL, Buffer.from(`%PDF updated by ${email}`), { contentType: "application/pdf" })).error, `${email} update`).not.toBeNull();
    const { data: rows } = await c.from("source_assets").select("id").eq("id", assetId);
    expect(rows ?? [], `${email} row`).toHaveLength(0);
  }
  expect(await storedHash()).toBe(sha(BYTES));
});

test("a stock coordinator still attaches supplier evidence from quick entry", async ({ page }) => {
  await login(page, STOCK_EMAIL);
  await page.goto("/merchandise/stock?tab=suppliers");
  const quick = page.locator("#quick-entry");
  await quick.locator('input[type="file"]').first().setInputFiles({ name: EVIDENCE, mimeType: "image/png", buffer: PNG });
  await expect(quick.getByText(EVIDENCE)).toBeVisible();
  await expect(page.getByText(/Evidence upload failed/)).toHaveCount(0);
  expect(sql(`select count(*) from storage.objects where bucket_id='source-assets' and name like '${WS}/supplier-evidence/%${EVIDENCE}'`)).toBe("1");
});
