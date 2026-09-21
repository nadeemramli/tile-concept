"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/patterns/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, titleCase } from "@/lib/format";
import { getWalkInInquiriesAction } from "@/server/commands/walkins";
import type { InquiryChoice, WalkInInquiryMatches } from "../types";

export const EMPTY_INQUIRY_CHOICE: InquiryChoice = { mode: "automatic", leadId: "", reason: "" };

export function InquiryLinkChoice({ contactId, occurredAt, value, onChange, correction = false }: {
  contactId: string; occurredAt: string; value: InquiryChoice; onChange: (v: InquiryChoice) => void; correction?: boolean;
}) {
  const [matches, setMatches] = useState<WalkInInquiryMatches | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getWalkInInquiriesAction(contactId, occurredAt).then((r) => {
      if (cancelled) return;
      if (r.ok) { setMatches(r.data); setError(""); }
      else setError(r.error);
    }).catch(() => {
      if (!cancelled) setError("Could not load inquiry matches. Retry before choosing a link.");
    });
    return () => { cancelled = true; };
  }, [contactId, occurredAt, attempt]);
  const automatic = matches?.candidates.find((c) => c.id === matches.automatic_lead_id);
  const selected = matches?.candidates.find((c) => c.id === value.leadId);
  const choiceValue = value.mode === "choose" ? value.leadId : value.mode;

  return <div className="space-y-3 rounded-lg border p-3">
    <div>
      <h3 className="text-sm font-medium">Original inquiry</h3>
      <p className="text-xs text-muted-foreground">Confirm which buying inquiry brought this customer to the showroom. Its original marketing source and salesperson are kept.</p>
    </div>
    {error ? <div role="alert" className="text-sm text-destructive">{error} <Button type="button" size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Retry matches</Button></div> : !matches ? <p role="status" className="text-sm text-muted-foreground">Checking earlier inquiries…</p> : <>
      <Field label="Inquiry decision" htmlFor="inquiry-decision">
        <Select value={choiceValue} onValueChange={(v) => onChange({ ...value, mode: ["automatic", "new", "unlinked"].includes(v) ? v as InquiryChoice["mode"] : "choose", leadId: ["automatic", "new", "unlinked"].includes(v) ? "" : v })}>
          <SelectTrigger id="inquiry-decision" className="w-full min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!correction && <SelectItem value="automatic">{automatic ? `Link matching ${titleCase(automatic.source_channel)} inquiry` : matches.can_start_direct ? "First inquiry at the showroom" : "Save visit as Needs linking"}</SelectItem>}
            {matches.candidates.map((c) => <SelectItem key={c.id} value={c.id} disabled={!c.can_link}>{titleCase(c.source_channel)} · {c.opportunity_name || c.interest || c.name} · {formatDateTime(c.created_at)}{c.closed ? " · Closed" : ""}{!c.can_link ? " · Identity conflict" : ""}</SelectItem>)}
            <SelectItem value="new">Start a separate showroom inquiry</SelectItem>
            <SelectItem value="unlinked">Needs linking — decide later</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value.mode === "automatic" && <p className="text-sm text-muted-foreground">{automatic ? `${automatic.name} · ${automatic.match_reason}. This visit will be added to that inquiry.` : matches.can_start_direct ? "No earlier inquiry matches this customer and date. The new inquiry will have Walk-in as its acquisition source." : "A safe automatic match is unavailable. Choose the correct inquiry, or save this visit for review. It will not receive platform attribution until linked."}</p>}
      {selected && value.mode === "choose" && <p className="text-sm text-muted-foreground">{selected.match_reason}.{selected.closed ? " This records a continued visit; the previous sales outcome stays unchanged. Reopen the inquiry separately if needed." : ""}</p>}
      {value.mode === "new" && <p className="text-sm text-muted-foreground">Use this for a different buying project. It creates a new Walk-in inquiry and does not credit an earlier campaign.</p>}
      {value.mode === "unlinked" && <p className="text-sm text-muted-foreground">The visit stays in the showroom ledger, with no inquiry or platform credit until reviewed.</p>}
    </>}
    {(correction || value.mode === "choose" || value.mode === "new") && <Field label="Reason for this decision" htmlFor="inquiry-reason">
      <Textarea id="inquiry-reason" value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} maxLength={1000} placeholder="For example: customer confirmed this is the kitchen inquiry from TikTok." />
    </Field>}
  </div>;
}
