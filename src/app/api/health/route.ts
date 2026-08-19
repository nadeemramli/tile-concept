import { NextResponse } from "next/server";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, mode: publicEnv.appMode, supabaseConfigured: isSupabaseConfigured(), time: new Date().toISOString() });
}
