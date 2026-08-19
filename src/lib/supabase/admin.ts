import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. Server-only, used for administrative operations such as
 * inviting users. Never import from a client component; never expose the key.
 */
export function createAdminSupabase() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient<Database, "api">(publicEnv.supabaseUrl, secret, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
