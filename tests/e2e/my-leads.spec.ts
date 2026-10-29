/**
 * TILE-56: My Leads on a phone and on a desktop, against a running app and the
 * LOCAL Supabase stack. Synthetic accounts, leads and phone numbers only; the
 * spec refuses hosted targets, never follows a call or WhatsApp link (no
 * customer is ever messaged), never signs out a shared account, and removes
 * everything it created.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { submitPasswordForm } from "./login-form";

const PASSWORD = "TileDemo!2026";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKSPACE = randomUUID();
const run = randomUUID().slice(0, 8);
const user = (key: string, role: string) => ({ id: randomUUID(), email: `e2e.tile56.${key}.${run}@tileconcept.test`, name: `E2E ${key} ${run}`, role });
const REP = user("rep", "sales_rep");
const TEAMMATE = user("teammate", "sales_rep");
const SHOWROOM = user("showroom", "showroom");
const MARKETING = user("marketing", "marketing_coordinator");
const DRIVER = user("driver", "driver");
const OWNED = [REP, TEAMMATE, SHOWROOM, MARKETING, DRIVER];

// Synthetic numbers in a range no real customer record uses here.
const LEADS = {
  fresh: { id: randomUUID(), name: `Tile56 Fresh ${run}`, phone: "+60100005601", owner: REP.id, workspace: WORKSPACE },
  due: { id: randomUUID(), name: `Tile56 Due ${run}`, phone: "+60100005602", owner: REP.id, workspace: WORKSPACE },
  teammate: { id: randomUUID(), name: `Tile56 Teammate ${run}`, phone: "+60100005603", owner: TEAMMATE.id, workspace: WORKSPACE },
  showroom: { id: randomUUID(), name: `Tile56 Showroom ${run}`, phone: "+60100005604", owner: SHOWROOM.id, workspace: WORKSPACE },
  elsewhere: { id: randomUUID(), name: `Tile56 Elsewhere ${run}`, phone: "+60100005605", owner: REP.id, workspace: OTHER_WORKSPACE },
  unassigned: { id: randomUUID(), name: `Tile56 Unassigned ${run}`, phone: "+60100005606", owner: null, workspace: WORKSPACE },
};
const DUE_TASK = randomUUID();

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}
const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const API_URL: string = status.API_URL;
const PUBLISHABLE_KEY: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const values = OWNED.map((u) => `('${u.id}'::uuid,'${u.email}','${u.name}')`).join(",");
  sql(`with u(id,email,name) as (values ${values})
       insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
         confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token,is_sso_user)
       select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,extensions.crypt('${PASSWORD}',extensions.gen_salt('bf')),now(),
         '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name',name),now(),now(),'','','','','','','','',false from u;
       with u(id,email) as (values ${OWNED.map((u) => `('${u.id}'::uuid,'${u.email}')`).join(",")})
       insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
       select gen_random_uuid(),id,email,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now(),now() from u;
       insert into core.memberships(workspace_id,user_id,role_key) values ${OWNED.map((u) => `('${WORKSPACE}','${u.id}','${u.role}')`).join(",")};
       insert into core.workspaces(id,slug,name) values ('${OTHER_WORKSPACE}','e2e-tile56-${run}','E2E TILE-56 other workspace');
       insert into sales.leads(id,workspace_id,status,source_channel,raw_name,raw_phone,owner_id,assigned_at,interest,created_at,
         first_whatsapp_sent_at,last_contact_attempt_at,contact_attempts) values
         ${Object.entries(LEADS).map(([key, l]) => `('${l.id}','${l.workspace}','${key === "due" ? "contacted" : "new"}','tiktok','${l.name}','${l.phone}',${l.owner ? `'${l.owner}'` : "null"},now() - interval '3 days',
           'Synthetic wall panel enquiry',now() - interval '3 days',${key === "due" ? "now() - interval '2 days',now() - interval '2 days',1" : "null,null,0"})`).join(",")};
       insert into sales.tasks(id,workspace_id,lead_id,title,due_at,assignee_id) values
         ('${DUE_TASK}','${WORKSPACE}','${LEADS.due.id}','Follow up (synthetic)',now() - interval '2 hours','${REP.id}');`);
});

test.afterAll(() => {
  const ids = OWNED.map((u) => `'${u.id}'`).join(",");
  const leads = Object.values(LEADS).map((l) => `'${l.id}'`).join(",");
  // Remarks are immutable history (sales.guard_inquiry_annotation); only this
  // spec's own synthetic rows are removed, with that guard skipped for the one
  // statement.
  sql(`begin; set local session_replication_role = replica;
       delete from sales.activities where lead_id in (${leads}); commit;
       delete from sales.tasks where lead_id in (${leads});
       delete from sales.leads where id in (${leads});
       delete from core.workspaces where id='${OTHER_WORKSPACE}';
       delete from core.user_preferences where user_id in (${ids});
       delete from auth.users where id in (${ids});`);
  assert.equal(sql(`select count(*) from sales.leads where id in (${leads})`), "0");
  assert.equal(sql(`select count(*) from sales.activities where lead_id in (${leads})`), "0");
  assert.equal(sql(`select count(*) from auth.users where id in (${ids})`), "0");
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await submitPasswordForm(page, email, PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** The browser's own Supabase session, read from the SSR auth cookie. */
async function accessToken(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  return JSON.parse(json).access_token;
}

