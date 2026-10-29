"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { InfoTip } from "@/components/patterns/explain";
import { COMPETITOR_EVIDENCE, COMPETITOR_RELATIONSHIPS, OUTCOME_REASONS, outcomeReason, type OutcomeType } from "@/lib/domain/outcome-reasons";
import { PURSUIT_OUTCOME } from "@/lib/domain/status-maps";
import type { PursuitOutcomeInput } from "@/features/outcomes/schema";
import type { PursuitOutcome } from "@/features/outcomes/types";
import { recordPursuitOutcomeAction } from "@/server/commands/outcomes";

const ACTION: Record<OutcomeType, "lose" | "reject" | "defer"> = { lost: "lose", rejected: "reject", deferred: "defer" };
const TYPE_LABEL: Record<OutcomeType, string> = {
  lost: "Lost the sale",
  rejected: "Rejected at qualification",
  deferred: "Defer: not ready yet",
};

/** Today's date in Kuala Lumpur, as the effective-date default. */
function klToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function klInput(date: Date) {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16);
}

export interface OutcomeTarget {
  leadId?: string | null;
  opportunityId?: string | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: OutcomeTarget;
  /** Leave the dialog to say what else closes with this record (e.g. its one active opportunity). */
  linkedNote?: string;
} & (
  | { mode: "close"; types: OutcomeType[]; initialType?: OutcomeType }
  | { mode: "reopen"; needsNextAction: boolean; stages?: { key: string; label: string }[]; defaultStage?: string | null }
  | { mode: "correct"; event: PursuitOutcome }
);

