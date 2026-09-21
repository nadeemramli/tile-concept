import { describe, expect, it } from "vitest";
import { feedbackCaptureSchema, feedbackManageSchema, feedbackPhotoSchema } from "./schema";

const id = "11111111-0000-0000-0000-000000000001";
const capture = { visit_id: id, purchase_id: "", answers: ["Kitchen tiles", "Advice was useful", "", "The wait was long", ""], whatsapp_consent: true, photo_permission: false };
describe("showroom feedback validation", () => {
  it("accepts PostgreSQL fixture ids and critical answers without requiring a purchase", () => expect(feedbackCaptureSchema.safeParse(capture).success).toBe(true));
  it("requires one source, useful answers and WhatsApp consent", () => {
    expect(feedbackCaptureSchema.safeParse({ ...capture, purchase_id: id }).success).toBe(false);
    expect(feedbackCaptureSchema.safeParse({ ...capture, visit_id: "" }).success).toBe(false);
    expect(feedbackCaptureSchema.safeParse({ ...capture, whatsapp_consent: false }).success).toBe(false);
    expect(feedbackCaptureSchema.safeParse({ ...capture, answers: ["", "", "", "", ""] }).success).toBe(false);
  });
  it("requires evidence for review verification and corrections", () => {
    expect(feedbackManageSchema.safeParse({ request_id: id, action: "review_staff_verified", note: "" }).success).toBe(false);
    expect(feedbackManageSchema.safeParse({ request_id: id, action: "review_staff_verified", note: "Saw customer review on Google today" }).success).toBe(true);
    expect(feedbackManageSchema.safeParse({ request_id: id, action: "whatsapp_sent", note: "" }).success).toBe(true);
  });
  it("limits direct uploads to supported small photos", () => {
    const photo = { request_id: id, media_id: id, mime_type: "image/jpeg", size_bytes: 5 * 1024 * 1024 };
    expect(feedbackPhotoSchema.safeParse(photo).success).toBe(true);
    expect(feedbackPhotoSchema.safeParse({ ...photo, size_bytes: photo.size_bytes + 1 }).success).toBe(false);
    expect(feedbackPhotoSchema.safeParse({ ...photo, mime_type: "image/svg+xml" }).success).toBe(false);
  });
});
