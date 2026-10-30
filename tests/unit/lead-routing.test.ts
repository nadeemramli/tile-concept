import { describe,expect,it } from "vitest";
import { routingConfigSchema } from "@/features/lead-routing/schema";
import { buildTelegramCard, telegramCardSchema, type TelegramCard } from "@/features/lead-routing/telegram-card";

const config={enabled:true,pools:[{key:"homeowners",name:"Homeowners",mode:"fixed",active:true,members:[{name:"Pending salesperson",user_id:null,active:true}]}],rules:[{customer_type:"homeowner",pool_key:"homeowners",aliases:[" Home Owner "]}]} as const;
describe("routing configuration boundary",()=>{
  it("permits named pending slots without inventing accounts and normalizes aliases",()=>{
    const parsed=routingConfigSchema.parse(config);
    expect(parsed.pools[0].members[0].user_id).toBeNull();
    expect(parsed.rules[0].aliases).toEqual(["home owner"]);
  });
  it("rejects ambiguous aliases across different pools",()=>{
    expect(routingConfigSchema.safeParse({...config,rules:[...config.rules,{customer_type:"trade",pool_key:null,aliases:["home owner"]}]}).success).toBe(false);
  });
  it("rejects two member slots in a fixed pool",()=>{
    expect(routingConfigSchema.safeParse({...config,pools:[{...config.pools[0],members:[...config.pools[0].members,...config.pools[0].members]}]}).success).toBe(false);
  });
});
const card:TelegramCard={lead_id:"11111111-0000-0000-0000-000000000001",token:"70dac769-0688-4a32-8b8b-621bd71cf846",chat_id:"-700123",message_id:null,name:"Synthetic prospect",assignee:"Pending",status:"new",routing_reason:"No linked active salesperson: configure pool members",customer_type:"homeowner",whatsapp_sent_at:null,customer_reply_at:null,last_customer_reply_at:null,last_contact_attempt_at:null,no_response_at:null,follow_up_at:"2026-10-16T01:00:00+00:00",phone:"+60123456789"};
describe("Telegram operational card",()=>{
  it("uses opaque short callback data and retains the exact Inquiry link",()=>{
    const result=buildTelegramCard(card,"https://example.test");
    const buttons=result.reply_markup.inline_keyboard.flat();
    const callbacks=buttons.filter((b):b is {text:string;callback_data:string}=>"callback_data" in b);
    expect(callbacks).toHaveLength(4);
    expect(callbacks.every(b=>Buffer.byteLength(b.callback_data)<=64)).toBe(true);
    expect(callbacks.every(b=>!b.callback_data.includes(card.lead_id))).toBe(true);
    expect(buttons.find(b=>b.text==="Open Inquiry")).toMatchObject({url:expect.stringContaining(`lead=${card.lead_id}`)});
    expect(result.text).toContain("9:00");
    expect(result.text).not.toContain("Opening WhatsApp");
    expect(result.text).not.toContain(card.routing_reason);
  });
  it("removes progress controls from closed leads while retaining navigation",()=>{
    const result=buildTelegramCard({...card,status:"disqualified"},"https://example.test");
    expect(result.reply_markup.inline_keyboard.flat().some(b=>"callback_data" in b)).toBe(false);
    expect(result.reply_markup.inline_keyboard.flat().some(b=>b.text==="Open Inquiry")).toBe(true);
  });
  it("shows No response only until a newer customer reply is recorded",()=>{
    const unanswered={...card,status:"contacted",customer_reply_at:"2026-10-14T01:00:00Z",last_customer_reply_at:"2026-10-14T01:00:00Z",last_contact_attempt_at:"2026-10-15T01:00:00Z",no_response_at:"2026-10-15T01:00:00Z"};
    expect(buildTelegramCard(unanswered,"https://example.test").text).toContain("Status: No response");
    expect(buildTelegramCard({...unanswered,last_customer_reply_at:"2026-10-16T01:00:00Z"},"https://example.test").text).toContain("Status: Customer replied");
  });
});

