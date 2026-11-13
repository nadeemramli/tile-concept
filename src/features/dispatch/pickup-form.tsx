"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordPickup } from "./pickup-action";
import type { pickupLabels } from "./pickup-labels";

export function PickupForm({ request, allocation, stage, remaining, labels }: {
  request: string; allocation: string; stage: "supplier_ready" | "picked_up"; remaining: number;
  labels: typeof pickupLabels.en;
}) {
  const [outcome, action, pending] = useActionState(recordPickup, "");
  const [quantity, setQuantity] = useState(String(remaining));
  const [note, setNote] = useState("");
  const errors: Record<string, string> = {
    limit: labels.limit, invalid: labels.invalid, conflict: labels.conflict, denied: labels.denied,
  };
  const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 py-2";
  return (
    <form action={action} className="grid gap-3 rounded-md border p-3">
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="allocation" value={allocation} />
      <input type="hidden" name="stage" value={stage} />
      <label className="grid gap-1 text-sm">{stage === "supplier_ready" ? labels.readyQuantity : labels.pickedQuantity}
        <input className={fieldClass} name="quantity" inputMode="decimal" maxLength={15} required
          value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">{labels.note}
        <input className={fieldClass} name="note" maxLength={500}
          value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <Button type="submit" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : stage === "supplier_ready" ? labels.saveReady : labels.savePicked}
      </Button>
      {outcome && <p role="alert" className="text-sm text-destructive">{errors[outcome] ?? labels.failed}</p>}
    </form>
  );
}
