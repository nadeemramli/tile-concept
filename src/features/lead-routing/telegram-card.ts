import { z } from "zod";
import { buildLeadInboxUrl } from "@/integrations/automation-intake";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

export const telegramCardSchema=z.object({
  lead_id:z.string(),token:z.string(),chat_id:z.string(),message_id:z.number().nullable(),
  name:z.string(),assignee:z.string(),status:z.string(),routing_reason:z.string().nullable(),customer_type:z.string().nullable(),
  whatsapp_sent_at:z.string().nullable(),customer_reply_at:z.string().nullable(),no_response_at:z.string().nullable(),follow_up_at:z.string().nullable(),
  last_customer_reply_at:z.string().nullable(),last_contact_attempt_at:z.string().nullable(),
  phone:z.string().nullable().optional(),
});
export type TelegramCard=z.infer<typeof telegramCardSchema>;

export function buildTelegramCard(card:TelegramCard,appUrl:string) {
  const statuses:Record<string,string>={new:"New",contact_attempted:"Awaiting reply",contacted:"Customer replied",qualified:"Qualified",converted:"Opportunity created",disqualified:"Disqualified",duplicate:"Duplicate"};
  const followUp=card.follow_up_at ? new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"}).format(new Date(card.follow_up_at)) : "Not scheduled";
  const latestReply=card.last_customer_reply_at ?? card.customer_reply_at;
  const unanswered=Boolean(card.no_response_at && (!latestReply || Date.parse(card.no_response_at)>Date.parse(latestReply)) && (!card.last_contact_attempt_at || Date.parse(card.no_response_at)>=Date.parse(card.last_contact_attempt_at)));
  const progress=unanswered ? "No response" : statuses[card.status] || card.status;
  const text=[`New inquiry: ${card.name}`,`Assigned to: ${card.assignee}`,`Customer type: ${card.customer_type || "Needs review"}`,
    `Progress: ${progress}`,card.routing_reason,`Follow-up: ${followUp} (Malaysia time)`,
    card.whatsapp_sent_at ? "WhatsApp sent: recorded" : null,card.customer_reply_at ? "Customer reply: recorded" : null,
    "Use progress buttons after the action happens. Opening WhatsApp does not record a sent message."].filter(Boolean).join("\n").slice(0,3800);
  const action=(label:string,key:string)=>({text:label,callback_data:`tc:${card.token}:${key}`});
  const links=[{text:"Open Inquiry",url:buildLeadInboxUrl(appUrl,card.lead_id)}];
  const whatsapp=buildWhatsAppUrl(card.phone ?? undefined, "");
  if(whatsapp) links.push({text:"Open WhatsApp",url:whatsapp});
  const closed=["disqualified","duplicate"].includes(card.status);
  return {...card,text,lead_url:buildLeadInboxUrl(appUrl,card.lead_id),whatsapp_url:whatsapp,reply_markup:{inline_keyboard:[...(closed?[]:[
    [action("WhatsApp sent","sent"),action("Customer replied","reply")],
    [action("No response","none"),action("Follow up tomorrow · 9am","tomorrow")],
  ]),links]}};
}