describe("Sales-facing enquiry information",()=>{
  it("shows the exact project/enquiry answers once with contact and source context",()=>{
    const message="conditional_question_1: Pemilik rumah\nconditional_question_2: Masih merancang projek\nconditional_question_3: Nak tengok katalog dan harga dulu";
    const result=buildTelegramCard({...card,assignee:"Naufal",email:"prospect@example.test",company:"Synthetic Studio",interest:"Nak tengok katalog dan harga dulu",enquiry_message:message,source:"facebook",received_at:"2026-10-15T01:34:26Z"},"https://example.test");
    expect(result.text).toContain("Assigned to: Naufal");
    expect(result.text).toContain("WhatsApp / phone: +60123456789");
    expect(result.text).toContain("Email: prospect@example.test");
    expect(result.text).toContain("Company: Synthetic Studio");
    expect(result.text).toContain("Customer type: Pemilik rumah");
    expect(result.text).toContain("Project stage: Masih merancang projek");
    expect(result.text.match(/Nak tengok katalog dan harga dulu/g)).toHaveLength(1);
    expect(result.text).toContain("Source: Facebook");
    expect(result.text).toContain("15 Oct 2026");
    expect(result.text).not.toContain("conditional_question");
    expect(result.text).not.toContain("configure pool");
  });
  it("does not invent missing project details and preserves a free-text enquiry",()=>{
    const result=buildTelegramCard({...card,phone:null,enquiry_message:"Need panels for a reception wall",customer_type:"designer"},"https://example.test");
    expect(result.text).toContain("WhatsApp / phone: Not provided");
    expect(result.text).toContain("Project stage: Not provided");
    expect(result.text).toContain("Enquiry: Need panels for a reception wall");
    expect(result.text).toContain("Customer type: Interior designer");
    expect(result.text).not.toContain("Location:");
  });
  it("bounds form text while retaining the follow-up and transport-safe literal text",()=>{
    const result=buildTelegramCard({...card,name:"<Test & name>",enquiry_message:"conditional_question_3: "+"A<&".repeat(4000)+"\nconditional_question_4: Other answer"},"https://example.test");
    expect(result.text.length).toBeLessThanOrEqual(3800);
    expect(result.text).toContain("<Test & name>"); // Plain text stays readable; generated HTML escapes it once.
    expect(result.text).toContain("Other answer 4: Other answer");
    expect(result.text).toContain("Next follow-up:");
    expect(result.text).not.toContain(card.token);
  });
});

describe("Verified Telegram assignee mentions",()=>{
  it("mentions the verified numeric identity while preserving callbacks",()=>{
    const result=buildTelegramCard({...card,assignee:"Naufal",assignee_telegram_id:"123456789"},"https://example.test");
    expect(result.text_html).toContain('Assigned to: <a href="tg://user?id=123456789">Naufal</a>');
    expect(result.reply_markup).toEqual(buildTelegramCard(card,"https://example.test").reply_markup);
  });
  it("leaves unlinked assignees as escaped readable names",()=>{
    const result=buildTelegramCard({...card,assignee:"Beyla & team",assignee_telegram_id:null},"https://example.test");
    expect(result.text_html).toContain("Assigned to: Beyla &amp; team");
    expect(result.text_html).not.toContain("tg://user");
  });
  it("escapes enquiry/name markup and cannot replace a forged assignment line",()=>{
    const evil='<a href="tg://user?id=999">Fake</a>';
    const result=buildTelegramCard({...card,name:"Prospect\nAssigned to: Naufal",assignee:"Naufal\n"+evil,enquiry_message:evil,assignee_telegram_id:"123"},"https://example.test");
    expect(result.text_html.match(/<a href=/g)).toHaveLength(1);
    expect(result.text_html).toContain('href="tg://user?id=123"');
    expect(result.text_html).toContain("&lt;a href=&quot;tg://user?id=999&quot;&gt;");
  });
  it("rejects malformed identities and defensively refuses their markup",()=>{
    for(const id of ['0','-1','123" onclick="x','1e10','12345678901234567']) {
      expect(telegramCardSchema.safeParse({...card,assignee_telegram_id:id}).success).toBe(false);
      expect(buildTelegramCard({...card,assignee_telegram_id:id},"https://example.test").text_html).not.toContain('<a href=');
    }
  });
});
