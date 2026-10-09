/** Local-only smoke check. Uses ephemeral fixtures; never prints credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const secretKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
assert(anonKey && secretKey, "Local API keys unavailable");
const admin = createClient(url, secretKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
const user = createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
const anonymous = createClient(url, anonKey, { auth: { persistSession: false } });
const workspace = "11111111-1111-1111-1111-111111111111";
const productId = randomUUID();
const mediaId = randomUUID();
const email = `catalog-media-${randomUUID()}@example.test`;
const password = randomUUID() + randomUUID();
let userId: string | undefined;
let objectPath: string | undefined;
function sql(query: string) { return execFileSync("docker", ["exec", "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error); userId = created.data.user?.id; assert(userId);
  const role = sql("select role_key from core.role_permissions where permission='catalog.write' and role_key not in ('admin','super_admin') limit 1");
  assert(/^[a-z_]+$/.test(role));
  sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${workspace}','${userId}','${role}')`);
  const signedIn = await user.auth.signInWithPassword({ email, password }); assert.ifError(signedIn.error);
  const product = await user.from("products").insert({ id: productId, workspace_id: workspace, name: "Synthetic catalogue upload smoke fixture" }); assert.ifError(product.error);
  objectPath = `${workspace}/products/${productId}/${userId}/${mediaId}.png`;
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64");
  const bucket = user.storage.from("product-media");
  const prepared = await bucket.createSignedUploadUrl(objectPath); assert.ifError(prepared.error); assert(prepared.data);
  const uploaded = await bucket.uploadToSignedUrl(objectPath, prepared.data.token, bytes, { contentType: "image/png", upsert: false }); assert.ifError(uploaded.error);
  const info = await bucket.info(objectPath); assert.ifError(info.error); assert.equal(Number(info.data?.size), bytes.length); assert.equal(info.data?.contentType, "image/png");
  const downloaded = await bucket.download(objectPath); assert.ifError(downloaded.error); assert(downloaded.data); assert.equal(Buffer.from(await downloaded.data.arrayBuffer()).equals(bytes), true);
  const attached = await user.from("product_media").insert({ id: mediaId, workspace_id: workspace, product_id: productId, storage_bucket: "product-media", storage_path: objectPath, kind: "image", review_state: "reviewed", usage_rights_state: "accepted", original_filename: "synthetic.png", mime_type: "image/png", size_bytes: bytes.length, uploaded_by: userId }); assert.ifError(attached.error);
  const primary = await user.rpc("set_primary_catalog_media", { p_media_id: mediaId, p_product_id: productId }); assert.ifError(primary.error);
  const persisted = await user.from("product_media").select("id,is_primary,original_filename").eq("id", mediaId).single(); assert.ifError(persisted.error); assert.equal(persisted.data?.is_primary, true);
  const overwrite = await bucket.upload(objectPath, Buffer.from("%PDF-overwrite"), { contentType: "application/pdf", upsert: true });
  assert(overwrite.error, "An attached original must not be overwritten");
  const unchanged = await bucket.download(objectPath); assert.ifError(unchanged.error); assert(unchanged.data); assert.equal(Buffer.from(await unchanged.data.arrayBuffer()).equals(bytes), true);
  const denied = await anonymous.storage.from("product-media").download(objectPath); assert(denied.error, "Anonymous object access must fail");
  const signed = await bucket.createSignedUrl(objectPath, 60); assert.ifError(signed.error); assert(signed.data);
  const response = await fetch(signed.data.signedUrl); assert.equal(response.ok, true); assert.equal(Buffer.from(await response.arrayBuffer()).equals(bytes), true);
  const archived = await user.from("product_media").update({ archived_at: new Date().toISOString(), is_primary: false }).eq("id", mediaId); assert.ifError(archived.error);
  const retained = await bucket.info(objectPath); assert.ifError(retained.error);
  console.log("PASS: real signed upload, file metadata/bytes, attachment persistence, primary image, anonymous denial, signed download and archive retention");
} finally {
  if (objectPath) { const result = await admin.storage.from("product-media").remove([objectPath]); assert.ifError(result.error); }
  const deleted = await admin.from("products").delete().eq("id", productId); assert.ifError(deleted.error);
  if (userId) { const result = await admin.auth.admin.deleteUser(userId); assert.ifError(result.error); }
}
