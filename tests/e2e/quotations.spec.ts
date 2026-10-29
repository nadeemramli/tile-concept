/**
 * TILE-5 quotation journeys against a running app and the LOCAL Supabase stack.
 *
 * The suite owns everything it touches: a fresh workspace, its own synthetic
 * users (never the shared demo logins, so no other suite's session is affected)
 * and synthetic inquiries and visits. It refuses hosted targets. Nothing here
 * sends a customer message: "sent" is recorded by staff, the app sends nothing.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = `E2e!${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const WS = randomUUID();
const OTHER_WS = randomUUID();
const ids = { contact: randomUUID(), lead: randomUUID(), visitMatched: randomUUID(), visitHistoric: randomUUID() };
const SQ = `SQ-E2E-${tag}`;
const HISTORIC_SQ = `SQ-OLD-${tag}`;
const emails = { rep: `quote-rep-${tag}@e2e.test`, reader: `quote-reader-${tag}@e2e.test`, foreign: `quote-foreign-${tag}@e2e.test` };
const users: Record<keyof typeof emails, string> = { rep: "", reader: "", foreign: "" };

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
const PUBLIC_KEY: string = status.ANON_KEY ?? status.PUBLISHABLE_KEY;

/** A datetime-local value in showroom time. */
const kl = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16);
const mondayKl = (() => { const local = new Date(Date.now() + 8 * 3600_000); const dow = (local.getUTCDay() + 6) % 7; return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow) - 8 * 3600_000); })();
const lastFriday = new Date(mondayKl.getTime() - 3 * 86400_000 + 15 * 3600_000);
const lastThursday = new Date(lastFriday.getTime() - 86400_000);
const sentThisWeek = new Date(Math.max(mondayKl.getTime() + 60_000, Date.now() - 10 * 60_000));
const revisedThisWeek = new Date(sentThisWeek.getTime() + 60_000);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const key of Object.keys(emails) as (keyof typeof emails)[]) {
    const { data, error } = await admin.auth.admin.createUser({ email: emails[key], password: PASSWORD, email_confirm: true, user_metadata: { full_name: `E2E ${key} ${tag}` } });
    if (error || !data.user) throw error ?? new Error("user not created");
    users[key] = data.user.id;
  }
  sql(`insert into core.workspaces(id, slug, name) values ('${WS}', 'e2e-q-${tag}', 'E2E quotations ${tag}'), ('${OTHER_WS}', 'e2e-qo-${tag}', 'E2E other ${tag}');
    insert into core.opportunity_stages(workspace_id, key, label, position, reporting_group, requires_reason, requires_next_action, is_active)
      select '${WS}', key, label, position, reporting_group, requires_reason, requires_next_action, is_active from core.opportunity_stages where workspace_id = '11111111-1111-1111-1111-111111111111';
    insert into core.memberships(workspace_id, user_id, role_key) values ('${WS}', '${users.rep}', 'sales_rep'), ('${WS}', '${users.reader}', 'marketing_coordinator'), ('${OTHER_WS}', '${users.foreign}', 'sales_rep');
    insert into identity.contacts(id, workspace_id, display_name) values ('${ids.contact}', '${WS}', 'E2E quote customer ${tag}');
    insert into sales.leads(id, workspace_id, source_channel, raw_name, owner_id, contact_id, interest) values ('${ids.lead}', '${WS}', 'tiktok', 'E2E digital inquiry ${tag}', '${users.rep}', '${ids.contact}', 'Synthetic kitchen tiles');
    insert into sales.visits(id, workspace_id, purpose, lead_id, contact_id, quotation_ref, quotation_amount, occurred_at, staff_user_id) values
      ('${ids.visitMatched}', '${WS}', 'consultation', '${ids.lead}', '${ids.contact}', '${SQ.toLowerCase().replace(/-/g, " ")}', 1500, now() - interval '2 days', '${users.rep}'),
      ('${ids.visitHistoric}', '${WS}', 'consultation', null, null, '${HISTORIC_SQ}', 800, now() - interval '60 days', '${users.rep}');`);
});

