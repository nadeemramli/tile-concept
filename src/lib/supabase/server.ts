import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";

export type ServerSupabase = ReturnType<typeof createServerClient<Database, "api">>;

/**
 * Cookie-session Supabase client for Server Components, Server Actions and
 * Route Handlers. Talks to the exposed `api` schema; RLS applies as the user.
 */
export async function createServerSupabase(): Promise<ServerSupabase> {
  const cookieStore = await cookies();
  return createServerClient<Database, "api">(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    db: { schema: "api" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}
