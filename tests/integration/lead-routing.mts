/** Local-only real HTTP/database journey. Never sends a Telegram message. */
import assert from "node:assert/strict";
import { createHmac,createHash,randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

const dbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL!;
assert.ok(["localhost","127.0.0.1"].includes(new URL(dbUrl).hostname),"Local synthetic database required");
const app=process.env.NEXT_PUBLIC_APP_URL!;
assert.ok(["localhost","127.0.0.1"].includes(new URL(app).hostname),"Local app required");
const ws="11111111-1111-1111-1111-111111111111";
const db=createClient<Database,"api">(dbUrl,process.env.SUPABASE_SERVICE_ROLE_KEY!,{db:{schema:"api"},auth:{persistSession:false}});
const member=createClient<Database,"api">(dbUrl,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{db:{schema:"api"},auth:{persistSession:false}});
const login=await member.auth.signInWithPassword({email:"demo.rep1@tileconcept.test",password:"TileDemo!2026"});
assert.ifError(login.error);
async function post(path:string,body:unknown){
 const raw=JSON.stringify(body),stamp=Math.floor(Date.now()/1000).toString();
 const signature=createHmac("sha256",process.env.N8N_INTAKE_SECRET!).update(`${stamp}.${raw}`).digest("hex");
 const response=await fetch(app+path,{method:"POST",headers:{"content-type":"application/json","x-tc-timestamp":stamp,"x-tc-signature":`sha256=${signature}`},body:raw,signal:AbortSignal.timeout(60000)});
 const result=await response.json();assert.ok(response.ok,`HTTP ${response.status}: ${result.error}`);return result;
}
const existing=await db.from("telegram_sales_channels").select("workspace_id").eq("workspace_id",ws).maybeSingle();assert.ifError(existing.error);
if(!existing.data){const r=await db.from("telegram_sales_channels").insert({workspace_id:ws,chat_id:-700123});assert.ifError(r.error);}
const run=randomUUID();
const inputs=Array.from({length:12},(_,n)=>({submission_id:`tile25-e2e-${run}-${n}`,source:"facebook",customer_type:"Pereka dalaman",name:`Synthetic routing E2E ${n}`,email:`tile25-${run}-${n}@example.test`}));
const leads=await Promise.all(inputs.map(v=>post("/api/intake/automation",v)));
assert.ok(leads.every(v=>v.lead_id&&!v.duplicate));
const ids=leads.map(v=>v.lead_id as string);
const rows=await db.from("leads").select("id,owner_id").in("id",ids);assert.ifError(rows.error);
const counts=new Map<string,number>();for(const row of rows.data!){assert.ok(row.owner_id);counts.set(row.owner_id,(counts.get(row.owner_id)||0)+1);}
assert.deepEqual([...counts.values()].sort(),[4,4,4],"12 concurrent leads distribute equally");
const duplicates=await Promise.all([post("/api/intake/automation",inputs[0]),post("/api/intake/automation",inputs[0])]);
assert.ok(duplicates.every(v=>v.duplicate&&v.lead_id===leads[0].lead_id));
const uid="aaaaaaaa-0000-0000-0000-000000000003";
const lead=rows.data!.find(r=>r.owner_id===uid)!;assert.ok(lead);
const leadId=lead.id;assert.ok(leadId);
const linkToken=randomUUID();const link=await member.rpc("begin_telegram_link",{p_token_hash:createHash("sha256").update(linkToken).digest("hex")});assert.ifError(link.error);
const updateBase=Math.floor(Date.now()/10);
const linked=await post("/api/intake/telegram",{operation:"update",update:{update_id:updateBase,message:{from:{id:333},chat:{id:333,type:"private"},text:`/start tc_${linkToken}`}}});
assert.equal(linked.result.kind,"message");assert.match(linked.result.text,/Telegram linked/);
let card;
for(let attempt=0;attempt<10&&!card;attempt++) {
 const pending=await post("/api/intake/telegram",{operation:"pending"});
 card=pending.cards.find((c:{lead_id:string})=>c.lead_id===leadId);
}
assert.ok(card);
await post("/api/intake/telegram",{operation:"sent",lead_id:leadId,token:card.token,message_id:123});
const button=card.reply_markup.inline_keyboard.flat().find((b:{text:string})=>b.text==="WhatsApp sent");assert.ok(button);
const update={update_id:updateBase+1,callback_query:{id:`fixture-${run}`,from:{id:333},data:button.callback_data,message:{message_id:123,chat:{id:-700123}}}};
const saved=await post("/api/intake/telegram",{operation:"update",update});assert.equal(saved.result.text,"Saved in Inquiry Box.");
assert.deepEqual(await post("/api/intake/telegram",{operation:"update",update}),saved);
const activity=await db.from("activities").select("actor_id,metadata").eq("lead_id",leadId);assert.ifError(activity.error);
assert.equal(activity.data!.length,1);assert.equal(activity.data![0].actor_id,uid);assert.equal((activity.data![0].metadata as Record<string,unknown>).source,"telegram");
const persisted=await member.from("inbox_leads").select("first_whatsapp_sent_at,first_customer_reply_at,contact_attempts").eq("id",leadId).single();assert.ifError(persisted.error);
assert.ok(persisted.data!.first_whatsapp_sent_at);assert.equal(persisted.data!.first_customer_reply_at,null);assert.equal(persisted.data!.contact_attempts,1);
const unsigned=await fetch(app+"/api/intake/telegram",{method:"POST",headers:{"content-type":"application/json"},body:'{"operation":"pending"}'});assert.equal(unsigned.status,401);
await writeFile('/tmp/tile-25-e2e-result.json',JSON.stringify({run,lead_id:leadId,lead_url:`${app}/sales/inbox?view=all&lead=${leadId}`,concurrent_leads:12,distribution:[4,4,4],idempotency:"passed",callback:"passed",unsigned:"denied"},null,2));
console.log(JSON.stringify({outcome:"passed",concurrent_leads:12,distribution:[4,4,4],duplicate_intake:"passed",linked_callback:"passed",history_actor:"passed",unsigned_request:"denied",lead_id:leadId}));
