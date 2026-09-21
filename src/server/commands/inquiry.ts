"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inquiryActionSchema } from "@/features/inbox/schema";
import { requirePermission } from "@/server/session";
import { createServerSupabase } from "@/lib/supabase/server";
import { fail, ok } from "@/server/action-result";

export async function workInquiryAction(input: z.input<typeof inquiryActionSchema>) {
  const parsed = inquiryActionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the action, date and notes.");
  const v = parsed.data;
  try {
    await requirePermission("sales.write");
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc("work_inquiry", {
      p_lead_id: v.lead_id, p_action: v.action, p_request_id: v.request_id,
      p_task_id: v.task_id, p_due_at: v.due_at, p_body: v.body,
      p_channel: v.channel, p_occurred_at: v.occurred_at,
    });
    if (error) return fail(error);
    for (const path of ["/sales/inbox", "/sales/tasks", "/", "/sales/contacts", "/insights/reports"]) revalidatePath(path);
    return ok(undefined, v.action === "schedule" || v.action === "reschedule"
      ? "Follow-up saved. Find it in Upcoming or Follow-ups due."
      : v.action === "complete" ? "Follow-up completed. Choose the next action or record why none is needed."
      : v.action === "customer_replied" ? "Customer reply recorded. Find this inquiry in Customer replied."
      : v.action === "whatsapp_sent" ? "WhatsApp sent recorded. Customer replies are recorded separately."
      : "Inquiry updated. The full history is available in All inquiries.");
  } catch (error) {
    return fail(error);
  }
}
