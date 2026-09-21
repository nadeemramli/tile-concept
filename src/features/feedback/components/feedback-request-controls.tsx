"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FactList } from "@/components/patterns/record-drawer";
import { formatDateTime, titleCase } from "@/lib/format";
import { logFeedbackWhatsAppOpenedAction, manageFeedbackAction, reissueFeedbackLinkAction } from "@/server/commands/feedback";
import type { FeedbackCreationResult, FeedbackPurchaseContext } from "../types";
import { FeedbackPhotoUpload } from "./feedback-photo-upload";

export function FeedbackRequestControls({ context, initialHandoff, photoPermission }: { context: FeedbackPurchaseContext; initialHandoff: FeedbackCreationResult | null; photoPermission: boolean }) {
  const [handoff, setHandoff] = useState(initialHandoff);
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(Boolean(context.request?.whatsapp_sent_at));
  const router = useRouter();
  const requestId = handoff?.request_id ?? context.request?.id;
  if (!requestId) return null;
  const detail = context.request;

  function manage(action: "whatsapp_sent" | "review_customer_reported" | "review_staff_verified" | "review_declined" | "review_reset" | "revoke") {
    start(async () => {
      const result = await manageFeedbackAction({ request_id: requestId, action, note });
      if (!result.ok) { toast.error(result.error); return; }
      if (action === "whatsapp_sent") setSent(true);
      if (action === "revoke") setHandoff(null);
      setNote(""); toast.success(result.message); router.refresh();
    });
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Copied."); }
    catch { toast.error("Copy failed. Select the text below and copy manually."); }
  }

  return <div className="space-y-5">
    <Card className="space-y-3 p-5"><h2 className="font-semibold">{context.customer_name} · feedback prepared</h2><FactList items={[
      { label: "WhatsApp", value: sent ? "Staff marked sent" : "Not marked sent" },
      { label: "Customer feedback", value: detail?.customer_confirmed_at ? `Confirmed ${formatDateTime(detail.customer_confirmed_at)}` : "Awaiting customer" },
      { label: "Google opened", value: detail?.google_handoff_opened_at ? formatDateTime(detail.google_handoff_opened_at) : "Not recorded" },
      { label: "Google review", value: titleCase(detail?.review_outcome ?? "unknown") },
      { label: "Private link", value: detail?.status === "revoked" ? "Revoked" : detail?.expires_at ? `Expires ${formatDateTime(detail.expires_at)}` : "Expires in seven days" },
    ]} /><p className="text-xs text-muted-foreground">Opening WhatsApp does not send the message. Opening Google does not prove a review was posted.</p></Card>
    <Card className="space-y-3 p-5"><h2 className="font-semibold">2. Add optional photos</h2>{photoPermission ? <FeedbackPhotoUpload requestId={requestId} existingCount={detail?.photo_count ?? 0} /> : <p className="text-sm text-muted-foreground">No customer media permission was recorded. Continue without photos.</p>}</Card>
    <Card className="space-y-3 p-5"><h2 className="font-semibold">3. Prepare the WhatsApp message</h2>
      {handoff ? <>
        <p className="text-sm text-muted-foreground">One link contains the draft and uploaded photos. Check the recipient, then press Send in WhatsApp. Photos are available through the link, not attached automatically.</p>
        <Textarea readOnly aria-label="Prepared WhatsApp message" value={handoff.message} rows={5} />
        <div className="flex flex-wrap gap-2"><Button asChild><a href={handoff.whatsapp_url} target="_blank" rel="noopener noreferrer" onClick={() => { void logFeedbackWhatsAppOpenedAction(requestId).then(r => { if (!r.ok) toast.warning("WhatsApp opened, but its event was not recorded."); }); }}>Open WhatsApp message</a></Button><Button variant="outline" onClick={() => copy(handoff.message)}>Copy message</Button><Button variant="outline" onClick={() => copy(handoff.secure_link)}>Copy private link</Button></div>
        <p className="break-all text-xs text-muted-foreground">{handoff.secure_link}</p>
      </> : <><p className="text-sm text-muted-foreground">Private links expire after seven days. Prepare a replacement if the previous link was lost or expired; the previous link will stop working.</p><Button disabled={pending || !context.phone} onClick={() => start(async () => { const r = await reissueFeedbackLinkAction(requestId); if (!r.ok) { toast.error(r.error); return; } setHandoff(r.data); toast.success(r.message); })}>Prepare replacement link</Button></>}
      <Button variant="outline" disabled={pending || sent} onClick={() => manage("whatsapp_sent")}>{sent ? "Marked sent by staff" : "I sent this message in WhatsApp"}</Button>
    </Card>
    <Card className="space-y-3 p-5"><h2 className="font-semibold">4. Record the review outcome</h2><p className="text-sm text-muted-foreground">Choose customer-reported when they tell you they posted. Choose staff-verified only after seeing the review on Google; record the reviewer, date or link as evidence.</p>
      {detail?.review_outcome_note ? <p className="rounded border p-3 text-sm">{detail.review_outcome_note}</p> : null}
      <Field label="Reason or verification evidence" hint="Required for an outcome, correction or link revocation."><Textarea aria-label="Review outcome evidence" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} /></Field>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={pending || note.trim().length < 5} onClick={() => manage("review_customer_reported")}>Customer says posted</Button><Button variant="outline" disabled={pending || note.trim().length < 5} onClick={() => manage("review_staff_verified")}>I verified the Google review</Button><Button variant="outline" disabled={pending || note.trim().length < 5} onClick={() => manage("review_declined")}>Customer declined</Button><Button variant="ghost" disabled={pending || note.trim().length < 5} onClick={() => manage("review_reset")}>Correct to unknown</Button><Button variant="ghost" disabled={pending || note.trim().length < 5} onClick={() => manage("revoke")}>Revoke private link</Button></div>
    </Card>
    {detail?.events.length ? <Card className="space-y-3 p-5"><h2 className="font-semibold">Recent activity</h2><ul className="space-y-2 text-sm">{detail.events.map((e, i) => <li key={`${e.occurred_at}-${i}`}><span className="text-muted-foreground">{formatDateTime(e.occurred_at)}</span> · {titleCase(e.event_type)}{e.metadata.note ? ` — ${e.metadata.note}` : ""}</li>)}</ul></Card> : null}
    <div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/sales/feedback">Feedback tracking</Link></Button><Button asChild variant="outline"><Link href={context.visit_id ? `/sales/walk-ins?visit=${context.visit_id}` : "/sales/walk-ins"}>Back to walk-ins</Link></Button></div>
  </div>;
}
