import { z } from "zod";
const rowSchema=z.object({account_id:z.string(),account_currency:z.literal("MYR"),date_start:z.iso.date(),date_stop:z.iso.date(),spend:z.string().regex(/^\d+(\.\d{1,2})?$/)});
export function completedWindow(now=new Date(),days=7) {
 const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kuala_Lumpur"}).format(now);
 const end=new Date(`${today}T00:00:00Z`);end.setUTCDate(end.getUTCDate()-1);
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
export async function fetchMetaSpend(token:string,account:string,from:string,to:string,request:typeof fetch=fetch) {
 if(!/^\d{5,30}$/.test(account))throw new Error("Invalid Meta account configuration");
 const headers={Authorization:`Bearer ${token}`};
 async function read(url:URL) {
 const response=await request(url,{headers,cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error("Meta reporting request failed");
 return response.json();
 }
 const base=`https://graph.facebook.com/v26.0/act_${account}`;
 const accountUrl=new URL(base);accountUrl.searchParams.set("fields","id,currency,timezone_name,account_status");
 const info=z.object({id:z.literal(`act_${account}`),currency:z.literal("MYR"),timezone_name:z.literal("Asia/Kuala_Lumpur"),account_status:z.literal(1)}).parse(await read(accountUrl));
 if(!info)throw new Error("Invalid Meta account");
 const url=new URL(`${base}/insights`);
 url.search=new URLSearchParams({fields:"account_id,account_currency,date_start,date_stop,spend",level:"account",time_increment:"1",time_range:JSON.stringify({since:from,until:to}),limit:"100"}).toString();
 const values=new Map<string,string>(); let after:string|undefined;
 for(let page=0;page<20;page++) {
 if(after)url.searchParams.set("after",after);
 const result=z.object({data:z.array(rowSchema),paging:z.object({next:z.string().optional(),cursors:z.object({after:z.string().optional()}).optional()}).optional()}).parse(await read(url));
 for(const row of result.data){if(row.account_id!==account||row.date_start!==row.date_stop||row.date_start<from||row.date_start>to||values.has(row.date_start))throw new Error("Invalid Meta daily report");values.set(row.date_start,row.spend);}
 if(!result.paging?.next){const days=[];for(let date=new Date(`${from}T00:00:00Z`);date.toISOString().slice(0,10)<=to;date.setUTCDate(date.getUTCDate()+1)){const day=date.toISOString().slice(0,10);days.push({day,amount:values.get(day)??"0.00"});}return days;}
 const cursor=result.paging.cursors?.after;if(!cursor||cursor===after)throw new Error("Invalid Meta pagination");after=cursor;
 }
 throw new Error("Meta pagination limit reached");
}
