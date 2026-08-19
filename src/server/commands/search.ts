"use server";

import { createServerSupabase } from "@/lib/supabase/server";

export interface SearchHit {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string | null;
  href: string;
  score: number;
}

export async function globalSearchAction(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("global_search", { p_query: q, p_limit: 30 });
  if (error) return [];
  return (data ?? []) as SearchHit[];
}
