/**
 * Sales-owned customer cards against a running app and the LOCAL Supabase
 * stack: the PIC creates and edits, a teammate sees the card read-only in the
 * UI and is refused on direct requests, a sales manager transfers the PIC with
 * an audited reason, and other workspaces stay invisible. Synthetic fixtures
 * only; refuses hosted targets. Sessions opened here are never signed out
 * globally, so other suites' logins are untouched.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const REP1 = { id: "aaaaaaaa-0000-0000-0000-000000000003", email: "demo.rep1@tileconcept.test", name: "Aiman Sales" };
const REP2 = { id: "aaaaaaaa-0000-0000-0000-000000000004", email: "demo.rep2@tileconcept.test", name: "Mei Ling Sales" };
const MANAGER = { id: "aaaaaaaa-0000-0000-0000-000000000002", email: "demo.manager@tileconcept.test" };
const MARKETING = { email: "demo.marketing@tileconcept.test" };
const REFUSAL = "You can only create or edit customer cards assigned to your own account.";

const tag = randomUUID().slice(0, 8);
const ownedId = randomUUID();
const foreignId = randomUUID();
const OWNED = `E2E PIC card ${tag}`;
const CREATED = `E2E created card ${tag}`;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");

/** A direct API client signed in as a member, like any browser could be. */
async function memberClient(email: string) {
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "api" } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E other workspace','e2e-${OTHER_WORKSPACE.slice(0, 8)}');
       insert into identity.contacts(id,workspace_id,display_name,owner_id,created_by) values
         ('${ownedId}','${WORKSPACE}','${OWNED}','${REP1.id}','${REP1.id}'),
         ('${foreignId}','${OTHER_WORKSPACE}','E2E foreign card ${tag}','${REP1.id}',null);`);
});

test.afterAll(() => {
  sql(`delete from identity.contacts where display_name like 'E2E % ${tag}%' or id in ('${ownedId}','${foreignId}');
       delete from core.workspaces where id='${OTHER_WORKSPACE}';`);
});

test("the PIC creates a card under their own account and edits it; edits survive reload", async ({ page }) => {
  await login(page, REP1.email);
  await page.goto("/sales/accounts?new=contact");
  await page.getByLabel("Full name").fill(CREATED);
  await page.getByRole("button", { name: "Create contact" }).click();
  await page.waitForURL(/\/sales\/contacts\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: CREATED })).toBeVisible();
  await expect(page.getByText(`PIC ${REP1.name}`).first()).toBeVisible();
  expect(sql(`select owner_id||'|'||created_by||'|'||owner_assigned_by from identity.contacts where display_name='${CREATED}'`)).toBe(`${REP1.id}|${REP1.id}|${REP1.id}`);

  await page.goto(`/sales/contacts/${ownedId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Display name").fill(`${OWNED} edited`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Contact updated.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: `${OWNED} edited` })).toBeVisible();
  expect(sql(`select display_name||'|'||updated_by from identity.contacts where id='${ownedId}'`)).toBe(`${OWNED} edited|${REP1.id}`);
});

test("a forged PIC on create fails as a whole, from a tampered form and from the API", async ({ page }) => {
  // The browser path: a hand-added owner_id travels through the server action.
  await login(page, REP1.email);
  await page.goto("/sales/accounts?new=contact");
  await page.getByLabel("Full name").fill(`E2E forged form ${tag}`);
  await page.getByLabel("Full name").evaluate((input, owner) => {
    const forged = document.createElement("input");
    Object.assign(forged, { type: "hidden", name: "owner_id", value: owner });
    input.closest("form")!.append(forged);
  }, REP2.id);
  await page.getByRole("button", { name: "Create contact" }).click();
  await expect(page.getByText(REFUSAL)).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/accounts/);

  const rep1 = await memberClient(REP1.email);
  const forged = await rep1.rpc("create_contact", { p_display_name: `E2E forged ${tag}`, p_phone: "0129100299", p_owner_id: REP2.id });
  expect(forged.error?.message).toBe(REFUSAL);
  const direct = await rep1.from("contacts").insert({ workspace_id: WORKSPACE, display_name: `E2E forged direct ${tag}`, owner_id: REP2.id });
  expect(direct.error?.message).toBe(REFUSAL);
  expect(sql(`select count(*) from identity.contacts where display_name like 'E2E forged%${tag}'`)).toBe("0");
  expect(sql(`select count(*) from identity.contact_points where normalized_value='+60129100299'`)).toBe("0");
});

