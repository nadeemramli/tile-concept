import { z } from "zod";
const n = z.number();
export const journeySchema = z.object({
 groups: z.array(z.object({platform:z.string(),customer_type:z.string(),leads:n,contacted:n,replied:n,converted_leads:n,replied_converted:n,contacted_replied:n,invoices:n,invoice_value:n})),
 days:z.array(z.object({day:z.string(),spend:n,leads:n})),
 gaps:z.object({unlinked_invoices:n,external_invoice_links:n,unclassified_documents:n}),
});
export type Journey = z.infer<typeof journeySchema>;
export type JourneyGroup = Journey["groups"][number];
export function customerSegment(type:string) {
 if(type === "homeowner") return "B2C";
 if(["contractor","designer","architect","developer","retailer","business_owner"].includes(type)) return "B2B";
 return "Unknown";
}
export function sumJourney(groups:JourneyGroup[]) {
 return groups.reduce((a,g)=>({leads:a.leads+g.leads,contacted:a.contacted+g.contacted,replied:a.replied+g.replied,converted_leads:a.converted_leads+g.converted_leads,invoices:a.invoices+g.invoices,invoice_value:a.invoice_value+g.invoice_value,contacted_replied:a.contacted_replied+g.contacted_replied,replied_converted:a.replied_converted+g.replied_converted}),{leads:0,contacted:0,replied:0,converted_leads:0,invoices:0,invoice_value:0,contacted_replied:0,replied_converted:0});
}

export const metaStatusSchema=z.array(z.object({account_id:z.string(),last_attempt_at:z.string(),last_success_at:z.string().nullable(),last_error:z.string().nullable(),last_from:z.string().nullable(),last_to:z.string().nullable()}));
export type MetaStatus=z.infer<typeof metaStatusSchema>;
