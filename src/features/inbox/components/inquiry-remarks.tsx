"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DrawerSection } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { DisabledHint } from "@/components/patterns/explain";
import { StatusPill } from "@/components/patterns/status-pill";
import { SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { SOURCE_CHANNELS } from "@/features/inbox/schema";
import type { LeadRow } from "@/features/inbox/types";
import { annotateInquiryAction } from "@/server/commands/inquiry";

export function InquiryRemarks({ lead, canWrite }: { lead: LeadRow; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<{ action: "remark" | "source"; expected_source: string; expected_detail: string | null } | null>(null);
  const [body, setBody] = useState("");
  const [source, setSource] = useState<(typeof SOURCE_CHANNELS)[number]>("other");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const denied = canWrite ? null : "The assigned salesperson or a sales manager can add remarks and correct the source.";

  function open(action: "remark" | "source") {
    setForm({ action, expected_source: lead.source_channel, expected_detail: lead.source_detail });
    setSource(SOURCE_CHANNELS.find((s) => s === lead.source_channel) ?? "other");
    setDetail(lead.source_detail ?? ""); setBody(""); setError(null);
  }
  function save() {
    if (!form || inFlight.current) return;
    if (body.trim().length < 3) { setError("Add at least 3 characters so the team understands the context."); return; }
    const input = { lead_id: lead.id, action: form.action, body: body.trim(),
      ...(form.action === "source" ? { source, detail, expected_source: form.expected_source, expected_detail: form.expected_detail } : {}) };
    const payload = JSON.stringify(input);
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    inFlight.current = true;
    start(async () => {
      try {
        const result = await annotateInquiryAction({ ...input, request_id });
        if (!result.ok) { setError(result.error); return; }
        retry.current = null; setForm(null); toast.success(result.message); router.refresh();
      } catch { setError("The save could not be confirmed. Retry safely with the same wording."); }
      finally { inFlight.current = false; }
    });
  }

  return <DrawerSection title="Source and team remarks">
    <div className="space-y-2">
      <StatusPill map={SOURCE_CHANNEL} value={lead.source_channel} />
      {lead.source_detail && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{lead.source_detail}</p>}
      <p className="text-xs text-muted-foreground">Remarks stay in Activity with the author and time. They do not mark a message sent, a reply, or a completed follow-up.</p>
      <div className="flex flex-wrap gap-2">
        <DisabledHint reason={denied}><Button size="sm" variant="outline" disabled={!canWrite} onClick={() => open("remark")}>Add remark</Button></DisabledHint>
        <DisabledHint reason={denied}><Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => open("source")}>Correct source</Button></DisabledHint>
      </div>
    </div>
    <Dialog open={!!form} onOpenChange={(value) => { if (!value && !pending) setForm(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{form?.action === "source" ? "Correct inquiry source" : "Add team remark"}</DialogTitle>
          <DialogDescription>{form?.action === "source" ? "Use customer or campaign evidence. Keep Meta unspecified when Facebook or Instagram is unknown. A website inquiry alone does not prove Google Ads. Original intake and every correction stay in history." : "Record the customer's requirements or context for the next teammate. This adds history without changing the follow-up status."}</DialogDescription>
        </DialogHeader>
        {form?.action === "source" && <>
          <Field label="Recorded origin"><Select value={source} onValueChange={(value) => setSource(value as typeof source)}><SelectTrigger aria-label="Recorded origin"><SelectValue /></SelectTrigger><SelectContent>
            {SOURCE_CHANNELS.map((s) => <SelectItem key={s} value={s}>{SOURCE_CHANNEL[s]?.label ?? s}</SelectItem>)}
          </SelectContent></Select></Field>
          <Field label="Campaign / source detail"><Input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} aria-label="Campaign or source detail" /></Field>
        </>}
        <Field label={form?.action === "source" ? "Evidence and correction reason" : "Remark"} required>
          <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={4} aria-label={form?.action === "source" ? "Source evidence and reason" : "Team remark"} />
        </Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setForm(null)}>Cancel</Button><Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DrawerSection>;
}