test("a teammate sees the card read-only, and direct requests are refused without changing it", async ({ page }) => {
  await login(page, REP2.email);
  await page.goto(`/sales/contacts/${ownedId}`);
  await expect(page.getByRole("heading", { name: `${OWNED} edited` })).toBeVisible();
  for (const label of ["Edit", "Add phone/email", "Link account"]) await expect(page.getByRole("button", { name: label })).toBeDisabled();
  await page.getByRole("button", { name: "Edit", exact: true }).locator("..").focus();
  await expect(page.getByRole("tooltip")).toContainText(`Only ${REP1.name}, the PIC of this card, can edit it.`);
  // Shared work on the customer stays open to the team.
  await expect(page.getByRole("button", { name: "Log activity" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Transfer PIC" })).toBeDisabled();

  const rep2 = await memberClient(REP2.email);
  const seen = await rep2.from("contacts").select("id, owner_id").eq("id", ownedId);
  expect(seen.data).toEqual([{ id: ownedId, owner_id: REP1.id }]);
  const edit = await rep2.from("contacts").update({ display_name: "Hijacked" }).eq("id", ownedId);
  expect(edit.error?.message).toBe(REFUSAL);
  const take = await rep2.from("contacts").update({ owner_id: REP2.id }).eq("id", ownedId);
  expect(take.error?.message).toBe(REFUSAL);
  const archive = await rep2.from("contacts").update({ archived_at: new Date().toISOString() }).eq("id", ownedId);
  expect(archive.error?.message).toBe(REFUSAL);
  const point = await rep2.from("contact_points").insert({ workspace_id: WORKSPACE, contact_id: ownedId, kind: "phone", raw_value: "0129100298", normalized_value: "+60129100298" });
  expect(point.error?.message).toBe(REFUSAL);
  const transfer = await rep2.rpc("transfer_customer_card", { p_card: "contact", p_id: ownedId, p_owner_id: REP2.id, p_reason: "Taking it" });
  expect(transfer.error?.message).toMatch(/sales\.assign/);
  expect(sql(`select display_name||'|'||owner_id||'|'||(archived_at is null)||'|'||(select count(*) from identity.contact_points where contact_id='${ownedId}') from identity.contacts where id='${ownedId}'`))
    .toBe(`${OWNED} edited|${REP1.id}|true|0`);

  const marketing = await memberClient(MARKETING.email);
  expect((await marketing.from("contacts").select("id").eq("id", ownedId)).data).toHaveLength(1);
  expect((await marketing.from("contacts").update({ display_name: "Marketing edit" }).eq("id", ownedId).select("id")).data).toEqual([]);
});

test("a sales manager transfers the PIC with an audited reason; the new PIC can edit after reload", async ({ page, browser }) => {
  await login(page, MANAGER.email);
  await page.goto(`/sales/contacts/${ownedId}`);
  // No override for managers: the card is not theirs to edit.
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Transfer PIC" }).click();
  const dialog = page.getByRole("dialog", { name: "Transfer PIC" });
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: REP2.name }).click();
  await dialog.getByLabel("Reason").fill(`E2E territory handover ${tag}`);
  await dialog.getByRole("button", { name: "Transfer" }).click();
  await expect(page.getByText("PIC transferred.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(`PIC ${REP2.name}`).first()).toBeVisible();
  expect(sql(`select actor_id||'|'||(before_data->>'owner_id')||'|'||(after_data->>'owner_id')||'|'||reason||'|'||(occurred_at is not null) from audit.audit_events
              where action='customer_card.pic_transferred' and object_id='${ownedId}'`)).toBe(`${MANAGER.id}|${REP1.id}|${REP2.id}|E2E territory handover ${tag}|true`);

  const context = await browser.newContext();
  const rep2Page = await context.newPage();
  await login(rep2Page, REP2.email);
  await rep2Page.goto(`/sales/contacts/${ownedId}`);
  await rep2Page.getByRole("button", { name: "Edit", exact: true }).click();
  await rep2Page.getByLabel("Display name").fill(`${OWNED} by new PIC`);
  await rep2Page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rep2Page.getByText("Contact updated.")).toBeVisible();
  await rep2Page.reload();
  await expect(rep2Page.getByRole("heading", { name: `${OWNED} by new PIC` })).toBeVisible();
  await context.close();

  const rep1 = await memberClient(REP1.email);
  expect((await rep1.from("contacts").update({ notes: "Too late" }).eq("id", ownedId)).error?.message).toBe(REFUSAL);
});

test("another workspace's card stays invisible", async ({ page }) => {
  const rep1 = await memberClient(REP1.email);
  expect((await rep1.from("contacts").select("id").eq("id", foreignId)).data).toEqual([]);
  expect((await rep1.from("contacts").update({ display_name: "Foreign edit" }).eq("id", foreignId).select("id")).data).toEqual([]);
  await login(page, REP1.email);
  // The layout streams first, so notFound() renders the 404 page under a 200.
  await page.goto(`/sales/contacts/${foreignId}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText(`E2E foreign card ${tag}`)).toHaveCount(0);
  expect(sql(`select display_name from identity.contacts where id='${foreignId}'`)).toBe(`E2E foreign card ${tag}`);
});