export function OutcomeDialog(props: Props) {
  const { open, onOpenChange, target } = props;
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const correcting = props.mode === "correct" ? props.event : null;
  const [type, setType] = useState<OutcomeType>(
    props.mode === "close" ? props.initialType ?? props.types[0] : correcting?.outcome_type ?? "lost",
  );
  const [reason, setReason] = useState<string>(correcting?.reason_code ?? "");
  const [detail, setDetail] = useState(correcting?.reason_detail ?? "");
  const [effective, setEffective] = useState(() => correcting?.effective_date ?? klToday());
  const [review, setReview] = useState(correcting?.review_date ?? "");
  const [compName, setCompName] = useState(correcting?.competitor_name ?? "");
  const [compRel, setCompRel] = useState(correcting?.competitor_relationship ?? "");
  const [compRelDetail, setCompRelDetail] = useState(correcting?.competitor_relationship_detail ?? "");
  const [compEvidence, setCompEvidence] = useState(correcting?.competitor_evidence ?? "");
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState(() => klInput(new Date(Date.now() + 86400000)));
  const [nextAction, setNextAction] = useState("");
  const [stage, setStage] = useState(props.mode === "reopen" ? props.defaultStage ?? "" : "");

  const chosen = props.mode === "reopen" ? undefined : outcomeReason(type, reason);
  const reasons = OUTCOME_REASONS[type];

  function reset() {
    setError(null);
    retry.current = null;
  }

  function build(): PursuitOutcomeInput | string {
    if (props.mode === "reopen") {
      if (detail.trim().length < 3) return "Record why the pursuit is reopened (at least 3 characters).";
      const due = new Date(`${nextAt}:00+08:00`);
      if (!nextAt || !Number.isFinite(due.getTime())) return "Choose the next follow-up date and time.";
      if (props.needsNextAction && nextAction.trim().length < 2) return "Enter the next action for the reopened opportunity.";
      return {
        action: "reopen", request_id: "", lead_id: target.leadId ?? undefined, opportunity_id: target.opportunityId ?? undefined,
        reason_detail: detail.trim(), next_follow_up_at: due.toISOString(), next_action: nextAction.trim() || undefined, stage_key: stage || undefined,
      };
    }
    if (!chosen) return "Choose a reason. Use Unknown when the reason is not known.";
    if (chosen.requiresDetail && detail.trim().length < 3) return "Explain the reason (at least 3 characters).";
    if (reason === "duplicate" && detail.trim().length < 3) return "Explain which inquiry this duplicates.";
    if (!effective) return "Enter the date the outcome took effect.";
    if (effective > klToday()) return "The effective date cannot be in the future.";
    if (type === "deferred" && !review) return "Choose a review date for the deferral.";
    if (chosen.isCompetitor) {
      if (!compRel) return "State the relationship with the supplier, or choose Unknown.";
      if (compRel === "reported" && compRelDetail.trim().length < 3) return "Describe the reported relationship (at least 3 characters).";
      if (compRel === "reported" && !compEvidence) return "State how the relationship is known.";
    }
    if (props.mode === "correct" && note.trim().length < 3) return "Record why the outcome is corrected (at least 3 characters).";
    const reported = chosen.isCompetitor && compRel === "reported";
    const fields = {
      reason_code: reason, reason_detail: detail.trim() || undefined, effective_date: effective,
      review_date: type === "deferred" ? review : undefined,
      competitor_name: chosen.isCompetitor ? compName.trim() || undefined : undefined,
      competitor_relationship: chosen.isCompetitor ? compRel : undefined,
      competitor_relationship_detail: reported ? compRelDetail.trim() : undefined,
      competitor_evidence: reported ? compEvidence : undefined,
    };
    if (props.mode === "correct") return { action: "correct", request_id: "", event_id: props.event.id, correction_note: note.trim(), ...fields };
    return { action: ACTION[type], request_id: "", lead_id: target.leadId ?? undefined, opportunity_id: target.opportunityId ?? undefined, ...fields };
  }

  function submit() {
    if (inFlight.current) return;
    const input = build();
    if (typeof input === "string") { setError(input); return; }
    const payload = JSON.stringify(input);
    // An unconfirmed submission keeps its request ID, so a retry cannot record the outcome twice.
    if (retry.current?.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    const request_id = retry.current.id;
    inFlight.current = true;
    start(async () => {
      try {
        const result = await recordPursuitOutcomeAction({ ...input, request_id } as PursuitOutcomeInput);
        if (!result.ok) { setError(result.error); return; }
        retry.current = null;
        toast.success(result.message);
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("The result could not be confirmed. Retry safely; the same outcome will not be recorded twice.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  const title = props.mode === "reopen" ? "Reopen pursuit" : props.mode === "correct" ? `Correct ${PURSUIT_OUTCOME[props.event.outcome_type].label.toLowerCase()} reason` : target.opportunityId && !target.leadId ? "Close or defer opportunity" : "Close or defer inquiry";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) { if (!next) reset(); onOpenChange(next); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "reopen"
              ? "The earlier outcome, its reason and who recorded it stay in history. The pursuit becomes active with a new follow-up."
              : props.mode === "correct"
                ? "Records a superseding reason. The original reason, date and who recorded it are kept; it still counts as one outcome."
                : "Choose what happened. Outstanding reminders are resolved and kept in history. Recording No response never closes a pursuit by itself."}
            {props.linkedNote && <span className="mt-1 block font-medium text-foreground">{props.linkedNote}</span>}
          </DialogDescription>
        </DialogHeader>

        {props.mode === "close" && props.types.length > 1 && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Outcome <span className="text-destructive">*</span></legend>
            <RadioGroup value={type} onValueChange={(v) => { setType(v as OutcomeType); setReason(""); setError(null); }} className="gap-1.5">
              {props.types.map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <RadioGroupItem value={t} id={`${ids}-type-${t}`} />
                  <Label htmlFor={`${ids}-type-${t}`} className="text-sm font-normal">{TYPE_LABEL[t]}</Label>
                  <InfoTip content={PURSUIT_OUTCOME[t].hint!} label={TYPE_LABEL[t]} />
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        )}

        {props.mode !== "reopen" && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">{type === "lost" ? "Primary loss reason" : type === "rejected" ? "Rejection reason" : "Deferral reason"} <span className="text-destructive">*</span></legend>
            <RadioGroup value={reason} onValueChange={(v) => { setReason(v); setError(null); }} className="gap-1.5">
              {reasons.map((r) => (
                <div key={r.key} className="flex items-center gap-2">
                  <RadioGroupItem value={r.key} id={`${ids}-reason-${r.key}`} />
                  <Label htmlFor={`${ids}-reason-${r.key}`} className="text-sm font-normal">{r.label}</Label>
                  <InfoTip content={r.hint} label={r.label} />
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        )}

        {props.mode !== "reopen" && chosen?.isCompetitor && (
          <div className="space-y-3 rounded-md border p-3">
            <Field label="Supplier name (leave blank if unknown)" htmlFor={`${ids}-comp`} hint="An unnamed supplier is recorded as Unknown, never guessed.">
              <Input id={`${ids}-comp`} value={compName} onChange={(e) => setCompName(e.target.value)} maxLength={200} />
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="flex items-center gap-1 text-xs font-medium">
                Relationship with this supplier <span className="text-destructive">*</span>
                <InfoTip label="Relationship with this supplier" content="Provisional. The business has not defined “friendly competitor”, so record only what was reported and how it is known. It is never stored as a referral arrangement or customer relationship." />
              </legend>
              <RadioGroup value={compRel} onValueChange={setCompRel} className="gap-1.5">
                {COMPETITOR_RELATIONSHIPS.map((r) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <RadioGroupItem value={r.key} id={`${ids}-rel-${r.key}`} />
                    <Label htmlFor={`${ids}-rel-${r.key}`} className="text-sm font-normal">{r.label}</Label>
                    <InfoTip content={r.hint} label={r.label} />
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
            {compRel === "reported" && (
              <>
                <Field label="What was reported" htmlFor={`${ids}-reldetail`} required hint="Describe it in plain words; do not label it a referral partner or customer unless the business has confirmed that.">
                  <Textarea id={`${ids}-reldetail`} value={compRelDetail} onChange={(e) => setCompRelDetail(e.target.value)} maxLength={2000} rows={2} />
                </Field>
                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-medium">How it is known <span className="text-destructive">*</span></legend>
                  <RadioGroup value={compEvidence} onValueChange={setCompEvidence} className="gap-1.5">
                    {COMPETITOR_EVIDENCE.map((r) => (
                      <div key={r.key} className="flex items-center gap-2">
                        <RadioGroupItem value={r.key} id={`${ids}-ev-${r.key}`} />
                        <Label htmlFor={`${ids}-ev-${r.key}`} className="text-sm font-normal">{r.label}</Label>
                        <InfoTip content={r.hint} label={r.label} />
                      </div>
                    ))}
                  </RadioGroup>
                </fieldset>
              </>
            )}
          </div>
        )}

        {props.mode !== "reopen" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Effective date (Kuala Lumpur)" htmlFor={`${ids}-eff`} required tip="The business date the outcome took effect. Weekly reports count it in this date's Monday–Sunday week, not the day it was entered.">
              <Input id={`${ids}-eff`} type="date" max={klToday()} value={effective} onChange={(e) => setEffective(e.target.value)} />
            </Field>
            {type === "deferred" && (
              <Field label="Review date" htmlFor={`${ids}-review`} required tip="A review reminder is created for this date. A deferral is never left without one.">
                <Input id={`${ids}-review`} type="date" min={klToday()} value={review} onChange={(e) => setReview(e.target.value)} />
              </Field>
            )}
          </div>
        )}

        <Field
          label={props.mode === "reopen" ? "Why is it reopened?" : chosen?.requiresDetail || reason === "duplicate" ? "Explanation" : "Explanation (optional)"}
          htmlFor={`${ids}-detail`}
          required={props.mode === "reopen" || !!chosen?.requiresDetail || reason === "duplicate"}
          hint={reason === "duplicate" ? "Say which inquiry this duplicates." : undefined}
        >
          <Textarea id={`${ids}-detail`} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} rows={2} />
        </Field>

        {props.mode === "correct" && (
          <Field label="Why is it corrected?" htmlFor={`${ids}-note`} required>
            <Textarea id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
          </Field>
        )}

        {props.mode === "reopen" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Next follow-up (Kuala Lumpur)" htmlFor={`${ids}-next`} required>
              <Input id={`${ids}-next`} type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
            </Field>
            {props.needsNextAction && (
              <Field label="Next action" htmlFor={`${ids}-action`} required>
                <Input id={`${ids}-action`} value={nextAction} onChange={(e) => setNextAction(e.target.value)} maxLength={200} />
              </Field>
            )}
            {props.needsNextAction && props.stages && props.stages.length > 0 && (
              <Field label="Resume at stage" htmlFor={`${ids}-stage`} hint="Defaults to the stage it had before closing." className="sm:col-span-2">
                <select id={`${ids}-stage`} value={stage} onChange={(e) => setStage(e.target.value)} className="h-8 w-full rounded-md border bg-transparent px-2 text-sm">
                  {props.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button disabled={pending} onClick={submit}>{pending ? "Saving…" : props.mode === "reopen" ? "Reopen" : props.mode === "correct" ? "Save correction" : type === "deferred" ? "Defer" : type === "rejected" ? "Reject inquiry" : "Record loss"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
