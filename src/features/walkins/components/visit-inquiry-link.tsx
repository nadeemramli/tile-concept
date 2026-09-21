"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/shell/session-context";
import { formatDateTime } from "@/lib/format";
import { resolveVisitInquiryAction } from "@/server/commands/walkins";
import { InquiryLinkChoice } from "./inquiry-link-choice";
import type { InquiryChoice, VisitRow } from "../types";

export function VisitInquiryLink({ visit, history }: { visit: VisitRow; history: { id: string; occurred_at: string; reason: string }[] }) {
  const { can } = useSession();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<InquiryChoice>({ mode: visit.lead_id ? "choose" : "unlinked", leadId: visit.lead_id ?? "", reason: "" });
  return <div className="space-y-3">
    <p className="text-sm">{visit.inquiry_link_state === "needs_linking" ? "Needs linking: this visit has no inquiry or platform credit yet." : visit.inquiry_link_state === "legacy" ? "Existing link recorded before inquiry matching was introduced. Review it if attribution needs correction." : "This visit contributes to the linked inquiry’s showroom milestone. Repeat visits stay separate in this ledger."}</p>
    {visit.lead_id && <Link href={`/sales/inbox?view=all&lead=${visit.lead_id}`} className="text-sm text-info hover:underline">Open linked inquiry</Link>}
    {visit.inquiry_link_reason && <p className="text-sm text-muted-foreground">Latest decision: {visit.inquiry_link_reason}</p>}
    {can("sales.write") && visit.contact_id && (editing ? <>
      <InquiryLinkChoice key={`${visit.id}:${visit.inquiry_link_version}`} contactId={visit.contact_id} occurredAt={visit.occurred_at} value={choice} onChange={setChoice} correction />
      <div className="flex gap-2">
        <Button disabled={pending || choice.reason.trim().length < 5} onClick={() => start(async () => {
          const result = await resolveVisitInquiryAction(visit.id, choice, visit.inquiry_link_version);
          if (!result.ok) { toast.error(result.error); return; }
          toast.success(result.message); setEditing(false); router.refresh();
        })}>{pending ? "Saving…" : "Save inquiry link"}</Button>
        <Button variant="ghost" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </> : <div><Button variant="outline" size="sm" onClick={() => setEditing(true)}>{visit.inquiry_link_state === "needs_linking" ? "Resolve inquiry link" : "Correct inquiry link"}</Button></div>)}
    {history.length > 0 && <ol className="space-y-2 border-t pt-3 text-sm" aria-label="Inquiry link history">{history.map((h) => <li key={h.id}><time className="text-xs text-muted-foreground">{formatDateTime(h.occurred_at)}</time><p>{h.reason}</p></li>)}</ol>}
  </div>;
}
