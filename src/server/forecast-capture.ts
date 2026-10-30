import "server-only";

import type { createServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { humanizeDbError } from "@/server/action-result";
import { captureToReviewInput, type ForecastCapture } from "@/features/forecast/schema";

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Records the forecast fields stated alongside another command (creating an
 * opportunity, issuing a quote, changing stage) as a forecast review. It runs
 * after that command has committed, so a forecast problem can never undo or
 * block it: on failure the caller reports the reason and the opportunity stays
 * in the review queues. Returns null when saved or when nothing was stated.
 */
export async function captureForecast(supabase: Supabase, opportunityId: string, context: "create" | "quote" | "stage", capture: ForecastCapture): Promise<string | null> {
  const stated = captureToReviewInput(capture);
  if (Object.keys(stated).length === 0) return null;
  const { data: o } = await supabase.from("opportunities").select("version").eq("id", opportunityId).maybeSingle();
  if (!o?.version) return "The opportunity could not be read to save its forecast.";
  const { error } = await supabase.rpc("review_opportunity_forecast", {
    p_opportunity_id: opportunityId,
    p_input: { ...stated, version: o.version, context } as Json,
    p_request_id: crypto.randomUUID(),
  });
  return error ? humanizeDbError(error.message) : null;
}

/** "Stage updated." → "Stage updated. Forecast not saved: … It is listed in Weekly forecast for review." */
export function withForecastNote(message: string, forecastError: string | null): string {
  return forecastError ? `${message} Forecast not saved: ${forecastError} It is listed in Weekly forecast for review.` : message;
}
