/**
 * TILE-23: direct known-path access to catalogue media through the real
 * Storage API, for every role that matters, together with the row rules.
 * LOCAL stack only; synthetic fixtures, removed afterwards; prints no secrets.
 *
 *   pnpm exec tsx tests/integration/catalog-media-access.mts
 *   (E2E_DB_CONTAINER / E2E_SUPABASE_WORKDIR select an isolated stack)
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json", ...(process.env.E2E_SUPABASE_WORKDIR ? ["--workdir", process.env.E2E_SUPABASE_WORKDIR] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const url: string = status.API_URL;
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test refuses hosted targets");
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const secretKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
assert(anonKey && secretKey, "Local API keys unavailable");
const sql = (q: string) => execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const client = () => createClient(url, anonKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });
type Client = ReturnType<typeof client>;
const admin = createClient(url, secretKey, { db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false } });

const WS = "11111111-1111-1111-1111-111111111111";
const run = randomUUID().slice(0, 8);
const OTHER_WS = randomUUID();
const productId = randomUUID(), variantId = randomUUID(), sourceId = randomUUID(), assetId = randomUUID(), linkId = randomUUID();
const otherEmail = `tile23-other-${run}@example.test`;
const otherPassword = randomUUID() + randomUUID();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=", "base64");
const path = (name: string) => `${WS}/products/${productId}/tile23-${run}/${name}.png`;
const paths = { approved: path("approved"), unreviewed: path("unreviewed"), noRights: path("no-rights"), archived: path("archived"), imported: `${WS}/sources/tile23-${run}/images/imported.png` };
let otherUserId: string | undefined;

async function signIn(email: string, password: string) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return c;
}

/** Can this session read the exact object by path: sign + fetch, and download. */
async function reads(c: Client, objectPath: string) {
  const bucket = c.storage.from("product-media");
  const signed = await bucket.createSignedUrl(objectPath, 60);
  const download = await bucket.download(objectPath);
  let fetched = false;
  if (signed.data?.signedUrl) {
    const res = await fetch(signed.data.signedUrl);
    fetched = res.ok && Buffer.from(await res.arrayBuffer()).equals(PNG);
  }
  const downloaded = !download.error && !!download.data && Buffer.from(await download.data.arrayBuffer()).equals(PNG);
  assert.equal(fetched, downloaded, `sign and download disagree for ${objectPath}`);
  return downloaded;
}

const results: string[] = [];
async function expectAccess(who: string, c: Client, name: keyof typeof paths, allowed: boolean) {
  const actual = await reads(c, paths[name]);
  assert.equal(actual, allowed, `${who} ${allowed ? "should" : "must not"} read ${name}`);
  results.push(`${who.padEnd(22)} ${name.padEnd(11)} ${actual ? "READ" : "denied"}`);
}

