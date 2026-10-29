/**
 * TILE-84: a customer-card PIC transfer is authorized by the ACTING membership
 * (the oldest active one, as core.current_workspace_id defines it) and only
 * touches cards in that workspace. A role held in another workspace is never
 * borrowed, in either direction.
 *
 * Normal Auth (password sign-in) and authenticated PostgREST requests against
 * the LOCAL stack, with outcomes read back from the database. Every user,
 * workspace and card is created here and removed afterwards; refuses hosted
 * targets.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert(["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname), "This test refuses hosted targets");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function sql(query: string) {
  return execFileSync("docker", ["exec", process.env.E2E_DB_CONTAINER ?? "supabase_db_tile-concept", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
}

const tag = randomUUID().slice(0, 8);
const PASSWORD = `Scope!${randomUUID()}`;
const A = randomUUID();
const B = randomUUID();

// Memberships listed first are created first, so the first one is the acting
// membership (no created_at ties).
const PEOPLE = {
  crossAdmin: [["A", "admin"], ["B", "sales_rep"]], // admin where acting, no sales.assign in B
  borrower: [["A", "management"], ["B", "admin"]], // read-only where acting, admin in B
  showroomControl: [["A", "showroom"], ["B", "sales_rep"]], // no sales.assign anywhere
  manager: [["A", "sales_manager"]],
  suspendedAdmin: [["A", "admin:suspended"]],
  outsider: [] as string[][],
  picA1: [["A", "sales_rep"]],
  picA2: [["A", "sales_rep"]],
  picB1: [["B", "sales_rep"]],
  picB2: [["B", "sales_rep"]],
} as const;
type Person = keyof typeof PEOPLE;
const ids = {} as Record<Person, string>;
const email = (p: Person) => `e2e.${p.toLowerCase()}.${tag}@tileconcept.test`;

const card = {
  contactA: randomUUID(),
  accountA: randomUUID(),
  contactB: randomUUID(),
  accountB: randomUUID(),
};
const allCards = Object.values(card);

async function signIn(p: Person): Promise<SupabaseClient> {
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "api" } });
  const { error } = await client.auth.signInWithPassword({ email: email(p), password: PASSWORD });
  if (error) throw error;
  return client;
}

/** The state a transfer would change: PIC, assignment, audit and outbox rows. */
function cardState(id: string) {
  return sql(`select coalesce(owner_id::text,'-')||'|'||coalesce(owner_assigned_by::text,'-')||'|'||coalesce(owner_assigned_at::text,'-')
                ||'|'||(select count(*) from audit.audit_events where object_id='${id}')||'|'||(select count(*) from audit.outbox_events where object_id='${id}')
              from (select owner_id, owner_assigned_by, owner_assigned_at from identity.contacts where id='${id}'
                    union all select owner_id, owner_assigned_by, owner_assigned_at from identity.accounts where id='${id}') c`);
}

async function transfer(p: Person, kind: "contact" | "account", id: string, newOwner: Person, reason = `E2E scope ${tag}`) {
  const client = await signIn(p);
  return client.rpc("transfer_customer_card", { p_card: kind, p_id: id, p_owner_id: ids[newOwner], p_reason: reason });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const p of Object.keys(PEOPLE) as Person[]) {
    const { data, error } = await admin.auth.admin.createUser({ email: email(p), password: PASSWORD, email_confirm: true, user_metadata: { full_name: `E2E ${p} ${tag}` } });
    if (error) throw error;
    ids[p] = data.user.id;
  }
  const memberships: string[] = [];
  let minute = 0;
  for (const p of Object.keys(PEOPLE) as Person[]) {
    for (const [ws, role] of PEOPLE[p]) {
      const [roleKey, state] = role.split(":");
      memberships.push(`('${ws === "A" ? A : B}','${ids[p]}','${roleKey}','${state ?? "active"}',now() - interval '1 day' + interval '${minute++} minutes')`);
    }
  }
  sql(`insert into core.workspaces(id,name,slug) values ('${A}','E2E scope A ${tag}','e2e-scope-a-${tag}'),('${B}','E2E scope B ${tag}','e2e-scope-b-${tag}');
       insert into core.memberships(workspace_id,user_id,role_key,status,created_at) values ${memberships.join(",")};
       insert into identity.contacts(id,workspace_id,display_name,owner_id) values
         ('${card.contactA}','${A}','E2E scope contact A ${tag}','${ids.picA1}'),('${card.contactB}','${B}','E2E scope contact B ${tag}','${ids.picB1}');
       insert into identity.accounts(id,workspace_id,name,owner_id) values
         ('${card.accountA}','${A}','E2E scope account A ${tag}','${ids.picA1}'),('${card.accountB}','${B}','E2E scope account B ${tag}','${ids.picB1}');`);
});

test.afterAll(async () => {
  const list = allCards.map((c) => `'${c}'`).join(",");
  // Deleting the cards writes audit rows of its own, so audit goes last.
  sql(`delete from identity.contacts where id in (${list}); delete from identity.accounts where id in (${list});
       delete from audit.audit_events where object_id in (${list}); delete from audit.outbox_events where object_id in (${list});
       delete from core.workspaces where id in ('${A}','${B}');
       delete from auth.users where id in (${Object.values(ids).map((id) => `'${id}'`).join(",")});`);
  expect(sql(`select (select count(*) from core.workspaces where id in ('${A}','${B}')) + (select count(*) from auth.users where email like '%.${tag}@tileconcept.test')
              + (select count(*) from audit.audit_events where object_id in (${list}))`)).toBe("0");
});

