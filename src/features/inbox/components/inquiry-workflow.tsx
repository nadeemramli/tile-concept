"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { DrawerSection } from "@/components/patterns/record-drawer";
import { formatDateTime } from "@/lib/format";
import { followUpDueAt } from "@/features/inbox/lib/follow-up";
import type { InquiryAction } from "@/features/inbox/schema";
import type { LeadRow } from "@/features/inbox/types";
import { workInquiryAction } from "@/server/commands/inquiry";

const LABELS: Record<InquiryAction, string> = {
  contact_attempt: "Log call / email",
  whatsapp_sent: "WhatsApp sent", customer_replied: "Customer replied", no_response: "No response",
  schedule: "Schedule follow-up", reschedule: "Reschedule follow-up", complete: "Follow-up done",
  lost: "Mark as lost", reopen: "Reopen inquiry", no_next_action: "No next action needed",
};

function klInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 16);
}

export function InquiryWorkflow({ lead, canWrite }: { lead: LeadRow; canWrite: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<InquiryAction | null>(null);
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [occurred, setOccurred] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "phone" | "email" | "dm" | "meeting">("whatsapp");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const closed = ["disqualified", "duplicate"].includes(lead.status);
  const needsDate = action === "schedule" || action === "reschedule" || action === "reopen";
  const needsReason = action === "complete" || action === "lost" || action === "reopen" || action === "no_next_action";

  function open(next: InquiryAction) {
    setAction(next); setBody(""); setOccurred(""); setChannel(next === "contact_attempt" ? "phone" : "whatsapp"); setError(null);
    setDue(klInput(lead.next_follow_up_at ?? followUpDueAt(3)));
  }

  function submit() {
    if (!action || inFlight.current) return;
    if (needsDate && !due) { setError("Choose a follow-up date and time."); return; }
    if (needsReason && body.trim().length < 3) { setError("Record an outcome or reason (at least 3 characters)."); return; }
    const dueDate = due ? new Date(`${due}:00+08:00`) : null;
    const occurredDate = occurred ? new Date(`${occurred}:00+08:00`) : null;
    if ((needsDate && (!dueDate || !Number.isFinite(dueDate.getTime()))) || (occurredDate && !Number.isFinite(occurredDate.getTime()))) {
      setError("Enter a valid date and time."); return;
    }
    const input = {
      lead_id: lead.id, action, body: body.trim() || undefined, channel,
      task_id: ["complete", "reschedule"].includes(action) ? lead.next_follow_up_task_id ?? undefined : undefined,
      due_at: needsDate ? dueDate!.toISOString() : undefined,
      occurred_at: occurredDate?.toISOString(),
    };
    const payload = JSON.stringify(input);
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    inFlight.current = true;
    start(async () => {
      try {
        const result = await workInquiryAction({ ...input, request_id });
        if (!result.ok) { setError(result.error); return; }
        retry.current = null;
        toast.success(result.message);
        setAction(null); setError(null);
        router.refresh();
      } catch {
        setError("The result could not be confirmed. Retry safely; the same action will not be recorded twice.");
      } finally { inFlight.current = false; }
    });
  }

  return (
    <DrawerSection title="Next action and progress">
      <div className="space-y-3 rounded-md border p-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">First WhatsApp sent</span><p>{lead.first_whatsapp_sent_at ? formatDateTime(lead.first_whatsapp_sent_at) : "Not recorded"}</p></div>
          <div><span className="text-muted-foreground">First customer reply</span><p>{lead.first_customer_reply_at ? formatDateTime(lead.first_customer_reply_at) : "Not recorded"}</p></div>
        </div>
        {!closed && <div className="flex flex-wrap gap-2">
          {(["whatsapp_sent", "customer_replied", "no_response", "contact_attempt"] as const).map((key) => (
            <Button key={key} size="sm" variant={key === "customer_replied" ? "default" : "outline"} disabled={!canWrite || pending} onClick={() => open(key)}>{LABELS[key]}</Button>
          ))}
        </div>}
        <div className="border-t pt-3">
          {lead.next_follow_up_task_id ? <>
            <p className="text-sm font-medium">{lead.next_follow_up_at ? `Next follow-up: ${formatDateTime(lead.next_follow_up_at)}` : "Follow-up needs a due date"}</p>
            {lead.open_follow_ups > 1 && <p className="text-xs text-muted-foreground">{lead.open_follow_ups} open tasks. The earliest is shown; the next appears when this one is completed.</p>}
            {!closed && <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={!canWrite || pending} onClick={() => open("complete")}>Follow-up done</Button>
              <Button size="sm" variant="outline" disabled={!canWrite || pending} onClick={() => open("reschedule")}>Reschedule</Button>
            </div>}
          </> : <>
            <p className="text-sm text-muted-foreground">{closed ? "This inquiry is closed. Its history remains available." : lead.no_next_action_reason ? `No next action: ${lead.no_next_action_reason}` : "No next action set. Choose a reminder so this inquiry gets attention."}</p>
            {!closed && <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={!canWrite || pending} onClick={() => open("schedule")}>Schedule follow-up</Button>
              <Button size="sm" variant="ghost" disabled={!canWrite || pending} onClick={() => open("no_next_action")}>No next action needed</Button>
            </div>}
          </>}
        </div>
        {!canWrite && <p className="text-xs text-muted-foreground">The assigned salesperson or a sales manager can update this inquiry. The next follow-up is shared with the team.</p>}
        <div className="flex justify-between border-t pt-2">
          <span className="text-xs text-muted-foreground">{lead.completed_follow_ups} follow-ups completed</span>
          {lead.status === "disqualified" ? <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => open("reopen")}>Reopen inquiry</Button>
            : !closed && <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => open("lost")}>Mark as lost</Button>}
        </div>
      </div>
      <Dialog open={action !== null} onOpenChange={(isOpen) => { if (!isOpen && !pending) setAction(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{action ? LABELS[action] : "Update inquiry"}</DialogTitle>
            <DialogDescription>{action === "whatsapp_sent" ? "Confirm that you sent the message. This does not record a customer reply."
              : action === "customer_replied" ? "Confirm an actual reply from the customer. Choose the channel below."
              : action === "no_response" ? "Record an attempt that received no response. Find it in No response until a later contact attempt or reply is recorded."
              : action === "contact_attempt" ? "Record your outreach. Use Customer replied separately if the customer responded."
              : action === "complete" ? "Record what happened. Completing the reminder does not imply the customer replied."
              : action === "lost" ? "Record the reason. Outstanding follow-ups will be cancelled and retained in history."
              : "Save the next step and keep the inquiry history up to date."}</DialogDescription>
          </DialogHeader>
          {(action === "customer_replied" || action === "contact_attempt" || action === "no_response") && <Field label={action === "customer_replied" ? "Reply channel" : "Contact channel"}>
            <Select value={channel} onValueChange={(value) => setChannel(value as typeof channel)}><SelectTrigger aria-label="Contact channel"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="dm">Direct message</SelectItem><SelectItem value="meeting">In person</SelectItem>
            </SelectContent></Select>
          </Field>}
          {needsDate && <Field label="Follow-up date and time (Kuala Lumpur)">
            <Input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Follow-up date and time" />
            <div className="mt-2 flex gap-2">{[[1,"Tomorrow"],[3,"In 3 days"],[7,"In 1 week"]].map(([days,label]) => <Button key={days} size="sm" type="button" variant="outline" onClick={() => setDue(klInput(followUpDueAt(Number(days))))}>{label}</Button>)}</div>
          </Field>}
          {!needsDate && action !== "no_next_action" && <Field label="When it happened (Kuala Lumpur; blank means now)"><Input type="datetime-local" value={occurred} onChange={(event) => setOccurred(event.target.value)} aria-label="Action date and time" /></Field>}
          <Field label={needsReason ? "Outcome / reason (required)" : "Notes (optional)"}><Textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} aria-label="Action notes" /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setAction(null)}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Saving…" : "Save action"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </DrawerSection>
  );
}
