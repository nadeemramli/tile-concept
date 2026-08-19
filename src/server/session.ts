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

/**
 * Resolves the signed-in user plus their workspace membership and permissions.
 * Cached per request. Returns null when there is no valid session or no
 * active membership (invite-only workspace).
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: membership }, { data: perms }, { data: profile }] = await Promise.all([
    supabase.rpc("my_membership").maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!membership) return null;

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
  if (!session) redirect("/login?reason=no-membership");
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
