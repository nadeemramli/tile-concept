/**
 * Catalogue media journey against a running app and the LOCAL Supabase stack.
 * Synthetic fixtures only; refuses hosted targets. Needs ffmpeg for real media.
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
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const productId = randomUUID();
const otherProductId = randomUUID();
const variantId = randomUUID();
const hiddenMediaId = randomUUID();
const PRODUCT = `E2E media fixture ${productId.slice(0, 8)}`;
const SKU = `E2E-SKU-${productId.slice(0, 6)}`;
const MiB = 1024 * 1024;

function sql(query: string) {
  return execFileSync("docker", ["exec", "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });

const dir = mkdtempSync(join(tmpdir(), "tile-media-e2e-"));
function ffmpeg(out: string, ...args: string[]) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args, join(dir, out)]);
  return readFileSync(join(dir, out));
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const files = {
  jpg: { name: "e2e-tile.jpg", mimeType: "image/jpeg", buffer: ffmpeg("a.jpg", "-f", "lavfi", "-i", "testsrc=size=320x240", "-frames:v", "1") },
  png: { name: "e2e-tile.png", mimeType: "image/png", buffer: ffmpeg("a.png", "-f", "lavfi", "-i", "testsrc=size=320x240", "-frames:v", "1") },
  webp: { name: "e2e-tile.webp", mimeType: "image/webp", buffer: ffmpeg("a.webp", "-f", "lavfi", "-i", "testsrc=size=320x240", "-frames:v", "1") },
  pdf: { name: "e2e-spec.pdf", mimeType: "application/pdf", buffer: PDF },
  mp4: { name: "e2e-clip.mp4", mimeType: "video/mp4", buffer: ffmpeg("a.mp4", "-f", "lavfi", "-i", "testsrc=size=160x120:duration=1", "-pix_fmt", "yuv420p") },
  webm: { name: "e2e-clip.webm", mimeType: "video/webm", buffer: ffmpeg("a.webm", "-f", "lavfi", "-i", "testsrc=size=160x120:duration=1") },
};
// Exactly the 20 MiB limit: a real JPEG padded after its end-of-image marker.
const maxJpeg = { name: "e2e-max.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([files.jpg.buffer, Buffer.alloc(20 * MiB - files.jpg.buffer.length)]) };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E other workspace','e2e-${OTHER_WORKSPACE.slice(0, 8)}');
       insert into merch.products(id,workspace_id,name) values ('${productId}','${WORKSPACE}','${PRODUCT}'),('${otherProductId}','${OTHER_WORKSPACE}','E2E other-workspace product');
       insert into merch.product_variants(id,workspace_id,product_id,sku) values ('${variantId}','${WORKSPACE}','${productId}','${SKU}');
       insert into merch.product_media(id,workspace_id,product_id,storage_path,kind,caption) values ('${hiddenMediaId}','${WORKSPACE}','${productId}','${WORKSPACE}/e2e/unreviewed.jpg','image','E2E unreviewed import');`);
});

test.afterAll(async () => {
  const prefix = `${WORKSPACE}/products/${productId}`;
  const { data: users } = await admin.storage.from("product-media").list(prefix);
  for (const user of users ?? []) {
    const { data: objects } = await admin.storage.from("product-media").list(`${prefix}/${user.name}`);
    if (objects?.length) await admin.storage.from("product-media").remove(objects.map(object => `${prefix}/${user.name}/${object.name}`));
  }
  sql(`delete from merch.products where id in ('${productId}','${otherProductId}'); delete from core.workspaces where id='${OTHER_WORKSPACE}';`);
  rmSync(dir, { recursive: true, force: true });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
async function openMedia(page: Page) {
  await page.goto(`/merchandise/catalog/${productId}`);
  await page.getByRole("tab", { name: /^Media/ }).click();
}
const card = (page: Page, text: string | RegExp): Locator => page.locator("li").filter({ hasText: text });
async function imageLoaded(img: Locator) {
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

test("catalogue operator uploads every supported type, edits, sets primary, replaces and archives", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "demo.catalog@tileconcept.test");
  await openMedia(page);
  await expect(page.getByRole("tab", { name: "Media (1)" })).toBeVisible(); // the unreviewed import

  // Failure paths: oversize file refused before upload; disguised HTML refused by the server.
  await page.getByLabel("Upload media").setInputFiles({ name: "too-big.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(20 * MiB + 1, 0xff) });
  await expect(page.getByText("Use JPEG, PNG, WebP, PDF, MP4 or WebM, up to 20 MB per file.")).toBeVisible();
  await page.getByLabel("Upload media").setInputFiles({ name: "disguised.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  const upload = page.locator("button").filter({ hasText: /^(Upload media|Retry upload)$/ });
  await expect(upload).toBeDisabled(); // rights not yet confirmed
  await page.getByRole("checkbox", { name: /these files show this product/ }).check();
  await upload.click();
  await expect(page.getByText(/disguised\.jpg · File contents do not match/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Retry upload" })).toBeEnabled();
  await card(page, "disguised.jpg").getByRole("button", { name: "Remove" }).click();

  // All six types plus a file at exactly the 20 MiB limit.
  await page.getByLabel("Upload media").setInputFiles([files.jpg, files.png, files.webp, files.pdf, files.mp4, files.webm, maxJpeg]);
  await page.locator("button").filter({ hasText: /^Upload media$/ }).click();
  for (const f of [...Object.values(files), maxJpeg]) await expect(page.getByText(`${f.name} · Attached`)).toBeVisible({ timeout: 90_000 });

  // Variant attachment.
  await page.getByRole("button", { name: "Upload more media" }).click();
  await page.getByLabel("Attach to").click();
  await page.getByRole("option", { name: SKU }).click();
  await page.getByLabel("Upload media").setInputFiles({ ...files.png, name: "e2e-variant.png" });
  await page.getByRole("checkbox", { name: /these files show this product/ }).check();
  await page.locator("button").filter({ hasText: /^Upload media$/ }).click();
  await expect(page.getByText("e2e-variant.png · Attached")).toBeVisible({ timeout: 30_000 });

  // Persistence after reload: 8 uploads + the unreviewed import operators can still see.
  await openMedia(page);
  await expect(page.getByRole("tab", { name: "Media (9)" })).toBeVisible();
  await expect(card(page, "e2e-variant.png")).toContainText(SKU);
  await imageLoaded(card(page, "e2e-tile.png").getByRole("img"));
  await expect(card(page, "e2e-clip.mp4").locator("video")).toHaveAttribute("src", /token=/);
  await expect(card(page, "e2e-spec.pdf").getByRole("link", { name: "Open PDF" })).toHaveAttribute("href", /token=/);
  const pdfHref = await card(page, "e2e-spec.pdf").getByRole("link", { name: "Open PDF" }).getAttribute("href");
  expect((await page.request.get(pdfHref!)).status()).toBe(200);

  // Caption / alt / source editing survives reload.
  await card(page, "e2e-tile.png").getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Caption").fill("E2E hero face");
  await page.getByLabel("Alt text").fill("E2E hero tile alt");
  await page.getByLabel("Source reference").fill("E2E supplier sheet p.3");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Media details saved")).toBeVisible();
  await openMedia(page);
  await expect(card(page, "E2E hero face")).toContainText("Source: E2E supplier sheet p.3");

  // Primary image, visible in the catalogue list after reload.
  await card(page, "E2E hero face").getByRole("button", { name: "Set primary" }).click();
  await expect(page.getByText("Primary image updated")).toBeVisible();
  await openMedia(page);
  await expect(card(page, "E2E hero face")).toContainText("Primary image");
  await expect(card(page, "E2E unreviewed import").getByRole("button", { name: "Set primary" })).toHaveCount(0);
  await page.goto(`/merchandise/catalog?view=all&q=${encodeURIComponent(PRODUCT)}`);
  await imageLoaded(page.getByRole("img", { name: "E2E hero tile alt" }).first());

  // Replace the primary: new file inherits caption/primary, old one is archived.
  await openMedia(page);
  await card(page, "E2E hero face").getByRole("button", { name: "Replace" }).click();
  await page.getByLabel("Replacement file").setInputFiles({ ...files.webp, name: "e2e-replacement.webp" });
  await expect(page.getByRole("button", { name: "Replace file" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /this file shows this product/ }).check();
  await page.getByRole("button", { name: "Replace file" }).click();
  await expect(page.getByText("Media replaced; previous file archived")).toBeVisible({ timeout: 30_000 });
  await openMedia(page);
  await expect(page.getByRole("tab", { name: "Media (9)" })).toBeVisible();
  await expect(card(page, "E2E hero face")).toHaveCount(1);
  await expect(card(page, "E2E hero face")).toContainText("Primary image");
  await expect(card(page, "E2E hero face").getByRole("img")).toHaveAttribute("src", /\.webp/);

  // Archive survives reload; original retained in storage.
  await card(page, "e2e-spec.pdf").getByRole("button", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.getByText("Media archived; original and audit retained")).toBeVisible();
  await openMedia(page);
  await expect(page.getByRole("tab", { name: "Media (8)" })).toBeVisible();
  await expect(card(page, "e2e-spec.pdf")).toHaveCount(0);
  expect(Number(sql(`select count(*) from merch.product_media where product_id='${productId}' and archived_at is not null`))).toBe(2);
  expect(Number(sql(`select count(*) from merch.product_media where product_id='${productId}' and checksum ~ '^[0-9a-f]{64}$' and uploaded_by is not null`))).toBe(9);
});

test("sales sees approved media read-only; cross-workspace product is not found", async ({ page }) => {
  await login(page, "demo.rep1@tileconcept.test");
  await openMedia(page);
  await expect(page.getByRole("tab", { name: "Media (7)" })).toBeVisible();
  await expect(card(page, "E2E unreviewed import")).toHaveCount(0);
  await expect(page.getByLabel("Upload media")).toHaveCount(0);
  await expect(page.getByRole("tabpanel").getByRole("button", { name: /Replace|Archive|Set primary|Edit details/ })).toHaveCount(0);
  await imageLoaded(card(page, "E2E hero face").getByRole("img"));
  await page.goto(`/merchandise/catalog/${otherProductId}`);
  await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible();
  await expect(page.getByText("E2E other-workspace product")).toHaveCount(0);
});
