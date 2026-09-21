import { describe, expect, it } from "vitest";
import { googleDestination, isGoogleListingLink } from "@/features/feedback/google-destination";
describe("Google handoff destinations", () => {
  it("accepts a Google listing without claiming it is a direct review form", () => { expect(googleDestination("https://share.google/syntheticListing")).toBe("https://share.google/syntheticListing"); expect(isGoogleListingLink("https://share.google/syntheticListing")).toBe(true); });
  it("retains configured direct review destinations", () => { expect(googleDestination("https://search.google.com/local/writereview?placeid=synthetic")).toContain("placeid=synthetic"); expect(isGoogleListingLink("https://search.google.com/local/writereview?placeid=synthetic")).toBe(false); });
  it("rejects deceptive hosts, insecure schemes and credentials", () => { for (const value of ["https://google.com.evil.test/review", "http://google.com/review", "https://google.com@evil.test/", "https://user@google.com/", "javascript:alert(1)", "https://share.google:8443/abc"]) expect(googleDestination(value)).toBeNull(); });
  it("leaves an absent destination unconfigured", () => expect(googleDestination("")).toBeNull());
});
