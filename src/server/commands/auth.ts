"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

export type AuthResult = { ok: true; message?: string } | { ok: false; error: string };

const credentials = z.object({ email: z.string().email(), password: z.string().min(8) });

export async function signInWithPasswordAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and a password of at least 8 characters." };
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: error.message };
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") ? next : "/");
}

async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : publicEnv.appUrl;
}

export async function signInWithMagicLinkAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const email = z.string().email().safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: "Enter a valid email." };
  const supabase = await createServerSupabase();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=/` },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Check your inbox for a sign-in link. Only invited addresses can sign in." };
}

/**
 * Enter the demo workspace without an account of your own.
 *
 * This is a real sign-in, not a bypass. The server mints a one-time token for the
 * shared demo account and redeems it on the visitor's own client, which is what
 * writes the session cookies. From that moment the session is an ordinary session
 * — RLS, the `api.*` views and every Server Action treat a guest exactly as they
 * treat staff, and a guest's writes persist because they are ordinary writes.
 *
 * There is nothing to configure. The account is whichever one holds the guest
 * membership, read from the database at request time.
 *
 * That account cannot reach real data even if this file is wrong:
 * `core.enforce_guest_workspace()` refuses to let a guest membership name any
 * workspace but the demo one, or to let a guest account hold a second, non-guest
 * membership.
 */
export async function enterAsGuestAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const admin = createAdminSupabase();

  // Who the guest is comes from the database, not from configuration. The demo
  // workspace holds exactly one guest membership, and core.enforce_guest_workspace()
  // is what guarantees that account is a guest and nothing else — so the account
  // that membership names is safe to sign in as by definition.
  //
  // This deliberately replaced a DEMO_GUEST_EMAIL/PASSWORD pair. A password is a
  // second secret to store, rotate and keep in step across three environments,
  // and forgetting it produced exactly one symptom: a button that said guest
  // access was not configured. There is nothing to configure now.
  const { data: membership, error: lookupError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("role_key", "guest")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (lookupError) return { ok: false, error: "Guest access is unavailable right now." };
  if (!membership?.user_id) {
    return { ok: false, error: "This environment has no demo workspace to enter." };
  }

  const { data: guestUser } = await admin.auth.admin.getUserById(membership.user_id);
  const email = guestUser?.user?.email;
  if (!email) return { ok: false, error: "Guest access is unavailable right now." };

  // Mint a one-time token for that account and redeem it on the request's own
  // client, which is what writes the session cookies. No password is involved,
  // and no email is sent — generateLink only generates.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    return { ok: false, error: "Guest access is unavailable right now." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (error) return { ok: false, error: "Guest access is unavailable right now." };

  // Confirm through the session's own view of itself, not through the admin
  // client that chose the account. If this is ever anything but a guest, the
  // membership lookup above found a row it should not have, and the right move is
  // to end the session rather than hand it to a visitor.
  const { data: session } = await supabase.rpc("my_membership").maybeSingle();
  if (!session || session.role_key !== "guest") {
    await supabase.auth.signOut();
    return { ok: false, error: "Guest access is not configured correctly in this environment." };
  }

  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") ? next : "/");
}

export async function updatePasswordAction(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const pw = z.string().min(10).safeParse(formData.get("password"));
  if (!pw.success) return { ok: false, error: "Password must be at least 10 characters." };
  if (formData.get("confirm") !== pw.data) return { ok: false, error: "Passwords do not match." };
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { ok: false, error: error.message };
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
