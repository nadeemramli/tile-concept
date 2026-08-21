/**
 * Invite a user to the workspace via Supabase Auth (server-side only).
 * Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... APP_URL=https://... pnpm exec tsx scripts/invite-user.mts m.nadeemramli@gmail.com
 * The membership role comes from core.membership_invites (seeded: admin for the owner email);
 * for others, insert an invite row first (Platform → Settings → Invites does both).
 */
import { createClient } from "@supabase/supabase-js";

const [email] = process.argv.slice(2);
if (!email) {
  console.error("usage: invite-user.ts <email>");
  process.exit(1);
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/auth/confirm?next=/auth/set-password` });
if (error) {
  console.error("invite failed:", error.message);
  process.exit(1);
}
console.log("invited", data.user?.email, data.user?.id);
