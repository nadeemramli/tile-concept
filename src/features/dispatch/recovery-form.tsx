"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordRecovery } from "./recovery-action";
import type { recoveryLabels } from "./recovery-labels";

export function RecoveryForm({ request, result, open, labels }: {
  request: string; result: string; open: number; labels: typeof recoveryLabels.en;
}) {
  const [outcome, action, pending] = useActionState(recordRecovery, "");
  // Controlled fields keep what was typed when the server refuses the decision.
  const [quantity, setQuantity] = useState(String(open));
  const [note, setNote] = useState("");
  const errors: Record<string, string> = {
    limit: labels.limit, invalid: labels.invalid, conflict: labels.conflict, denied: labels.denied,
  };
  const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 py-2";
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="result" value={result} />
      <label className="grid gap-1">{labels.quantity}
        <input className={fieldClass} name="quantity" inputMode="decimal" maxLength={15} required
          value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <label className="grid gap-1">{labels.note}
        <textarea className={fieldClass} name="note" maxLength={500}
          value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <p className="text-muted-foreground">{labels.redeliveryHint}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" name="kind" value="redelivery" disabled={pending}>
          {pending ? labels.saving : labels.scheduleRedelivery}
        </Button>
        <Button className="min-h-11" variant="outline" name="kind" value="return" disabled={pending}>
          {pending ? labels.saving : labels.recordReturn}
        </Button>
      </div>
      {outcome && <p role="alert" className="text-destructive">{errors[outcome] ?? labels.failed}</p>}
    </form>
  );
}
