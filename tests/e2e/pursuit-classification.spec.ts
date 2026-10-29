/**
 * TILE-4 journey against a running app and the LOCAL Supabase stack:
 * inquiry → qualification → classification review → correction → opportunity
 * → showroom walk-in conflict → resolution, with reloads proving persistence
 * and role and workspace boundaries. Refuses hosted targets.
 *
 * The suite owns its people and records: it creates its own synthetic users
 * (a sales rep, showroom staff and a member of another workspace) and its own
 * customer, signs each in on its own browser context, never signs anyone out
 * globally, and removes everything it made afterwards — failing, with the
 * reason, if any of it stays behind.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = `E2e-${randomBytes(9).toString("base64url")}!`;
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const RUN = randomBytes(4).toString("hex");
const PHONE = `+6011${String(Number.parseInt(RUN, 16) % 10_000_000).padStart(7, "0")}`;
const INQUIRY = `E2E Tile4 inquiry ${RUN}`;
const CONTACT = `E2E Tile4 buyer ${RUN}`;
const CONTACT_ID = randomUUID();
const users = {
  rep: { email: `e2e.tile4.rep.${RUN}@tileconcept.test`, role: "sales_rep", workspace: WORKSPACE, id: "" },
  showroom: { email: `e2e.tile4.showroom.${RUN}@tileconcept.test`, role: "showroom", workspace: WORKSPACE, id: "" },
  outsider: { email: `e2e.tile4.outsider.${RUN}@tileconcept.test`, role: "sales_manager", workspace: OTHER_WORKSPACE, id: "" },
};

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });

/** Malaysia wall-clock "YYYY-MM-DDTHH:mm" for a datetime-local input. */
function klLocal(d: Date) {
  return new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sql(`insert into core.workspaces(id,name,slug) values ('${OTHER_WORKSPACE}','E2E TILE-4 other workspace','e2e-tile4-${RUN}')`);
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `E2E ${u.role} ${RUN}` } });
    if (error || !data.user) throw error ?? new Error("user not created");
    u.id = data.user.id;
    sql(`insert into core.memberships(workspace_id,user_id,role_key) values ('${u.workspace}','${u.id}','${u.role}')`);
  }
  sql(`insert into identity.contacts(id,workspace_id,display_name) values ('${CONTACT_ID}','${WORKSPACE}','${CONTACT}');
       insert into identity.contact_points(workspace_id,contact_id,kind,raw_value,normalized_value,is_primary) values ('${WORKSPACE}','${CONTACT_ID}','phone','${PHONE}','${PHONE}',true);`);
});

