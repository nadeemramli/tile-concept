import { z } from "zod";
import { buildLeadInboxUrl } from "@/integrations/automation-intake";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

export const telegramCardSchema=z.object({
  lead_id:z.string(),token:z.string(),chat_id:z.string(),message_id:z.number().nullable(),
  name:z.string(),assignee:z.string(),status:z.string(),routing_reason:z.string().nullable(),customer_type:z.string().nullable(),
  whatsapp_sent_at:z.string().nullable(),customer_reply_at:z.string().nullable(),no_response_at:z.string().nullable(),follow_up_at:z.string().nullable(),
  last_customer_reply_at:z.string().nullable(),last_contact_attempt_at:z.string().nullable(),
  phone:z.string().nullable().optional(),
  email:z.string().nullable().optional(),company:z.string().nullable().optional(),
  interest:z.string().nullable().optional(),enquiry_message:z.string().nullable().optional(),
  project_stage:z.string().nullable().optional(),area:z.string().nullable().optional(),
  product_interest:z.array(z.string()).nullable().optional(),
  source:z.string().nullable().optional(),received_at:z.string().nullable().optional(),
});
export type TelegramCard=z.infer<typeof telegramCardSchema>;

const customerTypes:Record<string,string>={homeowner:"Homeowner / end user",designer:"Interior designer",contractor:"Contractor",business_owner:"Business owner"};
const sourceNames:Record<string,string>={facebook:"Facebook",instagram:"Instagram",meta:"Facebook / Instagram",tiktok:"TikTok",website:"Website",threads:"Threads"};
function clip(value:string,max:number) {return value.length>max ? value.slice(0,max-1)+"…" : value;}
function clean(value:string | null | undefined,max:number) {
  return clip((value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g,"").trim(),max);
}
function displayDate(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"}).format(date)+" MYT";
}
function formAnswers(message:string | null | undefined) {
  const answers=new Map<number,string>();let current:number | null=null;
  for(const line of (message ?? "").split(/\r?\n/)) {
    const match=line.match(/^conditional_question_(\d+)\s*:\s*(.*)$/i);
    if(match) {current=Number(match[1]);answers.set(current,match[2].trim());}
    else if(current!==null && line.trim()) answers.set(current,answers.get(current)+"\n"+line.trim());
  }
  return answers;
}

export function buildTelegramCard(card:TelegramCard,appUrl:string) {
  const statuses:Record<string,string>={new:"New",contact_attempted:"Awaiting reply",contacted:"Customer replied",qualified:"Qualified",converted:"Opportunity created",disqualified:"Disqualified",duplicate:"Duplicate"};
  const followUp=card.follow_up_at ? new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"}).format(new Date(card.follow_up_at)) : "Not scheduled";
  const latestReply=card.last_customer_reply_at ?? card.customer_reply_at;
  const unanswered=Boolean(card.no_response_at && (!latestReply || Date.parse(card.no_response_at)>Date.parse(latestReply)) && (!card.last_contact_attempt_at || Date.parse(card.no_response_at)>=Date.parse(card.last_contact_attempt_at)));
  const progress=unanswered ? "No response" : statuses[card.status] || card.status;
  const answers=formAnswers(card.enquiry_message);
  const request=clean(answers.get(3) || card.interest || (answers.size===0 ? card.enquiry_message : null),1300);
  const stage=clean(card.project_stage || answers.get(2),450);
  const type=clean(answers.get(1) || customerTypes[card.customer_type ?? ""] || card.customer_type,120) || "Not provided";
  const source=sourceNames[card.source ?? ""] || "Online enquiry";
  const contact=[`WhatsApp / phone: ${clean(card.phone,70) || "Not provided"}`,
    card.email && `Email: ${clean(card.email,180)}`,card.company && `Company: ${clean(card.company,180)}`].filter(Boolean);
  const details=[`Customer type: ${type}`,`Project stage: ${stage || "Not provided"}`,
    `Enquiry: ${request || "Not provided"}`,
    card.product_interest?.length && `Products: ${clean(card.product_interest.map(p=>p.replace(/_/g," ")).join(", "),200)}`,
    card.area && `Location: ${clean(card.area,160)}`,
    ...[...answers].filter(([key])=>key>3).slice(0,4).map(([key,value])=>`Other answer ${key}: ${clean(value,200)}`)].filter(Boolean);
  const footer=["📌 FOLLOW-UP",`Status: ${progress==="New" ? "New enquiry — awaiting first contact" : progress}`,
    `Next follow-up: ${followUp}${card.follow_up_at ? " MYT" : ""}`,
    card.last_contact_attempt_at && `Last contact: ${displayDate(card.last_contact_attempt_at)}`,
    latestReply && `Last customer reply: ${displayDate(latestReply)}`,
    "",`Source: ${source}${card.received_at ? ` · ${displayDate(card.received_at)}` : ""}`].filter(line=>line!==null && line!==undefined).join("\n");
  const body=["📩 CUSTOMER ENQUIRY",`Name: ${clean(card.name,140) || "New prospect"}`,
    `Assigned to: ${clean(card.assignee,120) || "Unassigned"}`,"","📞 CONTACT",...contact,"","💬 WHAT THEY NEED",...details].join("\n");
  // Keep follow-up and contact context even for unusually long form answers.
  const text=clip(body,3800-footer.length-2)+"\n\n"+footer;
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
