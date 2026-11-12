import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

const proof = z.object({
  name: z.string(),
  type: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  base64: z.string(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ result: string }> }) {
  const { result } = await params;
  const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !z.uuid().safeParse(result).success) return notFound();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("synthetic_delivery_proof", { p_result: result });
  const parsed = proof.safeParse(data);
  if (error || !parsed.success) return notFound();
  const file = parsed.data;
  const safeName = encodeURIComponent(file.name).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
  return new Response(new Uint8Array(Buffer.from(file.base64, "base64")), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": "attachment; filename*=UTF-8''" + safeName,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
