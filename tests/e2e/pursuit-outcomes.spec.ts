/**
 * TILE-8 pursuit outcomes, through the compiled app against the LOCAL Supabase
 * stack: browser → server action → api.pursuit_outcome_command → reload.
 *
 * Isolation: every run creates its own workspace, opportunity stages, users and
 * synthetic records, and never signs anyone out globally, so it cannot disturb
 * other suites or the demo logins. Outcome history is append-only by design, so
 * the run's workspace is left in place (a local `pnpm db:reset` clears it).
 * Refuses hosted targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const RUN = randomUUID().slice(0, 8);
const PASSWORD = `Tile-E2E-${randomUUID()}`;
const WORKSPACE = randomUUID();
const TEMPLATE_WORKSPACE = "11111111-1111-1111-1111-111111111111";
const users = {
  rep: { id: "", email: `e2e-outcome-rep-${RUN}@tileconcept.test`, role: "sales_rep", name: `E2E Outcome Rep ${RUN}` },
  showroom: { id: "", email: `e2e-outcome-showroom-${RUN}@tileconcept.test`, role: "showroom", name: `E2E Outcome Showroom ${RUN}` },
  marketing: { id: "", email: `e2e-outcome-marketing-${RUN}@tileconcept.test`, role: "marketing_coordinator", name: `E2E Outcome Marketing ${RUN}` },
};
const ids = { leadOther: randomUUID(), leadLinked: randomUUID(), oppLinked: randomUUID(), oppStandalone: randomUUID(), leadSpam: randomUUID(), contact: randomUUID() };
const name = (label: string) => `E2E ${label} ${RUN}`;

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false } });
const publishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const u of Object.values(users)) {
    const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } });
    if (error || !data.user) throw error ?? new Error("user not created");
    u.id = data.user.id;
  }
  sql(`
    insert into core.workspaces(id,slug,name) values ('${WORKSPACE}','e2e-outcomes-${RUN}','E2E outcomes ${RUN}');
    insert into core.opportunity_stages(workspace_id,key,label,position,reporting_group,requires_reason,requires_next_action,is_active)
      select '${WORKSPACE}',key,label,position,reporting_group,requires_reason,requires_next_action,is_active from core.opportunity_stages where workspace_id='${TEMPLATE_WORKSPACE}';
    insert into core.memberships(workspace_id,user_id,role_key) values
      ('${WORKSPACE}','${users.rep.id}','sales_rep'),('${WORKSPACE}','${users.showroom.id}','showroom'),('${WORKSPACE}','${users.marketing.id}','marketing_coordinator');
    insert into identity.contacts(id,workspace_id,display_name) values ('${ids.contact}','${WORKSPACE}','${name("contact")}');
    insert into sales.leads(id,workspace_id,status,source_channel,raw_name,owner_id,contact_id,created_at) values
      ('${ids.leadOther}','${WORKSPACE}','contacted','tiktok','${name("Other detail inquiry")}','${users.rep.id}',null,now()-interval '2 days'),
      ('${ids.leadLinked}','${WORKSPACE}','converted','meta','${name("Linked inquiry")}','${users.rep.id}','${ids.contact}',now()-interval '2 days'),
      ('${ids.leadSpam}','${WORKSPACE}','new','website','${name("Spam inquiry")}','${users.rep.id}',null,now()-interval '2 days');
    insert into sales.opportunities(id,workspace_id,name,contact_id,lead_id,owner_id,stage_key,status,estimated_value,next_action,next_action_due_at) values
      ('${ids.oppLinked}','${WORKSPACE}','${name("Linked opportunity")}','${ids.contact}','${ids.leadLinked}','${users.rep.id}','quote_sent','open',30000,'Chase decision',now()+interval '1 day'),
      ('${ids.oppStandalone}','${WORKSPACE}','${name("Standalone opportunity")}','${ids.contact}',null,'${users.rep.id}','consultation','open',9000,'Send options',now()+interval '1 day');
    update sales.leads set converted_opportunity_id='${ids.oppLinked}' where id='${ids.leadLinked}';
    insert into sales.tasks(workspace_id,title,due_at,assignee_id,lead_id,opportunity_id,created_by) values
      ('${WORKSPACE}','${name("lead reminder")}',now()+interval '1 day','${users.rep.id}','${ids.leadOther}',null,'${users.rep.id}'),
      ('${WORKSPACE}','${name("linked lead reminder")}',now()+interval '1 day','${users.rep.id}','${ids.leadLinked}',null,'${users.rep.id}'),
      ('${WORKSPACE}','${name("linked opportunity reminder")}',now()+interval '1 day','${users.rep.id}',null,'${ids.oppLinked}','${users.rep.id}');
    insert into sales.quotes(id,workspace_id,opportunity_id,quote_number,status,current_version_no) values ('${randomUUID()}','${WORKSPACE}','${ids.oppLinked}','E2E-Q-${RUN}','issued',1);
    insert into sales.quote_versions(workspace_id,quote_id,version_no,issued_at,total_amount,currency)
      select '${WORKSPACE}',id,1,now()-interval '1 day',27500,'MYR' from sales.quotes where quote_number='E2E-Q-${RUN}';
  `);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/");
}
async function signedIn(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await login(page, email);
  return page;
}
/** A form control by its visible label; the ⓘ tip ("About …") and the required "*" are not part of the match. */
const field = (scope: Page | Locator, label: string) => scope.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\*)?$`));
const openInquiry = (page: Page, id: string) => page.goto(`/sales/inbox?view=all&lead=${id}`);
const openOpportunity = (page: Page, id: string) => page.goto(`/sales/pipeline?view=all&opportunity=${id}`);
const events = (where: string) => Number(sql(`select count(*) from sales.pursuit_outcome_events where ${where}`));

test("inquiry loss needs a reason and date, survives an uncertain network, a second tab and reload, and reopens without losing history", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await login(page, users.rep.email);
  await openInquiry(page, ids.leadOther);
  await page.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Close or defer inquiry" });
  await expect(dialog.getByRole("radio", { name: "Rejected at qualification" })).toBeVisible();

  // Required fields: no reason, then Other without an explanation.
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose a reason. Use Unknown when the reason is not known.");
  await dialog.getByRole("radio", { name: "Other (explain)", exact: true }).check();
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Explain the reason (at least 3 characters).");
  await field(dialog, "Effective date (Kuala Lumpur)").fill("");
  await field(dialog, "Explanation").fill("E2E synthetic: customer moved overseas");
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the date the outcome took effect.");
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  await field(dialog, "Effective date (Kuala Lumpur)").fill(today);
  expect(events(`lead_id='${ids.leadOther}'`)).toBe(0);

  // A second tab tries to close the same inquiry at the same time.
  const second = await signedIn(browser, users.rep.email);
  await openInquiry(second, ids.leadOther);
  await second.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const secondDialog = second.getByRole("dialog", { name: "Close or defer inquiry" });
  await secondDialog.getByRole("radio", { name: "Price or budget" }).check();

  // The first response is lost on the way back: the server commits, the browser never hears.
  let dropped = false;
  await page.route("**/sales/inbox**", async (route) => {
    if (!dropped && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropped = true;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The result could not be confirmed. Retry safely; the same outcome will not be recorded twice.");
  expect(events(`lead_id='${ids.leadOther}'`)).toBe(1);
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(page.getByText(/^Loss recorded\./)).toBeVisible();
  expect(events(`lead_id='${ids.leadOther}'`)).toBe(1);
  await page.unroute("**/sales/inbox**");

  // The stale tab is refused instead of recording a second, different loss.
  await secondDialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(secondDialog.getByRole("alert")).toHaveText("This inquiry is already closed. Reopen it first.");
  expect(events(`lead_id='${ids.leadOther}'`)).toBe(1);
  await second.context().close();

  // Reload: closed, reminder resolved, reason and detail in history.
  await openInquiry(page, ids.leadOther);
  await expect(page.getByText("Lost: Other (explain): E2E synthetic: customer moved overseas", { exact: true })).toBeVisible();
  const history = page.getByTestId("outcome-event");
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText("Other (explain)");
  await expect(history.first()).toContainText(`recorded`);
  await expect(history.first()).toContainText(users.rep.name);
  expect(sql(`select status from sales.tasks where lead_id='${ids.leadOther}'`)).toBe("cancelled");

  // Reopen needs a reason; afterwards the inquiry is active and the loss stays in history.
  await page.getByRole("button", { name: "Reopen inquiry", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen pursuit" });
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(reopen.getByRole("alert")).toHaveText("Record why the pursuit is reopened (at least 3 characters).");
  await field(reopen, "Why is it reopened?").fill("E2E synthetic: customer returned");
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText(/^Reopened\./)).toBeVisible();
  await openInquiry(page, ids.leadOther);
  await expect(page.getByRole("button", { name: "Close or defer…", exact: true })).toBeVisible();
  await expect(page.getByTestId("outcome-event").first()).toContainText("Reopened");
  await expect(page.getByTestId("outcome-event").first()).toContainText("E2E synthetic: customer returned");
  expect(sql(`select status from sales.leads where id='${ids.leadOther}'`)).toBe("contacted");

  // Lose again with an explicit Unknown: two loss events, one pursuit.
  await page.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Close or defer inquiry" });
  await again.getByRole("radio", { name: "Unknown", exact: true }).check();
  await again.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(page.getByText(/^Loss recorded\./)).toBeVisible();
  await openInquiry(page, ids.leadOther);
  await expect(page.getByTestId("outcome-event")).toHaveCount(2);
  expect(sql(`select count(*)||'/'||count(distinct pursuit_key) from api.pursuit_outcome_history where lead_id='${ids.leadOther}' and outcome_type='lost'`)).toBe("2/1");
});

test("pipeline loss to an unnamed supplier closes the linked inquiry once, keeps values apart, and reopens both", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, users.rep.email);
  await openOpportunity(page, ids.oppLinked);
  await page.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Close or defer opportunity" });
  await expect(dialog.getByRole("radio", { name: "Rejected at qualification" })).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Awarded to another supplier" }).check();
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("State the relationship with the supplier, or choose Unknown.");
  await dialog.getByRole("radio", { name: "Relationship reported (provisional)" }).check();
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Describe the reported relationship (at least 3 characters).");
  // Unknown is chosen explicitly for the relationship; the supplier stays unnamed.
  await dialog.getByRole("group", { name: /Relationship with this supplier/ }).getByRole("radio", { name: "Unknown", exact: true }).check();
  await expect(dialog.getByRole("radio", { name: "Awarded to another supplier" })).toBeChecked();
  await dialog.getByRole("button", { name: "Record loss", exact: true }).click();
  await expect(page.getByText(/^Loss recorded\./)).toBeVisible();

  await openOpportunity(page, ids.oppLinked);
  const event = page.getByTestId("outcome-event").first();
  await expect(event).toContainText("Supplier: Unknown (not named)");
  await expect(event).toContainText("Relationship: Unknown");
  await expect(event).toContainText("Lost quoted value: RM");
  await expect(event).toContainText("27,500");
  await expect(event).toContainText("Estimated value: RM");
  await expect(event).toContainText("inquiry and opportunity closed together (counted once)");
  expect(sql(`select status from sales.leads where id='${ids.leadLinked}'`)).toBe("disqualified");
  expect(events(`lead_id='${ids.leadLinked}' or opportunity_id='${ids.oppLinked}'`)).toBe(1);
  expect(sql(`select count(*) from sales.tasks where (lead_id='${ids.leadLinked}' or opportunity_id='${ids.oppLinked}') and status='open'`)).toBe("0");

  // The stage control cannot bypass the outcome: from Lost it only offers Reopen.
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen pursuit" });
  await field(reopen, "Why is it reopened?").fill("E2E synthetic: supplier could not deliver");
  await field(reopen, "Next action").fill("Send revised quote");
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText(/^Reopened\./)).toBeVisible();
  await openOpportunity(page, ids.oppLinked);
  await expect(page.getByTestId("outcome-event").first()).toContainText("Reopened");
  expect(sql(`select status||'/'||stage_key from sales.opportunities where id='${ids.oppLinked}'`)).toBe("open/quote_sent");
  expect(sql(`select status from sales.leads where id='${ids.leadLinked}'`)).toBe("converted");
});

test("timing defers with a review date, then resumes; spam is a rejection, not a loss", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, users.rep.email);
  await openOpportunity(page, ids.oppStandalone);
  await page.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Close or defer opportunity" });
  await dialog.getByRole("radio", { name: "Defer: not ready yet" }).check();
  await dialog.getByRole("radio", { name: "Customer not ready yet" }).check();
  await dialog.getByRole("button", { name: "Defer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose a review date for the deferral.");
  const review = new Date(Date.now() + 8 * 3600000 + 30 * 86400000).toISOString().slice(0, 10);
  await field(dialog, "Review date").fill(review);
  await dialog.getByRole("button", { name: "Defer", exact: true }).click();
  await expect(page.getByText(/^Deferred\./)).toBeVisible();
  await openOpportunity(page, ids.oppStandalone);
  await expect(page.getByTestId("outcome-event").first()).toContainText("Customer not ready yet");
  expect(sql(`select status||'/'||deferred_until from sales.opportunities where id='${ids.oppStandalone}'`)).toBe(`deferred/${review}`);
  expect(sql(`select count(*) from sales.tasks where opportunity_id='${ids.oppStandalone}' and status='open' and title like 'Review deferred%'`)).toBe("1");

  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen pursuit" });
  await field(reopen, "Why is it reopened?").fill("E2E synthetic: budget released");
  await field(reopen, "Next action").fill("Book site visit");
  await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByText(/^Reopened\./)).toBeVisible();
  expect(sql(`select status from sales.opportunities where id='${ids.oppStandalone}'`)).toBe("open");

  await openInquiry(page, ids.leadSpam);
  await page.getByRole("button", { name: "Close or defer…", exact: true }).click();
  const close = page.getByRole("dialog", { name: "Close or defer inquiry" });
  await close.getByRole("radio", { name: "Rejected at qualification" }).check();
  await close.getByRole("radio", { name: "Spam or fake contact" }).check();
  await close.getByRole("button", { name: "Reject inquiry", exact: true }).click();
  await expect(page.getByText(/^Inquiry rejected at qualification\./)).toBeVisible();
  await openInquiry(page, ids.leadSpam);
  await expect(page.getByText("Rejected at qualification: Spam or fake contact", { exact: true })).toBeVisible();
  expect(sql(`select string_agg(outcome_type||':'||reason_code, ',') from api.pursuit_outcome_history where lead_id='${ids.leadSpam}'`)).toBe("rejected:spam");
});

test("roles without the right cannot close another owner's pursuit, in the browser or by calling the API", async ({ page }) => {
  test.setTimeout(90_000);
  // Showroom staff can read the shared inquiry but not act on another salesperson's.
  await login(page, users.showroom.email);
  await openInquiry(page, ids.leadLinked);
  await expect(page.getByRole("button", { name: "Close or defer…", exact: true })).toBeDisabled();

  for (const u of [users.showroom, users.marketing]) {
    const client = createClient(status.API_URL, publishable, { auth: { persistSession: false }, db: { schema: "api" } });
    const { error: signInError } = await client.auth.signInWithPassword({ email: u.email, password: PASSWORD });
    expect(signInError).toBeNull();
    const { error } = await client.rpc("pursuit_outcome_command", {
      p_action: "lose", p_request_id: randomUUID(),
      p_input: { opportunity_id: ids.oppStandalone, reason_code: "price", effective_date: new Date().toISOString().slice(0, 10) },
    });
    expect(error?.code, `${u.role} must be refused`).toBe("42501");
    await client.auth.signOut({ scope: "local" });
  }
  expect(sql(`select status from sales.opportunities where id='${ids.oppStandalone}'`)).toBe("open");
});
