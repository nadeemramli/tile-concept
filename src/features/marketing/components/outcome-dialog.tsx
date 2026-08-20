"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { recordOutcomeAction } from "@/server/commands/marketing";
import { BOOKING_STATUS, OUTCOMES, meta } from "@/features/marketing/lib/status";

/** Closing out a visit. Anything other than a clean completion needs a reason. */
export function OutcomeDialog({ open, onOpenChange, bookingId }: { open: boolean; onOpenChange: (o: boolean) => void; bookingId: string }) {
  const [outcome, setOutcome] = useState<string>("completed");
  const reasonRequired = outcome !== "completed";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record shoot outcome"
      description="The booking keeps its history either way; a follow-up task is optional."
      submitLabel="Record outcome"
      action={async (fd) => recordOutcomeAction({ ...formToObject(fd), booking_id: bookingId, outcome })}
    >
      <Field label="Outcome" required>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {meta(BOOKING_STATUS, o).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label={reasonRequired ? "Reason" : "Notes (optional)"}
        htmlFor="reason"
        required={reasonRequired}
        hint={reasonRequired ? "Customer unavailable, access failed, weather, rescheduled — say what happened." : undefined}
      >
        <Textarea id="reason" name="reason" rows={2} required={reasonRequired} />
      </Field>
      <Field label="Follow-up task (optional)" htmlFor="follow_up" hint="Creates a task for the coordinator, due in three days.">
        <Input id="follow_up" name="follow_up" placeholder="Rebook the interview with the owner" />
      </Field>
    </FormDialog>
  );
}
