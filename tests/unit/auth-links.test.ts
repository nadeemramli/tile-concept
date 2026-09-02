import { describe, expect, it } from "vitest";

import { emailLinkErrorMessage, safeAuthNext, shouldResendSignupConfirmation } from "@/lib/auth-links";

describe("invite-only email access", () => {
  it("falls back to resending confirmation only for an unconfirmed invite", () => {
    expect(shouldResendSignupConfirmation({ code: "signup_disabled" })).toBe(true);
    expect(shouldResendSignupConfirmation({ code: "otp_disabled" })).toBe(true);
    expect(shouldResendSignupConfirmation({ message: "Email not confirmed" })).toBe(true);
    expect(shouldResendSignupConfirmation({ code: "over_email_send_rate_limit" })).toBe(false);
  });

  it("keeps post-authentication redirects inside the application", () => {
    expect(safeAuthNext("/sales/pipeline?view=mine")).toBe("/sales/pipeline?view=mine");
    expect(safeAuthNext("//evil.example/path")).toBe("/");
    expect(safeAuthNext("https://evil.example/path")).toBe("/");
    expect(safeAuthNext(null, "/auth/set-password")).toBe("/auth/set-password");
  });

  it("turns provider rate-limit details into a useful message", () => {
    expect(emailLinkErrorMessage({ code: "over_email_send_rate_limit" })).toContain("wait a minute");
  });
});
