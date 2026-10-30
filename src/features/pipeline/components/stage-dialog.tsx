"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { changeStageAction } from "@/server/commands/opportunities";
import { OutcomeDialog } from "@/features/outcomes/components/outcome-dialog";
import type { StageRef } from "@/server/queries/reference";

export function StageChangeDialog({ open, onOpenChange, opportunityId, currentStage, stages, hasNextAction, initialTarget }: { open: boolean; onOpenChange: (o: boolean) => void; opportunityId: string; currentStage: string; stages: StageRef[]; hasNextAction: boolean; initialTarget?: string }) {
  const [target, setTarget] = useState<string>(initialTarget ?? "");
  const current = stages.find((s) => s.key === currentStage);
  const to = stages.find((s) => s.key === target);
  const backward = !!(to && current && to.position < current.position);
  const reasonRequired = !!(to && (to.requires_reason || backward));
  const nextActionRequired = !!(to && to.reporting_group === "open" && to.requires_next_action && !hasNextAction);
  const closing = to && to.reporting_group !== "open";
  const options = useMemo(() => stages.filter((s) => s.key !== currentStage), [stages, currentStage]);
  const openStages = useMemo(() => stages.filter((s) => s.reporting_group === "open"), [stages]);
  const close = (o: boolean) => { if (!o) setTarget(initialTarget ?? ""); onOpenChange(o); };

  // Lost and Deferred carry a structured reason, effective date and history, so
  // those moves (and leaving them) use the shared outcome form, never free text.
  if (current && (current.reporting_group === "lost" || current.reporting_group === "deferred")) {
    return (
      <OutcomeDialog open={open} onOpenChange={close} mode="reopen" target={{ opportunityId }} needsNextAction stages={openStages}
        defaultStage={to?.reporting_group === "open" ? to.key : undefined}
        linkedNote={`This opportunity is ${current.label.toLowerCase()}. Reopen it first; the earlier outcome stays in history.`} />
    );
  }
  if (to && (to.reporting_group === "lost" || to.reporting_group === "deferred")) {
    return <OutcomeDialog key={to.reporting_group} open={open} onOpenChange={close} mode="close" target={{ opportunityId }} types={["lost", "deferred"]} initialType={to.reporting_group} />;
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTarget(initialTarget ?? "");
        onOpenChange(o);
      }}
      title="Change stage"
      description={current ? `Currently: ${current.label}. Moving to Won or backward records a reason in the stage history. Lost and Deferred open the outcome form.` : undefined}
      submitLabel="Move stage"
      action={async (fd) => changeStageAction({ opportunity_id: opportunityId, ...formToObject(fd), to_stage_key: target })}
    >
      <Field label="Target stage" required>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose stage…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                <span className="tnum mr-2 text-muted-foreground">{s.position}.</span>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {backward && <p className="text-xs text-warning">This is a backward move; a reason is required and recorded.</p>}
      <Field label={reasonRequired ? "Reason" : "Reason (optional)"} htmlFor="reason" required={reasonRequired} hint={closing ? "Why it was won." : undefined}>
        <Textarea id="reason" name="reason" rows={2} required={reasonRequired} />
      </Field>
      {closing && (
        <Field label={to?.reporting_group === "deferred" ? "Deferred until" : "Outcome date"} htmlFor="outcome_date">
          <Input id="outcome_date" name="outcome_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
      )}
      {to && to.reporting_group === "open" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next action" htmlFor="next_action" required={nextActionRequired} hint={nextActionRequired ? "Active opportunities need a next action." : undefined}>
            <Input id="next_action" name="next_action" required={nextActionRequired} />
          </Field>
          <Field label="Due" htmlFor="next_action_due_at" required={nextActionRequired}>
            <Input id="next_action_due_at" name="next_action_due_at" type="datetime-local" required={nextActionRequired} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