test("the acting workspace is the oldest active membership for every mixed-role person", async () => {
  for (const p of ["crossAdmin", "borrower", "showroomControl"] as Person[]) {
    const client = await signIn(p);
    const { data, error } = await client.rpc("my_membership");
    expect(error).toBeNull();
    expect((data as { workspace_id: string }[])[0]?.workspace_id, p).toBe(A);
  }
});

for (const kind of ["contact", "account"] as const) {
  test(`${kind}: an admin acting in A cannot transfer a B card where they hold no sales.assign`, async () => {
    const id = kind === "contact" ? card.contactB : card.accountB;
    const before = cardState(id);
    const { error } = await transfer("crossAdmin", kind, id, "picB2");
    expect(error, "borrowed admin must be refused").not.toBeNull();
    expect(cardState(id)).toBe(before);
  });

  test(`${kind}: a read-only member acting in A cannot borrow B's admin role to transfer an A card`, async () => {
    const id = kind === "contact" ? card.contactA : card.accountA;
    const before = cardState(id);
    const { error } = await transfer("borrower", kind, id, "picA2");
    expect(error, "borrowed admin must be refused").not.toBeNull();
    expect(error?.message).toMatch(/sales\.assign/);
    expect(cardState(id)).toBe(before);
  });

  test(`${kind}: controls without sales.assign, suspended and outside members are refused unchanged`, async () => {
    for (const [p, id] of [["showroomControl", kind === "contact" ? card.contactB : card.accountB], ["showroomControl", kind === "contact" ? card.contactA : card.accountA],
                           ["suspendedAdmin", kind === "contact" ? card.contactA : card.accountA], ["outsider", kind === "contact" ? card.contactA : card.accountA]] as [Person, string][]) {
      const before = cardState(id);
      const { error } = await transfer(p, kind, id, kind === "contact" && id === card.contactB ? "picB2" : "picA2");
      expect(error, `${p} must be refused`).not.toBeNull();
      expect(cardState(id), `${p} left no change`).toBe(before);
    }
  });

  test(`${kind}: the acting workspace's manager transfers a local card once, audited, and edit rights move`, async () => {
    const id = kind === "contact" ? card.contactA : card.accountA;
    const table = kind === "contact" ? "contacts" : "accounts";
    const before = cardState(id);
    const noReason = await transfer("manager", kind, id, "picA2", "  ");
    expect(noReason.error?.message).toMatch(/reason required/);
    const foreignPic = await transfer("manager", kind, id, "picB2");
    expect(foreignPic.error?.message).toBe("Choose an active salesperson in this workspace");
    expect(cardState(id)).toBe(before);

    const { data, error } = await transfer("manager", kind, id, "picA2");
    expect(error).toBeNull();
    expect((data as { owner_id: string; old_owner_id: string }).owner_id).toBe(ids.picA2);
    expect(sql(`select owner_id||'|'||owner_assigned_by from identity.${table} where id='${id}'`)).toBe(`${ids.picA2}|${ids.manager}`);
    expect(sql(`select count(*)||'|'||min(actor_id::text)||'|'||min(before_data->>'owner_id')||'|'||min(after_data->>'owner_id')||'|'||min(workspace_id::text)||'|'||bool_and(occurred_at is not null)
                from audit.audit_events where action='customer_card.pic_transferred' and object_id='${id}'`))
      .toBe(`1|${ids.manager}|${ids.picA1}|${ids.picA2}|${A}|true`);
    expect(sql(`select count(*) from audit.outbox_events where event_type='customer_card.pic_transferred' and object_id='${id}'`)).toBe("1");

    // Fresh sessions read the new state: the new PIC may edit, the old one may not.
    const newPic = await (await signIn("picA2")).from(table).update({ notes: `E2E new PIC ${tag}` }).eq("id", id).select("id");
    expect(newPic.error).toBeNull();
    expect(newPic.data).toHaveLength(1);
    const oldPic = await (await signIn("picA1")).from(table).update({ notes: "E2E old PIC" }).eq("id", id).select("id");
    expect(oldPic.error?.message).toBe("You can only create or edit customer cards assigned to your own account.");
    expect(sql(`select notes from identity.${table} where id='${id}'`)).toBe(`E2E new PIC ${tag}`);
    // Shared reads are unchanged: the old PIC and the manager still see the card.
    expect((await (await signIn("picA1")).from(table).select("id").eq("id", id)).data).toHaveLength(1);
  });
}

test("B's cards were never moved by anyone acting in A", async () => {
  expect(sql(`select string_agg(owner_id::text, ',' order by id) from (select id, owner_id from identity.contacts where id='${card.contactB}' union all select id, owner_id from identity.accounts where id='${card.accountB}') x`))
    .toBe(`${ids.picB1},${ids.picB1}`);
  // Only the fixture inserts are audited: no transfer, no row update.
  expect(sql(`select count(*) from audit.audit_events where object_id in ('${card.contactB}','${card.accountB}') and action <> 'insert'`)).toBe("0");
});
