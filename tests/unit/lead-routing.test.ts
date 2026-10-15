import { describe,expect,it } from "vitest";
import { routingConfigSchema } from "@/features/lead-routing/schema";
import { buildTelegramCard, type TelegramCard } from "@/features/lead-routing/telegram-card";

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
    expect(result.text).toContain("Opening WhatsApp does not record a sent message");
  });
  it("removes progress controls from closed leads while retaining navigation",()=>{
    const result=buildTelegramCard({...card,status:"disqualified"},"https://example.test");
    expect(result.reply_markup.inline_keyboard.flat().some(b=>"callback_data" in b)).toBe(false);
    expect(result.reply_markup.inline_keyboard.flat().some(b=>b.text==="Open Inquiry")).toBe(true);
  });
  it("shows No response only until a newer customer reply is recorded",()=>{
    const unanswered={...card,status:"contacted",customer_reply_at:"2026-10-14T01:00:00Z",last_customer_reply_at:"2026-10-14T01:00:00Z",last_contact_attempt_at:"2026-10-15T01:00:00Z",no_response_at:"2026-10-15T01:00:00Z"};
    expect(buildTelegramCard(unanswered,"https://example.test").text).toContain("Progress: No response");
    expect(buildTelegramCard({...unanswered,last_customer_reply_at:"2026-10-16T01:00:00Z"},"https://example.test").text).toContain("Progress: Customer replied");
  });
});
