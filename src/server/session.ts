import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { PermissionKey, RoleKey } from "@/lib/rbac/matrix";

export interface AppSession {
  userId: string;
  email: string;
  fullName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  roleKey: RoleKey;
  roleLabel: string;
  defaultLocationId: string | null;
  timezone: string;
  currency: string;
  permissions: string[];
}

/** Where a signed-in account without an active membership is sent. Never /login: it bounces signed-in users to /. */
export const NO_ACCESS_PATH = "/no-access";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

function loadMembership(supabase: ServerSupabase, userId: string) {
  return Promise.all([
    supabase.rpc("my_membership").maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle(),
  ]);
}

/**
 * Resolves the signed-in user plus their workspace membership and permissions.
 * Cached per request. Returns null when there is no valid session or no
 * active membership (invite-only workspace).
 *
 * With no membership it first claims any pending invite for the account's
 * confirmed email. The auth trigger only does that when the account is
 * created, so an invite recorded for an existing account would otherwise never
 * take effect.
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let [{ data: membership }, { data: perms }, { data: profile }] = await loadMembership(supabase, user.id);
  if (!membership) {
    const { data: claim } = await supabase.rpc("claim_my_invites").maybeSingle();
    if (claim?.access !== "active" || !claim.claimed) return null;
    [{ data: membership }, { data: perms }, { data: profile }] = await loadMembership(supabase, user.id);
    if (!membership) return null;
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? user.email?.split("@")[0] ?? "User",
    workspaceId: membership.workspace_id,
    workspaceName: membership.workspace_name,
    workspaceSlug: membership.workspace_slug,
    roleKey: membership.role_key as RoleKey,
    roleLabel: membership.role_label,
    defaultLocationId: membership.default_location_id,
    timezone: membership.timezone,
    currency: membership.currency,
    permissions: (perms ?? []) as string[],
  };
});

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect(NO_ACCESS_PATH);
  return session;
}

export function hasPermission(session: AppSession, permission: PermissionKey) {
  return session.permissions.includes(permission);
}

export class PermissionError extends Error {
  constructor(public permission: PermissionKey) {
    super(`permission denied: ${permission}`);
  }
}

export async function requirePermission(permission: PermissionKey): Promise<AppSession> {
  const session = await requireSession();
  if (!hasPermission(session, permission)) throw new PermissionError(permission);
  return session;
}