test.afterAll(async () => {
  // Only what this run made, children before parents. The classification,
  // walk-in and manual-inquiry request records name their actor without a
  // cascade, so this run's users can only go once their own records have.
  // Every failed step is reported: a run that leaves anything behind fails.
  const problems: string[] = [];
  const reason = (e: unknown) => (e as { stderr?: string }).stderr?.trim() || String(e);
  const leads = `select id from sales.leads where workspace_id='${WORKSPACE}' and raw_name='${INQUIRY}'`;
  const actors = Object.values(users).filter((u) => u.id).map((u) => `'${u.id}'`).join(",") || "null";
  try {
    sql(`delete from sales.activities where lead_id in (${leads}) or contact_id='${CONTACT_ID}';
       delete from sales.visits where contact_id='${CONTACT_ID}';
       delete from sales.tasks where lead_id in (${leads}) or contact_id='${CONTACT_ID}';
       update sales.leads set converted_opportunity_id = null where id in (${leads});
       delete from sales.opportunity_stage_events where opportunity_id in (select id from sales.opportunities where contact_id='${CONTACT_ID}');
       delete from sales.opportunities where contact_id='${CONTACT_ID}';
       delete from identity.projects where primary_contact_id='${CONTACT_ID}';
       delete from sales.lead_intake_links where lead_id in (${leads});
       delete from sales.intake_events where lead_id in (${leads});
       delete from sales.leads where id in (${leads});
       delete from identity.contacts where id='${CONTACT_ID}';
       delete from sales.classification_requests where actor_id in (${actors});
       delete from sales.walk_in_requests where actor_id in (${actors});
       delete from sales.manual_inquiry_requests where actor_id in (${actors});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';`);
  } catch (e) {
    problems.push(`database rows: ${reason(e)}`);
  }
  for (const [name, u] of Object.entries(users)) {
    if (!u.id) continue;
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) problems.push(`Auth user ${name} ${u.id} (${u.email}): ${error.status ?? "no status"} ${error.message}`);
  }
  try {
    const left = sql(`select string_agg(k||'='||n, ' ') from (values
       ('users',(select count(*) from auth.users where id in (${actors}))),
       ('memberships',(select count(*) from core.memberships where user_id in (${actors}))),
       ('classification_requests',(select count(*) from sales.classification_requests where actor_id in (${actors}))),
       ('walk_in_requests',(select count(*) from sales.walk_in_requests where actor_id in (${actors}))),
       ('manual_inquiry_requests',(select count(*) from sales.manual_inquiry_requests where actor_id in (${actors}))),
       ('leads',(select count(*) from sales.leads where workspace_id='${WORKSPACE}' and raw_name='${INQUIRY}')),
       ('contact',(select count(*) from identity.contacts where id='${CONTACT_ID}')),
       ('other_workspace',(select count(*) from core.workspaces where id='${OTHER_WORKSPACE}'))) t(k,n) where n > 0`);
    if (left) problems.push(`left behind: ${left}`);
  } catch (e) {
    problems.push(`residue check: ${reason(e)}`);
  }
  if (problems.length) throw new Error(`TILE-4 run ${RUN} did not remove everything it made:\n- ${problems.join("\n- ")}`);
});

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
  return page;
}
const leadId = () => sql(`select id from sales.leads where workspace_id='${WORKSPACE}' and raw_name='${INQUIRY}'`);
const opportunityId = () => sql(`select converted_opportunity_id from sales.leads where workspace_id='${WORKSPACE}' and raw_name='${INQUIRY}'`);
async function choose(page: Page, triggerId: string, option: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
const fact = (page: Page, key: string) => page.getByTestId(`classification-${key}`);

test("inquiry is captured with unknowns, qualified with a flag, reviewed, corrected and converted", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signIn(browser, users.rep.email);

  // Capture: a backdated inquiry, buyer role stated, everything else left Unknown.
  await page.goto("/sales/inbox?new=1");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(INQUIRY);
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill(PHONE);
  const arrived = new Date(Date.now() - 3 * 3_600_000);
  await page.locator("#inquiry-arrived-at").fill(klLocal(arrived));
  await choose(page, "inquiry-buyer-role", "End user");
  await page.getByRole("button", { name: "Save inquiry" }).click();
  await expect(page.getByText("Inquiry saved. Linked to the uniquely matched customer.")).toBeVisible({ timeout: 30_000 });
  const id = leadId();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(sql(`select arrival_basis||'|'||arrival_precision||'|'||(recorded_at > created_at + interval '2 hours') from sales.leads where id='${id}'`)).toBe("backdated|exact|true");

  // Reload: the stored values come back.
  await page.goto(`/sales/inbox?view=all&lead=${id}`);
  await expect(fact(page, "buyer-role")).toHaveText("End user");
  await expect(fact(page, "project-use")).toHaveText("Unknown");
  await expect(page.getByTestId("classification-state")).toContainText("Not reviewed");
  await expect(page.getByTestId("inquiry-arrival")).toContainText("Backdated");

  // Qualification refuses a silent Unknown, then accepts an explicit flag.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Qualify/ }).click();
  const qualify = page.getByRole("dialog", { name: "Qualify inquiry" });
  await expect(qualify.getByRole("button", { name: "Qualify" })).toBeDisabled();
  await qualify.getByRole("checkbox", { name: "Flag the missing classification for review" }).click();
  await qualify.getByLabel("What is missing and why").fill("Site details not given yet");
  await qualify.getByRole("button", { name: "Qualify" }).click();
  await expect(page.getByText("Inquiry qualified. The missing classification is flagged for review.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("classification-state")).toContainText("Missing, flagged");
  expect(sql(`select status from sales.leads where id='${id}'`)).toBe("qualified");

  // The correction queue links straight back to the inquiry.
  await page.goto("/sales/classification-review");
  await page.getByRole("link", { name: INQUIRY }).click();
  await expect(page).toHaveURL(new RegExp(`lead=${id}`));
  await expect(fact(page, "buyer-role")).toHaveText("End user");

  // Fill the unknowns: no reason needed.
  await page.getByRole("button", { name: "Classify" }).click();
  let dialog = page.getByRole("dialog", { name: "Classify pursuit" });
  await choose(page, "classify-project-use", "Residential");
  await choose(page, "classify-work-type", "Renovation");
  await choose(page, "classify-glc-involvement", "No GLC");
  await dialog.getByRole("button", { name: "Save classification" }).click();
  await expect(page.getByText("Classification saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("classification-state")).toContainText("Classified");
  await expect(fact(page, "work-type")).toHaveText("Renovation");
  await page.goto("/sales/classification-review");
  await expect(page.getByRole("link", { name: INQUIRY })).toHaveCount(0);

  // Correct a known value: refused without a reason, kept in history with one.
  await page.goto(`/sales/inbox?view=all&lead=${id}`);
  await page.getByRole("button", { name: "Classify" }).click();
  dialog = page.getByRole("dialog", { name: "Classify pursuit" });
  await choose(page, "classify-buyer-role", "Contractor");
  await expect(dialog.getByRole("button", { name: "Save classification" })).toBeDisabled();
  await dialog.getByLabel("Reason for the change").fill("Buying as the contractor for a client's flat");
  await dialog.getByRole("button", { name: "Save classification" }).click();
  await expect(page.getByText("Classification saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /Classification history/ }).click();
  const history = page.getByTestId("classification-history");
  await expect(history).toContainText("Buyer role: End user → Contractor");
  await expect(history).toContainText("Buying as the contractor for a client's flat");

  // Convert: the opportunity continues the same pursuit.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Convert to opportunity/ }).click();
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await page.waitForURL(/\/sales\/pipeline\?opportunity=/, { timeout: 30_000 });
  await expect(fact(page, "buyer-role")).toHaveText("Contractor");
  await expect(page.getByTestId("classification-state")).toContainText("From inquiry");
  expect(sql(`select count(*) from sales.pursuits where lead_id='${id}'`)).toBe("1");
});

test("a showroom visit that disagrees is held as a conflict and resolved by the owner", async ({ browser }) => {
  test.setTimeout(240_000);
  const opp = opportunityId();
  expect(opp).toMatch(/^[0-9a-f-]{36}$/);

  // Showroom staff record the visit through the walk-in wizard.
  const counter = await signIn(browser, users.showroom.email);
  await counter.goto("/sales/walk-ins/new");
  await counter.locator("#showroom-search").fill(PHONE);
  await counter.getByRole("button", { name: "Find customer" }).click();
  await counter.getByRole("button", { name: "Use this" }).first().click();
  await choose(counter, "visit-buyer-role", "Interior designer");
  await counter.getByRole("button", { name: "Next", exact: true }).click();
  await counter.getByRole("button", { name: "Review visit" }).click();
  await counter.getByRole("button", { name: "Save walk-in" }).click();
  await expect(counter.getByRole("button", { name: /Record another walk-in/ })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select count(*) from sales.visits where contact_id='${CONTACT_ID}' and lead_id='${leadId()}'`)).toBe("1");

  // The recorded role stands. Counter staff can read the shared inquiry but not
  // the rep's opportunity, and cannot decide someone else's pursuit.
  await counter.goto(`/sales/inbox?view=all&lead=${leadId()}`);
  await expect(fact(counter, "buyer-role")).toHaveText("Contractor");
  await expect(counter.getByText(/A showroom visit recorded buyer role as/)).toBeVisible();
  await expect(counter.getByRole("button", { name: "Classify" })).toBeDisabled();
  await counter.goto(`/sales/pipeline?opportunity=${opp}`);
  await expect(counter.getByRole("heading", { name: /Pipeline/ }).first()).toBeVisible();
  await expect(fact(counter, "buyer-role")).toHaveCount(0);

  // The owner finds it in review and resolves it with a reason.
  const page = await signIn(browser, users.rep.email);
  await page.goto("/sales/classification-review");
  const row = page.getByRole("row").filter({ hasText: INQUIRY });
  await expect(row).toContainText("Conflicting source");
  await row.getByRole("link", { name: INQUIRY }).click();
  await expect(page).toHaveURL(new RegExp(`opportunity=${opp}`));
  await page.getByRole("button", { name: "Classify" }).click();
  const dialog = page.getByRole("dialog", { name: "Classify pursuit" });
  await expect(dialog.getByRole("button", { name: "Save classification" })).toBeDisabled();
  await dialog.getByLabel("Reason for the change").fill("Designer came along; the contractor is still the buyer");
  await dialog.getByRole("button", { name: "Save classification" }).click();
  await expect(page.getByText("Classification saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("classification-state")).toContainText("Classified");
  await expect(fact(page, "buyer-role")).toHaveText("Contractor");
  expect(sql(`select classification_state||'|'||buyer_role from sales.leads where id='${leadId()}'`)).toBe("complete|contractor");
});

test("another workspace sees none of it", async ({ browser }) => {
  const page = await signIn(browser, users.outsider.email);
  await page.goto("/sales/classification-review");
  await expect(page.getByRole("heading", { name: "Classification Review" })).toBeVisible();
  await expect(page.getByText(INQUIRY)).toHaveCount(0);
  await page.goto(`/sales/pipeline?opportunity=${opportunityId()}`);
  await expect(page.getByTestId("classification-buyer-role")).toHaveCount(0);
});
