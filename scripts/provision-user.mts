/**
 * Create a staff account directly, without waiting on an invitation email.
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… \
 *     pnpm exec tsx scripts/provision-user.mts <email> <role> [--workspace <id>] [--location <id>]
 *
 *   # or against the local stack
 *   SUPABASE_URL=http://127.0.0.1:56321 SUPABASE_SECRET_KEY=$(supabase status -o env | …) \
 *     pnpm exec tsx scripts/provision-user.mts ops@example.com sales_rep
 *
 * Why this exists: the normal path is Platform → Settings → Invites, which sends
 * a Supabase Auth invitation email. The project has no custom SMTP, and the
 * default service is best-effort and effectively limited to the Supabase
 * organisation's own members, so an invite to a staff address may never arrive.
 * This provisions the same end state without depending on delivery.
 *
 * It does NOT bypass the authorization model. It writes a pending invite first,
 * then creates the auth user; core.handle_new_auth_user() sees the invite and
 * grants exactly the membership the invite names. The role still comes from
 * core.roles, and RLS is unchanged.
 *
 * The generated password is printed once. Hand it over out of band and have the
 * person change it at /auth/set-password on first sign-in.
 */

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROLES = [
  "admin",
  "management",
  "sales_manager",
  "sales_rep",
  "showroom",
  "marketing_coordinator",
  "catalog_pricing",
  "stock_coordinator",
  "analyst",
] as const;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const [email, role] = positional;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!email || !role) {
  die(
    "usage: provision-user.ts <email> <role> [--workspace <id>] [--location <id>]\n" +
      `  roles: ${ROLES.join(", ")}`,
  );
}
if (!ROLES.includes(role as (typeof ROLES)[number])) {
  die(`"${role}" is not a role. Use one of: ${ROLES.join(", ")}`);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die(`"${email}" is not an email address`);

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "api" },
});

// Resolve the workspace up front so the invite cannot land in the wrong one.
const { data: workspaces, error: wsError } = await admin.from("workspaces").select("id, name, slug");
if (wsError) die(`could not read workspaces: ${wsError.message}`);
const rows = (workspaces ?? []) as { id: string; name: string; slug: string }[];
const wanted = flag("workspace");
const workspace = wanted ? rows.find((w) => w.id === wanted) : rows.length === 1 ? rows[0] : undefined;
if (!workspace) {
  die(
    "the workspace is ambiguous — pass --workspace <id>. Available:\n" +
      rows.map((w) => `    ${w.id}  ${w.slug}`).join("\n"),
  );
}

console.log(`\n  target      ${url}`);
console.log(`  workspace   ${workspace.name} (${workspace.slug})`);
console.log(`  account     ${email} as ${role}\n`);

// A readable but high-entropy initial password: 32 hex characters.
const password = randomBytes(16).toString("hex");

// 1. The invite is what grants the role. Written first, because the trigger on
//    auth user creation reads it.
const { error: inviteError } = await admin.from("membership_invites").upsert(
  {
    workspace_id: workspace.id,
    email,
    role_key: role,
    default_location_id: flag("location") ?? null,
    status: "pending",
    accepted_at: null,
  },
  { onConflict: "workspace_id,email" },
);
if (inviteError) die(`could not record the invite: ${inviteError.message}`);

// 2. Creating the user fires core.handle_new_auth_user(), which creates the
//    profile and converts the pending invite into a membership.
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // no confirmation mail to wait on
});

if (createError) {
  if (/already registered|already been registered/i.test(createError.message)) {
    die(
      `${email} already has an account.\n` +
        "  To change their role, update the membership in Platform → Settings.\n" +
        "  To reset their password, use the Supabase dashboard or auth.admin.updateUserById.",
    );
  }
  die(`could not create the user: ${createError.message}`);
}

// 3. Confirm the trigger did its job rather than assuming it.
const { data: membership } = await admin
  .from("memberships")
  .select("role_key, status")
  .eq("workspace_id", workspace.id)
  .eq("user_id", created.user!.id)
  .maybeSingle();

if (!membership) {
  die(
    `the auth user was created (${created.user!.id}) but no membership appeared.\n` +
      "  Check core.handle_new_auth_user() and the invite row before handing out the password.",
  );
}

console.log(`  created     ${created.user!.id}`);
console.log(`  membership  ${(membership as { role_key: string }).role_key} / ${(membership as { status: string }).status}`);
console.log(`\n  initial password (shown once): ${password}`);
console.log("  Share it out of band and have them change it at /auth/set-password.\n");
