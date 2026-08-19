"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient<Database, "api">> | undefined;

/** Browser client — used only for auth flows and explicitly reviewed islands. */
export function getBrowserSupabase() {
  if (!client) {
    client = createBrowserClient<Database, "api">(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
      db: { schema: "api" },
    });
  }
  return client;
}