test.afterAll(async () => {
  const { data: objects } = await admin.storage.from("visit-quotations").list(`${WS}/${ids.visitMatched}`);
  if (objects?.length) await admin.storage.from("visit-quotations").remove(objects.map((o) => `${WS}/${ids.visitMatched}/${o.name}`));
  // Deleting the workspace must cascade through the append-only quote history.
  sql(`delete from audit.audit_events where workspace_id in ('${WS}', '${OTHER_WS}'); delete from core.workspaces where id in ('${WS}', '${OTHER_WS}');`);
  for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}
const panel = (page: Page) => page.getByTestId("quote-panel");
const quoteCard = (page: Page, name: string) => panel(page).getByRole("listitem", { name: `Quote ${name}` });
const quoteId = () => sql(`select id from sales.quotes where workspace_id = '${WS}' and quote_number = 'QT-E2E-${tag}'`);
const sendKinds = () => sql(`select string_agg(version_no || ':' || send_kind, ',' order by sent_at) from api.quote_send_facts where quote_id = '${quoteId()}'`);

test("inbox: prepare, issue last week, send this week, survive a dropped connection and a repeat, revise", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, emails.rep);
  await page.goto(`/sales/inbox?lead=${ids.lead}`);
  await expect(panel(page)).toContainText("No quotations recorded for this pursuit yet.");

  await panel(page).getByRole("button", { name: "Record quote" }).click();
  const dialog = page.getByRole("dialog", { name: "Record quote" });
  await dialog.getByLabel("Quote number", { exact: true }).fill(`QT-E2E-${tag}`);
  await dialog.getByLabel("SQL Account SQ number", { exact: true }).fill(SQ);
  await dialog.getByLabel("Total amount", { exact: true }).fill("1500");
  await dialog.getByLabel("Prepared", { exact: true }).fill(kl(lastThursday));
  await dialog.getByLabel("What has happened", { exact: true }).selectOption("issued");
  await dialog.getByLabel("Issued", { exact: true }).fill(kl(lastFriday));
  await dialog.getByRole("button", { name: "Save and issue" }).click();
  await expect(page.getByText("Quote recorded.")).toBeVisible();
  await expect(quoteCard(page, `QT-E2E-${tag}`)).toContainText("Issued");
  expect(sql(`select count(*) from sales.opportunities where workspace_id = '${WS}'`)).toBe("0");
  expect(sendKinds()).toBe("");

  // The first send attempt reaches the server but the response is lost.
  let dropped = false;
  await page.route("**/sales/inbox**", async (route) => {
    const req = route.request();
    if (!dropped && req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes('"action":"send"')) {
      dropped = true;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  await quoteCard(page, `QT-E2E-${tag}`).getByRole("button", { name: "Mark sent" }).click();
  const send = page.getByRole("dialog", { name: /Record a send/ });
  await send.getByLabel("Sent", { exact: true }).fill(kl(sentThisWeek));
  await send.getByLabel("Channel", { exact: true }).selectOption("whatsapp");
  await send.getByRole("button", { name: "Record send" }).click();
  await expect(send.getByRole("alert")).toContainText("Retry: the same request is never recorded twice.");
  expect(dropped).toBe(true);
  expect(sendKinds()).toBe("1:first_quote"); // the server did record it
  await send.getByRole("button", { name: "Retry: record send" }).click();
  await expect(page.getByText("Send recorded.")).toBeVisible();
  expect(sendKinds()).toBe("1:first_quote"); // the retry replayed, it did not add a second send
  await page.unroute("**/sales/inbox**");

  // A fresh mark-sent of the same send (new form, new request) is recognised.
  await quoteCard(page, `QT-E2E-${tag}`).getByRole("button", { name: "Mark sent" }).click();
  await page.getByRole("dialog", { name: /Record a send/ }).getByLabel("Sent", { exact: true }).fill(kl(sentThisWeek));
  await page.getByRole("dialog", { name: /Record a send/ }).getByRole("button", { name: "Record send" }).click();
  await expect(page.getByText("That send was already recorded; nothing new was added.")).toBeVisible();
  expect(sendKinds()).toBe("1:first_quote");

  // Revision v2, issued and sent in one step, counts as a revision.
  await quoteCard(page, `QT-E2E-${tag}`).getByRole("button", { name: "Revise" }).click();
  const revise = page.getByRole("dialog", { name: /Revise QT-E2E/ });
  await revise.getByLabel("Total amount", { exact: true }).fill("1400");
  await revise.getByLabel("Prepared", { exact: true }).fill(kl(sentThisWeek));
  await revise.getByLabel("What has happened", { exact: true }).selectOption("sent");
  await revise.getByLabel("Sent", { exact: true }).fill(kl(revisedThisWeek));
  await revise.getByLabel("Channel", { exact: true }).selectOption("email");
  await revise.getByRole("button", { name: "Save, issue and record send" }).click();
  await expect(page.getByText("Revision recorded.")).toBeVisible();
  expect(sendKinds()).toBe("1:first_quote,2:revision");

  // Persistence and immutable history after reload.
  await page.reload();
  const card = quoteCard(page, `QT-E2E-${tag}`);
  await expect(card).toContainText("First sent as v1");
  await expect(card.getByTestId("quote-version")).toHaveCount(2);
  await expect(card).toContainText("Revision");
  await expect(card).toContainText("First quotation");
  expect(sql(`select string_agg(version_no || ':' || total_amount, ',' order by version_no) from sales.quote_versions where quote_id = '${quoteId()}'`)).toBe("1:1500.00,2:1400.00");
  expect(sql(`select date_trunc('week', issued_at at time zone 'Asia/Kuala_Lumpur') < date_trunc('week', (select min(sent_at) from sales.quote_deliveries where quote_id = '${quoteId()}') at time zone 'Asia/Kuala_Lumpur') from sales.quote_versions where quote_id = '${quoteId()}' and version_no = 1`)).toBe("t");
  expect(sql(`select count(*) from sales.opportunities where workspace_id = '${WS}'`)).toBe("0");
});

test("visit: SQ note resolves to the canonical quote, historical note becomes only an unverified prepared record, file stays private", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, emails.rep);
  await page.goto(`/sales/walk-ins?visit=${ids.visitMatched}`);
  const evidence = panel(page).getByTestId("visit-quote-evidence");
  await expect(evidence).toContainText("Matched by SQ number");
  await expect(evidence).toContainText(`QT-E2E-${tag}`);
  await expect(quoteCard(page, `QT-E2E-${tag}`)).toBeVisible(); // the inquiry's quote, without re-entering identity

  // Hand over a quote at the counter: prepared, issued and sent in one record.
  await panel(page).getByRole("button", { name: "Record quote" }).click();
  const counter = page.getByRole("dialog", { name: "Record quote" });
  await counter.getByLabel("Quote number", { exact: true }).fill(`QT-E2E-VISIT-${tag}`);
  await counter.getByLabel("Total amount", { exact: true }).fill("300");
  await counter.getByLabel("What has happened", { exact: true }).selectOption("sent");
  await counter.getByLabel("Channel", { exact: true }).selectOption("in_person");
  await counter.getByLabel("Evidence", { exact: true }).selectOption("customer_acknowledged");
  await counter.getByRole("button", { name: "Save, issue and record send" }).click();
  await expect(page.getByText("Quote recorded.")).toBeVisible();
  expect(sql(`select lead_id || '/' || contact_id from sales.quotes where quote_number = 'QT-E2E-VISIT-${tag}'`)).toBe(`${ids.lead}/${ids.contact}`);

  // Upload a quotation file: evidence only, no quote is created from it.
  const before = sql(`select count(*) from sales.quotes where workspace_id = '${WS}'`);
  await page.getByLabel("Choose quotation files").setInputFiles({ name: `e2e-quote-${tag}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.getByRole("button", { name: "Upload / retry files" }).click();
  await expect(page.getByRole("button", { name: `Download e2e-quote-${tag}.pdf` })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select count(*) from sales.quotes where workspace_id = '${WS}'`)).toBe(before);
  expect(sql(`select count(*) from sales.quote_deliveries where workspace_id = '${WS}' and quote_id not in (select id from sales.quotes where quote_number in ('QT-E2E-${tag}', 'QT-E2E-VISIT-${tag}'))`)).toBe("0");
  await page.reload();
  const fileRow = panel(page).getByTestId("visit-quote-evidence").getByRole("listitem").filter({ hasText: `e2e-quote-${tag}.pdf` });
  await expect(fileRow).toContainText("Needs review");
  await fileRow.getByRole("button", { name: "Review evidence" }).click();
  const review = page.getByRole("dialog", { name: /Review e2e-quote/ });
  await review.getByLabel("Quote", { exact: true }).selectOption(quoteId());
  await review.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Evidence review saved.")).toBeVisible();
  await expect(panel(page).getByTestId("visit-quote-evidence").getByRole("listitem").filter({ hasText: `e2e-quote-${tag}.pdf` })).toContainText("Linked");

  // Private file access: the owner downloads; anonymous and another workspace cannot.
  const path = sql(`select object_path from sales.visit_quotation_files where visit_id = '${ids.visitMatched}'`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download e2e-quote-${tag}.pdf` }).click();
  expect((await download).suggestedFilename()).toBe(`e2e-quote-${tag}.pdf`);
  const anon = createClient(status.API_URL, PUBLIC_KEY, { auth: { persistSession: false } });
  expect((await anon.storage.from("visit-quotations").download(path)).error).not.toBeNull();
  const foreign = createClient(status.API_URL, PUBLIC_KEY, { auth: { persistSession: false } });
  await foreign.auth.signInWithPassword({ email: emails.foreign, password: PASSWORD });
  expect((await foreign.storage.from("visit-quotations").download(path)).error).not.toBeNull();
  const version = sql(`select v.id from sales.quote_versions v join sales.quotes q on q.id = v.quote_id where q.quote_number = 'QT-E2E-${tag}' and v.version_no = 2`);
  const crossWorkspace = await foreign.rpc("quote_command", { p_action: "send", p_input: { version_id: version, sent_at: new Date().toISOString(), channel: "email", evidence: "staff_attested" }, p_request_id: randomUUID() });
  expect(crossWorkspace.error?.message).toBe("Quote version not found");
  expect((await foreign.from("quote_register").select("quote_id").eq("workspace_id", WS)).data).toEqual([]);
  await foreign.auth.signOut({ scope: "local" });

  // Historical visit note: reviewed into an unverified prepared record, never sent.
  await page.goto(`/sales/walk-ins?visit=${ids.visitHistoric}`);
  const historic = panel(page).getByTestId("visit-quote-evidence").getByRole("listitem").filter({ hasText: HISTORIC_SQ });
  await expect(historic).toContainText("Needs review");
  await historic.getByRole("button", { name: "Review evidence" }).click();
  const create = page.getByRole("dialog", { name: /Review visit note/ });
  await create.getByLabel("This evidence is", { exact: true }).selectOption("create_prepared");
  await create.getByRole("button", { name: "Save review" }).click();
  await expect(create.getByRole("alert")).toContainText("Currency is required"); // never defaulted
  await create.getByLabel("Currency", { exact: true }).fill("MYR");
  await create.getByRole("button", { name: /Save review/ }).click();
  await expect(page.getByText("Evidence review saved.")).toBeVisible();
  await page.reload();
  await expect(panel(page).getByTestId("visit-quote-evidence")).toContainText("Linked");
  const prepared = panel(page).getByTestId("quote-card").first();
  await expect(prepared).toContainText("Prepared");
  await expect(prepared).toContainText("Unverified");
  expect(sql(`select q.origin || '/' || v.evidence_state || '/' || (v.issued_at is null) || '/' || (select count(*) from sales.quote_deliveries d where d.quote_id = q.id)
    from sales.quotes q join sales.quote_versions v on v.quote_id = q.id join sales.quote_references r on r.quote_id = q.id where r.ref_key = upper(regexp_replace('${HISTORIC_SQ}', '[^A-Za-z0-9]', '', 'g'))`)).toBe("visit_review/unverified_historical/true/0");
});

test("a role without sales.write sees quotations with explained, disabled actions", async ({ page }) => {
  await login(page, emails.reader);
  await page.goto(`/sales/walk-ins?visit=${ids.visitMatched}`);
  await expect(quoteCard(page, `QT-E2E-VISIT-${tag}`)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Record quote" })).toBeDisabled();
  await expect(quoteCard(page, `QT-E2E-VISIT-${tag}`).getByRole("button", { name: "Mark sent" })).toBeDisabled();
  const before = sql(`select count(*) from sales.quote_events where workspace_id = '${WS}'`);
  const reader = createClient(status.API_URL, PUBLIC_KEY, { auth: { persistSession: false } });
  await reader.auth.signInWithPassword({ email: emails.reader, password: PASSWORD });
  const denied = await reader.rpc("quote_command", { p_action: "accept", p_input: { quote_id: quoteId() }, p_request_id: randomUUID() });
  expect(denied.error?.code).toBe("42501");
  await reader.auth.signOut({ scope: "local" });
  expect(sql(`select count(*) from sales.quote_events where workspace_id = '${WS}'`)).toBe(before);
});
