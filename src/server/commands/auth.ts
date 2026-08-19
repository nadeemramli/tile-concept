"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
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
