import { describe, expect, it } from "vitest";
import { changeStageSchema, addQuoteVersionSchema } from "@/features/pipeline/schema";
import { captureToReviewInput, reviewForecastSchema } from "./schema";
import { FORECAST_BAND, FORECAST_QUEUE } from "@/lib/domain/status-maps";
import { FORECAST_QUEUES } from "./schema";

const base = {
  opportunity_id: "eeeeeeee-0700-0000-0000-000000000001",
  version: "3",
  request_id: "dddddddd-0700-0000-0000-00000000aa01",
  currency: "myr",
  next_action: "Call the contractor",
  next_action_due_at: "2026-11-03T10:00",
};

describe("forecast review input", () => {
  it("keeps blank fields unknown instead of defaulting them", () => {
    const r = reviewForecastSchema.parse({ ...base, expected_close_date: "", probability_band: "__none__", estimated_value: "", evidence: "" });
    expect(r.expected_close_date).toBeNull();
    expect(r.probability_band).toBeNull();
    expect(r.estimated_value).toBeNull();
    expect(r.evidence).toBeNull();
    expect(r.currency).toBe("MYR");
  });

  it("keeps a stated zero value as zero", () => {
    expect(reviewForecastSchema.parse({ ...base, estimated_value: "0" }).estimated_value).toBe(0);
  });

  it("accepts only the defined bands, with no percentage", () => {
    expect(reviewForecastSchema.parse({ ...base, probability_band: "high" }).probability_band).toBe("high");
    expect(reviewForecastSchema.safeParse({ ...base, probability_band: "0.7" }).success).toBe(false);
  });

  it("rejects impossible dates and negative values", () => {
    expect(reviewForecastSchema.safeParse({ ...base, expected_close_date: "2026-02-30" }).success).toBe(false);
    expect(reviewForecastSchema.safeParse({ ...base, estimated_value: "-1" }).success).toBe(false);
  });

  it("requires a next step", () => {
    expect(reviewForecastSchema.safeParse({ ...base, next_action: " " }).success).toBe(false);
  });
});

describe("forecast capture at stage change and quote follow-up", () => {
  it("is optional: the stage and quote forms validate without any forecast", () => {
    expect(changeStageSchema.safeParse({ opportunity_id: base.opportunity_id, to_stage_key: "quote_sent" }).success).toBe(true);
    expect(addQuoteVersionSchema.safeParse({ opportunity_id: base.opportunity_id, quote_number: "QT-2026-0001" }).success).toBe(true);
  });

  it("applies only the fields that were filled in", () => {
    const v = changeStageSchema.parse({ opportunity_id: base.opportunity_id, to_stage_key: "quote_sent", forecast_close_date: "", forecast_band: "medium", forecast_evidence: "" });
    expect(captureToReviewInput(v)).toEqual({ probability_band: "medium" });
    expect(captureToReviewInput({})).toEqual({});
  });
});

describe("forecast vocabulary", () => {
  it("explains every band and list", () => {
    for (const k of ["high", "medium", "low", "unknown"]) expect(FORECAST_BAND[k]?.hint).toBeTruthy();
    for (const q of FORECAST_QUEUES) expect(FORECAST_QUEUE[q]?.hint).toBeTruthy();
  });
});
