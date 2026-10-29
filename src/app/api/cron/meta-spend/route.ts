import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { completedWindow,fetchMetaSpend } from "@/server/integrations/meta-spend";
export const runtime="nodejs";
export const maxDuration=120;
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const secret=process.env.CRON_SECRET;const supplied=request.headers.get("authorization")??"";
 const expected=`Bearer ${secret??""}`;
 if(!secret||secret.length<32||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return NextResponse.json({error:"Unauthorized"},{status:401});
 const token=process.env.META_ADS_ACCESS_TOKEN,account=process.env.META_AD_ACCOUNT_ID,workspace=process.env.TC_INTAKE_WORKSPACE_ID,actor=process.env.META_SYNC_ACTOR_ID;
 if(!token||!account||!workspace||!actor)return NextResponse.json({error:"Meta daily sync is not configured"},{status:503});
 const db=createAdminSupabase();
 try {
 const window=completedWindow();const rows=await fetchMetaSpend(token,account,window.from,window.to);
 const result=await db.rpc("sync_meta_spend",{p_workspace:workspace,p_actor:actor,p_account:account,p_rows:rows});
 if(result.error)throw new Error("Ledger reconciliation failed");
 return NextResponse.json({ok:true,...window,result:result.data},{headers:{"Cache-Control":"no-store"}});
 }catch{
 await db.rpc("meta_sync_failed",{p_workspace:workspace,p_account:account});
 return NextResponse.json({error:"Meta daily sync failed. Check permissions, configuration or conflicting spend entries."},{status:502});
 }
}
