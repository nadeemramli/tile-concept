import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isFreshTimestamp, verifyTimestampedSignature } from "@/integrations/signature";
import { runTelegramOperation, telegramOperationSchema } from "@/server/integrations/telegram";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Private relay contract. n8n verifies Telegram's secret header before forwarding updates. */
export async function POST(request:NextRequest) {
  const secret=process.env.N8N_INTAKE_SECRET;
  if(!secret) return NextResponse.json({ok:false,error:"connector_not_configured"},{status:503});
  const raw=await request.text();
  if(Buffer.byteLength(raw)>200_000) return NextResponse.json({ok:false,error:"body_too_large"},{status:413});
  const timestamp=request.headers.get("x-tc-timestamp");
  if(!isFreshTimestamp(timestamp) || !verifyTimestampedSignature(secret,raw,timestamp,request.headers.get("x-tc-signature"))) {
    return NextResponse.json({ok:false,error:"invalid_signature"},{status:401});
  }
  let body:unknown;
  try {body=JSON.parse(raw);} catch {return NextResponse.json({ok:false,error:"invalid_json"},{status:400});}
  const parsed=telegramOperationSchema.safeParse(body);
  if(!parsed.success) return NextResponse.json({ok:false,error:"invalid_operation"},{status:400});
  try {
    const result=await runTelegramOperation(parsed.data);
    if(parsed.data.operation==="update") for(const path of ["/sales/inbox","/sales/tasks","/","/sales/contacts","/insights/reports"]) revalidatePath(path);
    return NextResponse.json(result);
  }
  catch {return NextResponse.json({ok:false,error:"telegram_bridge_failed"},{status:500});}
}
