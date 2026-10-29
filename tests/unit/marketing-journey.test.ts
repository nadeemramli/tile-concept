import { describe, expect, it } from "vitest";
import { customerSegment, sumJourney, type JourneyGroup } from "@/features/reports/journey-schema";
describe("marketing reporting",()=>{
 it("keeps unknown classifications visible instead of assuming B2B",()=>{expect(customerSegment("business_owner")).toBe("B2B");expect(customerSegment("homeowner")).toBe("B2C");expect(customerSegment("other")).toBe("Unknown");expect(customerSegment("new_type")).toBe("Unknown");});
 it("separates converted leads from multiple invoice documents",()=>{const group:JourneyGroup={platform:"meta",customer_type:"contractor",leads:5,contacted:4,replied:3,converted_leads:1,contacted_replied:3,replied_converted:1,invoices:2,invoice_value:1200};expect(sumJourney([group,{...group,platform:"tiktok"}])).toMatchObject({leads:10,invoices:4,converted_leads:2,invoice_value:2400});expect(sumJourney([]).leads).toBe(0);});
});
