import { describe, expect, it } from "vitest";
import { classifyIntakePayload } from "./payload";

describe("classifyIntakePayload", () => {
  it("separates Meta field_data answers from ad metadata and keeps __unmapped questions", () => {
    const { answers, technical } = classifyIntakePayload({
      field_data: [
        { name: "What is your renovation area?", values: ["Kitchen"] },
        { name: "full_name", values: ["Aisha Rahman"] },
      ],
      ad_id: "1200987",
      campaign_name: "Spring promo",
      utm_source: "facebook",
      __unmapped: { budget_range: "RM10k-20k" },
    });
    expect(answers.map((a) => a.key)).toEqual(["what_is_your_renovation_area", "full_name", "budget_range"]);
    expect(answers[0]).toMatchObject({ label: "What Is Your Renovation Area", value: "Kitchen" });
    expect(technical.map((t) => t.key)).toEqual(["ad_id", "campaign_name", "utm_source"]);
  });

  it("flattens TikTok answer lists and hides form plumbing", () => {
    const { answers, technical } = classifyIntakePayload({
      answers: [{ field_name: "Which product?", answer: "Wall panel" }],
      form_id: "f-991",
      create_time: 1756900000,
    });
    expect(answers).toEqual([{ key: "which_product", label: "Which Product", value: "Wall panel" }]);
    expect(technical.map((t) => t.key)).toEqual(["create_time", "form_id"]);
  });

  it("classifies the automation intake contract: contact answers stay, ids and consent go technical", () => {
    const { answers, technical } = classifyIntakePayload({
      submission_id: "sub-1",
      source: "tiktok",
      name: "Farid",
      phone: "+60123456789",
      message: "Need mosaic for a pool",
      area: "Shah Alam",
      form_name: "Pool leads",
      campaign_id: "c-8",
      consent_version: "2026-01",
    });
    expect(answers.map((a) => a.key)).toEqual(["name", "phone", "message", "area"]);
    expect(technical.map((t) => t.key)).toEqual(["campaign_id", "consent_version", "form_name", "source", "submission_id"]);
  });

  it("drops empty values and handles an empty payload", () => {
    expect(classifyIntakePayload({})).toEqual({ answers: [], technical: [] });
    const { answers, technical } = classifyIntakePayload({ note: "", company: null, extra: undefined });
    expect(answers).toEqual([]);
    expect(technical).toEqual([]);
  });

  it("joins array answers into one readable value", () => {
    const { answers } = classifyIntakePayload({ field_data: [{ name: "Products", values: ["Tile", "Mosaic"] }] });
    expect(answers[0]?.value).toBe("Tile, Mosaic");
  });
});
