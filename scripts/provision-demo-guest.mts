/**
 * Create (or re-key) the shared account behind "Enter as guest".
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… pnpm exec tsx scripts/provision-demo-guest.mts
 *   …                                                                        --rotate
 *
 * Nothing needs to go into the environment afterwards. The application finds this
 * account by its guest membership and mints a one-time token for it with the
 * service key, so the password set below never signs anyone in — it exists only
 * because an account must have one.
 *
 * This does not bypass the authorization model. It creates an ordinary account
 * and an ordinary membership; core.enforce_guest_workspace() refuses the write
 * outright if that membership names anything but the demo workspace, or if this
 * account already holds a staff membership somewhere.
 *
 * `--rotate` sets a fresh password on an account that already exists. The app does
 * not use it, so this matters only if you also sign in as the guest by hand.
 */

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const GUEST_EMAIL = process.env.DEMO_GUEST_EMAIL ?? "guest@tileconcept.demo";
const rotate = process.argv.includes("--rotate");

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "api" },
});

// The demo workspace comes from the migration; if it is absent the migration has
// not been applied to this project and nothing below would be safe to guess at.
const { data: workspaces, error: wsError } = await admin.from("workspaces").select("id, name, slug");
if (wsError) die(`could not read workspaces: ${wsError.message}`);
const demo = ((workspaces ?? []) as { id: string; name: string; slug: string }[]).find((w) => w.slug === "demo");
if (!demo) die("no workspace with slug 'demo' — apply 20260823000001_guest_mode.sql first");

console.log(`\n  target      ${url}`);
console.log(`  workspace   ${demo.name} (${demo.slug})`);
console.log(`  account     ${GUEST_EMAIL} as guest\n`);

const password = randomBytes(16).toString("hex");

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: GUEST_EMAIL,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Guest" },
});

let userId = created?.user?.id;

if (createError) {
  if (!/already registered|already been registered/i.test(createError.message)) {
    die(`could not create the guest account: ${createError.message}`);
  }
  // Already there. Find it, and re-key only if asked.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) die(`the account exists but could not be looked up: ${listError.message}`);
  userId = list.users.find((u) => u.email?.toLowerCase() === GUEST_EMAIL.toLowerCase())?.id;
  if (!userId) die(`the account exists but was not found in the first page of users`);

  if (!rotate) {
    console.log(`  the guest account already exists (${userId}).`);
    console.log("  Re-run with --rotate to set a new password.\n");
  } else {
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
    if (updateError) die(`could not rotate the password: ${updateError.message}`);
    console.log(`  rotated     ${userId}`);
  }
}

// The membership is what actually grants access. Idempotent, and validated by
// core.enforce_guest_workspace() on the way in.
const { error: membershipError } = await admin
  .from("memberships")
  .upsert(
    { workspace_id: demo.id, user_id: userId, role_key: "guest", status: "active" },
    { onConflict: "workspace_id,user_id" },
  );
if (membershipError) die(`could not grant the guest membership: ${membershipError.message}`);

// Confirm rather than assume.
const { data: membership } = await admin
  .from("memberships")
  .select("role_key, status")
  .eq("workspace_id", demo.id)
  .eq("user_id", userId)
  .maybeSingle();
if (!membership) die(`no membership appeared for ${userId} — check core.enforce_guest_workspace()`);

const m = membership as { role_key: string; status: string };
console.log(`  membership  ${m.role_key} / ${m.status}`);

console.log("\n  Guest access is live. Nothing to add to the environment.\n");
