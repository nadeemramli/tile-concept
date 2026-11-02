"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DrawerSection } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { formatDateTime } from "@/lib/format";
import { enquiryDateInput, enquiryDateIso } from "@/features/inbox/lib/enquiry-date";
import type { LeadRow } from "@/features/inbox/types";
import { correctInquiryReceivedDateAction } from "@/server/commands/inquiry";

export function InquiryReceivedDate({ lead, canWrite }: { lead: LeadRow; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const inFlight = useRef(false);
  function edit() {
    setDate(enquiryDateInput(lead.received_at)); setReason(""); setError(null); setOpen(true);
  }
  function save() {
    if (inFlight.current) return;
    const received_at = enquiryDateIso(date);
    if (!received_at) { setError("Enter a valid enquiry date and time in Kuala Lumpur."); return; }
    if (reason.trim().length < 3) { setError("Add a correction reason (at least 3 characters)."); return; }
    const input = { lead_id: lead.id, received_at, expected_received_at: lead.received_at, reason: reason.trim() };
    const payload = JSON.stringify(input);
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    inFlight.current = true;
    start(async () => {
      try {
        const result = await correctInquiryReceivedDateAction({ ...input, request_id });
        if (!result.ok) { setError(result.error); return; }
        retry.current = null; setOpen(false); toast.success(result.message); router.refresh();
      } catch { setError("The save could not be confirmed. Retry safely with the same date and reason."); }
      finally { inFlight.current = false; }
    });
  }
  return <DrawerSection title="Enquiry dates">
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Enquiry received at</dt><dd>{formatDateTime(lead.received_at)}</dd></div>
      <div><dt className="text-muted-foreground">Entered into system at</dt><dd>{formatDateTime(lead.created_at)}</dd></div>
    </dl>
    <p className="mt-2 text-xs text-muted-foreground">Dates are shown in Kuala Lumpur time. Reports and backdated actions use the enquiry received date.</p>
    {canWrite && <Button size="sm" variant="outline" className="mt-2" onClick={edit}>Edit enquiry received date</Button>}
    <Dialog open={open} onOpenChange={(value) => { if (!pending && !inFlight.current) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit enquiry received date</DialogTitle><DialogDescription>Enter when the customer actually enquired. The system entry timestamp stays unchanged. Your reason and both dates remain in Activity.</DialogDescription></DialogHeader>
        <Field label="Enquiry received at (Kuala Lumpur)" required><Input autoFocus type="datetime-local" step="0.001" aria-label="Enquiry received at" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Correction reason" required><Textarea aria-label="Correction reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={4000} /></Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save date"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DrawerSection>;
}
