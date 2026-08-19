import "server-only";

import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export interface StageRef {
  key: string;
  label: string;
  position: number;
  reporting_group: "open" | "won" | "lost" | "deferred";
  requires_reason: boolean;
  requires_next_action: boolean;
}

export const getStages = cache(async (): Promise<StageRef[]> => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("opportunity_stages").select("key, label, position, reporting_group, requires_reason, requires_next_action").eq("is_active", true).order("position");
  return (data ?? []) as StageRef[];
});

export interface ProfileRef {
  user_id: string;
  full_name: string;
  email: string;
  role_key?: string;
}

/** Workspace members (for owner/assignee pickers and labels). */
export const getMembers = cache(async (): Promise<ProfileRef[]> => {
  const supabase = await createServerSupabase();
  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, email"),
    supabase.from("memberships").select("user_id, role_key, status"),
  ]);
  const roleByUser = new Map((memberships ?? []).filter((m) => m.status === "active").map((m) => [m.user_id, m.role_key]));
  return (profiles ?? [])
    .filter((p) => p.user_id && roleByUser.has(p.user_id))
    .map((p) => ({ user_id: p.user_id!, full_name: p.full_name ?? p.email ?? "Unknown", email: p.email ?? "", role_key: roleByUser.get(p.user_id!) ?? undefined }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
});

export const getMemberMap = cache(async () => {
  const members = await getMembers();
  return new Map(members.map((m) => [m.user_id, m]));
});

export const getLocations = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("business_locations").select("id, code, name, kind").eq("is_active", true).order("name");
  return (data ?? []).map((l) => ({ id: l.id!, code: l.code!, name: l.name!, kind: l.kind! }));
});

export const getSavedViews = cache(async (surface: string) => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("saved_views").select("id, name, filters, is_default, position, user_id").eq("surface", surface).order("position");
  return (data ?? []).map((v) => ({ id: v.id!, name: v.name!, filters: (v.filters ?? {}) as Record<string, unknown>, is_default: !!v.is_default, shared: v.user_id === null }));
});

export const getCategories = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("product_categories").select("id, key, label, position").eq("is_active", true).order("position");
  return (data ?? []).map((c) => ({ id: c.id!, key: c.key!, label: c.label! }));
});

export const getBrands = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("brands").select("id, name, supplier_id, is_house_brand").order("name");
  return (data ?? []).map((b) => ({ id: b.id!, name: b.name!, supplier_id: b.supplier_id, is_house_brand: !!b.is_house_brand }));
});

export const getUnits = cache(async () => {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("units_of_measure").select("id, code, label, kind").order("code");
  return (data ?? []).map((u) => ({ id: u.id!, code: u.code!, label: u.label!, kind: u.kind! }));
});