async function rpc(context: BrowserContext, fn: string, body: object) {
  const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${await accessToken(context)}`, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

const activities = (leadId: string, where = "true") => Number(sql(`select count(*) from sales.activities where lead_id='${leadId}' and ${where}`));
const leadCount = () => Number(sql(`select count(*) from sales.leads where raw_name like 'Tile56 %${run}'`));
const contactCount = () => Number(sql(`select count(*) from identity.contacts where workspace_id='${WORKSPACE}'`));

async function useBahasaDefault(context: BrowserContext) {
  await context.clearCookies({ name: "tc.locale" });
}

test.describe("phone (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a rep sees only their own leads, masked, in Bahasa Melayu by default", async ({ page, context }) => {
    await useBahasaDefault(context);
    await signIn(page, REP.email);
    await page.goto("/sales/my-leads?tab=all");
    await expect(page.getByRole("heading", { level: 1, name: "Prospek Saya" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Senarai prospek" }).getByRole("link")).toHaveText([/Susulan hari ini/, /Perlu tindakan/, /Akan datang/, /Semua/]);
    const list = page.getByRole("list", { name: "Semua" });
    await expect(list.getByText(LEADS.fresh.name)).toBeVisible();
    await expect(list.getByText(LEADS.due.name)).toBeVisible();
    // Another rep's lead and a lead in a workspace the rep does not belong to stay out.
    await expect(page.getByText(LEADS.teammate.name)).toHaveCount(0);
    await expect(page.getByText(LEADS.elsewhere.name)).toHaveCount(0);
    // Unassigned work stays in the Inquiry Inbox; My Leads never claims it.
    await expect(page.getByText(LEADS.unassigned.name)).toHaveCount(0);
    // Lists never carry a revealable number.
    const html = await page.content();
    for (const l of Object.values(LEADS)) expect(html).not.toContain(l.phone.slice(-7));
    await expect(list.getByText("+601•••601").filter({ visible: true })).toBeVisible();

    await page.goto("/sales/my-leads");
    await expect(page.getByRole("list", { name: "Susulan hari ini" }).getByText(LEADS.due.name)).toBeVisible();
    await expect(page.getByText(/^Lewat ·/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(LEADS.fresh.name)).toHaveCount(0);

    // Touch targets on the phone are at least 44px tall.
    for (const link of await page.getByRole("navigation", { name: "Senarai prospek" }).getByRole("link").all()) {
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The shortcut is in the top bar, labelled in the interface language.
    await expect(page.getByRole("link", { name: "Prospek Saya", exact: true })).toBeVisible();
    // No horizontal scroll at phone width: <main> is the scroller, and no card or
    // header may be wider than it (the tab row scrolls inside its own strip).
    expect(await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const cards = [...main.querySelectorAll("ul[aria-label] > li > a, h1")].map((el) => el.getBoundingClientRect().right);
      return { page: document.documentElement.scrollWidth <= window.innerWidth, main: main.scrollWidth <= main.clientWidth, cards: Math.max(...cards) <= window.innerWidth };
    })).toEqual({ page: true, main: true, cards: true });
  });

  test("one clear next action persists through the inbox command, once, and survives reload", async ({ page, context }) => {
    await useBahasaDefault(context);
    await signIn(page, REP.email);
    const leadsBefore = leadCount();
    const contactsBefore = contactCount();
    await page.goto("/sales/my-leads?tab=action");
    await page.getByRole("link", { name: new RegExp(LEADS.fresh.name) }).click();
    await expect(page.getByRole("heading", { level: 1, name: LEADS.fresh.name })).toBeVisible();
    // The list collapses behind the detail on a phone; the way back is one tap.
    await expect(page.getByRole("link", { name: "Kembali ke Prospek Saya" })).toBeVisible();

    // Contact links open the rep's own apps with nothing prefilled. They are
    // checked, never followed: no customer is messaged by this test.
    const call = page.getByRole("link", { name: "Telefon" });
    const whatsapp = page.getByRole("link", { name: "Buka WhatsApp" });
    await expect(call).toHaveAttribute("href", "tel:+60100005601");
    await expect(whatsapp).toHaveAttribute("href", "https://wa.me/60100005601");
    await expect(whatsapp).not.toHaveAttribute("href", /text=/);

    // Never contacted: the one next action is to record the WhatsApp the rep sent.
    const primary = page.getByRole("button", { name: "WhatsApp dihantar" }).first();
    expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await primary.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Ini tidak merekodkan balasan pelanggan");
    // A double tap records the update once.
    await dialog.getByRole("button", { name: "Simpan" }).dblclick();
    await expect(page.getByText("WhatsApp dihantar direkodkan.").filter({ visible: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(sql(`select first_whatsapp_sent_at is not null from sales.leads where id='${LEADS.fresh.id}'`)).toBe("t");
    expect(sql(`select first_customer_reply_at is null from sales.leads where id='${LEADS.fresh.id}'`)).toBe("t");
    expect(activities(LEADS.fresh.id, "request_id is not null")).toBe(1);

    await page.reload();
    await expect(page.getByText("Belum direkodkan").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /\d{4}/ }).first()).toBeVisible();
    // Contacted now, with no reminder: the next action is to schedule one.
    await page.getByRole("button", { name: "Jadualkan susulan" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Esok" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Susulan dijadualkan.").filter({ visible: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Susulan selesai" }).first()).toBeVisible();
    expect(sql(`select count(*) from sales.tasks where lead_id='${LEADS.fresh.id}' and status='open'`)).toBe("1");

    // A remark is stored once, with its author, and shown after reload.
    await page.getByRole("button", { name: "Tambah catatan" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Synthetic remark: prefers grey wall panels");
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Catatan ditambah.").filter({ visible: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Synthetic remark: prefers grey wall panels").filter({ visible: true })).toBeVisible();

    expect(activities(LEADS.fresh.id, "request_id is not null")).toBe(3);
    expect(leadCount()).toBe(leadsBefore);
    expect(contactCount()).toBe(contactsBefore);
  });

  test("validation, empty and not-found states are usable", async ({ page, context }) => {
    await useBahasaDefault(context);
    await signIn(page, REP.email);
    await page.goto(`/sales/my-leads?tab=all&lead=${LEADS.due.id}`);
    await page.getByRole("button", { name: "Susulan selesai" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("sekurang-kurangnya 3 aksara");
    await page.getByRole("dialog").getByRole("button", { name: "Batal" }).click();
    expect(sql(`select status from sales.tasks where id='${DUE_TASK}'`)).toBe("open");

    await page.goto(`/sales/my-leads?q=no-such-lead-${run}`);
    await expect(page.getByText("Tiada prospek sepadan dengan carian anda").filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kosongkan carian" })).toBeVisible();

    // A lead in a workspace the rep does not belong to is not found, not shown.
    await page.goto(`/sales/my-leads?lead=${LEADS.elsewhere.id}`);
    await expect(page.getByText("Pautan prospek ini tidak sah atau rekod tidak tersedia untuk akaun anda.").filter({ visible: true })).toBeVisible();
    await expect(page.getByText(LEADS.elsewhere.name)).toHaveCount(0);
  });

  test("a showroom member sees the mask, cannot update a colleague's lead, and the database agrees", async ({ page, context }) => {
    await signIn(page, SHOWROOM.email);
    await page.goto(`/sales/my-leads?tab=all&lead=${LEADS.showroom.id}`);
    await expect(page.getByRole("heading", { level: 1, name: LEADS.showroom.name })).toBeVisible();
    await expect(page.getByText("+601•••604", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(/masked because your role lacks contact.reveal/).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Call" })).toHaveCount(0);
    expect(await page.content()).not.toContain("100005604");
    await expect(page.getByRole("button", { name: "WhatsApp sent" }).first()).toBeEnabled();

    // A colleague's lead, reached by link: readable as in the inbox, every update disabled.
    await page.goto(`/sales/my-leads?tab=all&lead=${LEADS.fresh.id}`);
    await expect(page.getByRole("heading", { level: 1, name: LEADS.fresh.name })).toBeVisible();
    await expect(page.getByText("Only the assigned salesperson or a sales manager can update this inquiry.").filter({ visible: true })).toBeVisible();
    for (const button of await page.locator("main section button").all()) await expect(button).toBeDisabled();
    // The same update sent straight to the database is refused.
    const before = activities(LEADS.fresh.id);
    const refused = await rpc(context, "work_inquiry", { p_lead_id: LEADS.fresh.id, p_action: "customer_replied", p_request_id: randomUUID(), p_channel: "phone" });
    expect(refused.status).toBe(403);
    expect(refused.body).toContain("not the owner");
    expect(activities(LEADS.fresh.id)).toBe(before);
  });

  test("a role without sales.write reads only what the inbox already shows it, and cannot update", async ({ page }) => {
    await signIn(page, MARKETING.email);
    // Another rep's lead is not readable by this role anywhere, so not here either.
    await page.goto(`/sales/my-leads?tab=all&lead=${LEADS.due.id}`);
    await expect(page.getByText("This lead link is invalid or the record is unavailable to your account.").filter({ visible: true })).toBeVisible();
    await expect(page.getByText(LEADS.due.name)).toHaveCount(0);
    // An unassigned lead is readable (as in the inbox), but every update is disabled.
    await page.goto(`/sales/my-leads?tab=all&lead=${LEADS.unassigned.id}`);
    await expect(page.getByRole("heading", { level: 1, name: LEADS.unassigned.name })).toBeVisible();
    await expect(page.getByText(/Your role can view this lead but not update it\. A sales representative, sales manager or showroom role can/).filter({ visible: true })).toBeVisible();
    for (const button of await page.locator("main section button").all()) await expect(button).toBeDisabled();
    await expect(page.getByRole("link", { name: "My Leads", exact: true })).toHaveCount(0);
  });

  test("a driver gets the denial, not the list", async ({ page }) => {
    await signIn(page, DRIVER.email);
    await page.goto("/sales/my-leads");
    await expect(page.getByText("My Leads is for sales, showroom and management roles.").filter({ visible: true })).toBeVisible();
    await expect(page.getByText(LEADS.due.name)).toHaveCount(0);
  });
});

test.describe("desktop (1280×900)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the list and the detail sit side by side and a completed follow-up persists in English", async ({ page }) => {
    await signIn(page, REP.email);
    const leadsBefore = leadCount();
    await page.goto("/sales/my-leads");
    await expect(page.getByRole("heading", { level: 1, name: "My Leads" })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(LEADS.due.name) }).click();
    await expect(page.getByRole("heading", { level: 1, name: LEADS.due.name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "My Leads" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to My Leads" })).toBeHidden();

    await page.getByRole("button", { name: "Follow-up done" }).first().click();
    await page.getByRole("dialog").getByRole("textbox").fill("Synthetic outcome: visiting the showroom on Saturday");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Follow-up completed. Choose the next action.").filter({ visible: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Schedule follow-up" }).first()).toBeVisible();
    expect(sql(`select status from sales.tasks where id='${DUE_TASK}'`)).toBe("done");
    expect(activities(LEADS.due.id, "request_id is not null")).toBe(1);
    expect(leadCount()).toBe(leadsBefore);

    // The Inquiry Inbox shows the same record, not a copy.
    await page.goto(`/sales/inbox?view=all&lead=${LEADS.due.id}`);
    await expect(page.getByText("Synthetic outcome: visiting the showroom on Saturday").filter({ visible: true }).first()).toBeVisible();
  });
});
