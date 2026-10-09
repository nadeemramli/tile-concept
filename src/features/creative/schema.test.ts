import { describe, expect, it } from "vitest";
import { creativeCalendarSchema, creativeCommandSchema, createCreativeSchema, durableUrlSchema } from "./schema";
const id = "aaaaaaaa-0000-0000-0000-000000000003";
describe("creative input boundaries", () => {
  it.each(["javascript:alert(1)", "file:///private.png", "https://user:password@example.test/asset", "https://example.test/asset?X-Amz-Signature=secret", "https://example.test/asset?sig=secret", "https://example.test/asset?token=secret"])("rejects unsafe or expiring links: %s", (url) => { expect(durableUrlSchema.safeParse(url).success).toBe(false); });
  it("accepts stable private provider links without fetching them", () => { expect(durableUrlSchema.parse("https://drive.google.com/file/d/synthetic/view?usp=sharing")).toContain("drive.google.com"); });
  it("permits a general creative with no fabricated identities", () => { const result = createCreativeSchema.parse({request_id:id,title:"Synthetic graphic",template:"graphic",source_mode:"no_filming",brief:{}}); expect(result.owner_id).toBeUndefined(); expect(result.content_opportunity_id).toBeUndefined(); });
  it("requires explicit export and reviewer-access confirmations", () => { expect(creativeCommandSchema.safeParse({action:"submit",id,expected_revision:1,request_id:id,data:{export_label:"Version1",review_url:"https://example.test/v1",final_url:"https://example.test/v1",access_confirmed:false,specific_export_confirmed:true}}).success).toBe(false); });
  it("accepts non-RFC PostgreSQL fixture UUIDs", () => { expect(createCreativeSchema.safeParse({request_id:id,title:"Synthetic",template:"graphic",source_mode:"no_filming",owner_id:id,brief:{}}).success).toBe(true); });
  it("validates actual calendar dates and exclusive bounded ranges", () => { expect(creativeCalendarSchema.safeParse({from:"2026-02-30",to:"2026-03-02"}).success).toBe(false); expect(creativeCalendarSchema.safeParse({from:"2026-09-01",to:"2026-09-01"}).success).toBe(false); expect(creativeCalendarSchema.safeParse({from:"2026-01-01",to:"2028-01-01"}).success).toBe(false); expect(creativeCalendarSchema.safeParse({from:"2026-12-28",to:"2027-01-04"}).success).toBe(true); });
});