try {
  for (const p of Object.values(paths)) assert.ifError((await admin.storage.from("product-media").upload(p, PNG, { contentType: "image/png" })).error);
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WS}','TILE-23 other workspace','tile23-${run}');
    insert into merch.products(id,workspace_id,name,status) values ('${productId}','${WS}','TILE-23 access fixture ${run}','active');
    insert into merch.product_variants(id,workspace_id,product_id,sku) values ('${variantId}','${WS}','${productId}','T23-${run}');
    insert into merch.product_media(workspace_id,product_id,storage_path,kind,review_state,usage_rights_state,archived_at) values
      ('${WS}','${productId}','${paths.approved}','image','reviewed','accepted',null),
      ('${WS}','${productId}','${paths.unreviewed}','image','unreviewed','unreviewed',null),
      ('${WS}','${productId}','${paths.noRights}','image','unreviewed','restricted',null),
      ('${WS}','${productId}','${paths.archived}','image','reviewed','accepted',now());
    insert into ingest.source_assets(id,workspace_id,name,kind) values ('${sourceId}','${WS}','TILE-23 synthetic source ${run}','pdf');
    insert into ingest.media_assets(id,workspace_id,source_asset_id,external_key,asset_kind,storage_bucket,object_path,content_checksum,mime_type)
      values ('${assetId}','${WS}','${sourceId}','tile23:${run}','standalone_image','product-media','${paths.imported}',repeat('c',64),'image/png');
    insert into ingest.media_asset_variant_links(id,workspace_id,media_asset_id,external_key,product_variant_id,link_basis)
      values ('${linkId}','${WS}','${assetId}','tile23:link:${run}','${variantId}','exact_supplier_code');`);
  const created = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
  assert.ifError(created.error); otherUserId = created.data.user!.id;
  sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${OTHER_WS}','${otherUserId}','catalog_pricing')`);

  const sales = await signIn("demo.rep1@tileconcept.test", "TileDemo!2026");
  const catalog = await signIn("demo.catalog@tileconcept.test", "TileDemo!2026");
  const adminUser = await signIn("demo.admin@tileconcept.test", "TileDemo!2026");
  const other = await signIn(otherEmail, otherPassword);
  const anonymous = client();

  for (const [name, salesAllowed] of [["approved", true], ["unreviewed", false], ["noRights", false], ["archived", false], ["imported", false]] as const) {
    await expectAccess("sales (rep1)", sales, name, salesAllowed);
    await expectAccess("catalog operator", catalog, name, true);
    await expectAccess("admin", adminUser, name, true);
    await expectAccess("other-workspace operator", other, name, false);
    await expectAccess("anonymous", anonymous, name, false);
  }
  // Row rules agree with storage: sales sees only the approved row.
  const salesRows = await sales.from("product_media").select("storage_path").eq("product_id", productId);
  assert.ifError(salesRows.error); assert.deepEqual(salesRows.data!.map(r => r.storage_path), [paths.approved]);
  const queue = await sales.from("media_review_queue").select("link_id").eq("link_id", linkId);
  assert.equal(queue.data?.length ?? 0, 0, "sales must not see the review queue");

  // Through the review API: sales is refused; the operator confirms, records rights, reviews, publishes.
  const denied = await sales.rpc("review_media_rights", { p_media_asset_id: assetId, p_rights_state: "accepted", p_reason: "x" });
  assert.equal(denied.error?.code, "42501");
  const premature = await catalog.rpc("publish_product_media", { p_link_id: linkId, p_is_primary: true });
  assert.equal(premature.error?.code, "23514", "publishing before review must be refused");
  assert.ifError((await catalog.rpc("confirm_media_association", { p_link_id: linkId, p_variant_id: variantId, p_note: "Synthetic check" })).error);
  assert.ifError((await catalog.rpc("review_media_rights", { p_media_asset_id: assetId, p_rights_state: "accepted", p_reason: "Synthetic licence" })).error);
  assert.ifError((await catalog.rpc("review_media_asset", { p_media_asset_id: assetId, p_decision: "approved" })).error);
  const published = await catalog.rpc("publish_product_media", { p_link_id: linkId, p_alt_text: "Synthetic", p_is_primary: true });
  assert.ifError(published.error);
  await expectAccess("sales after publish", sales, "imported", true);
  await expectAccess("other-ws after publish", other, "imported", false);
  const withdrawn = await catalog.rpc("review_media_rights", { p_media_asset_id: assetId, p_rights_state: "denied", p_reason: "Synthetic withdrawal" });
  assert.ifError(withdrawn.error); assert.equal(withdrawn.data, 1);
  await expectAccess("sales after withdrawal", sales, "imported", false);
  await expectAccess("operator after withdrawal", catalog, "imported", true);
  const persisted = sql(`select archived_at is not null, usage_rights_state, (select count(*) from ingest.review_decisions where review_target_id in ('${assetId}','${linkId}')), (select count(*) from audit.audit_events where object_id in ('${assetId}','${linkId}','${published.data}')) from merch.product_media where id='${published.data}'`);
  const [archived, rights, decisions, audits] = persisted.split("|");
  assert.equal(archived, "t"); assert.equal(rights, "denied"); assert(Number(decisions) >= 4, "decisions persisted"); assert(Number(audits) >= 4, "audit events persisted");
  console.log(results.join("\n"));
  console.log(`PASS: direct sign+download matrix (${results.length} checks) for sales, catalogue operator, admin, other workspace and anonymous; row rules agree; review API publish/withdraw changes object access; ${decisions} decisions and ${audits} audit events persisted`);
} finally {
  await admin.storage.from("product-media").remove(Object.values(paths));
  // Evidence first: an approved link may not lose its variant. Append-only
  // review decisions for these synthetic ids stay in the local database.
  sql(`delete from ingest.source_assets where id='${sourceId}'; delete from merch.products where id='${productId}'; delete from core.workspaces where id='${OTHER_WS}';`);
  if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
}
