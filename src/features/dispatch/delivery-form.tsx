"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordDelivery } from "./delivery-action";
import { shrinkProof } from "./shrink-proof";
import type { deliveryLabels } from "./delivery-labels";

export function DeliveryForm({ revision, allocation, planned, labels }: {
  revision: string; allocation: string; planned: number; labels: typeof deliveryLabels.en;
}) {
  const [result, action, pending] = useActionState(recordDelivery, "");
  const errors: Record<string, string> = {
    details: labels.details, proof: labels.proofError, stale: labels.stale,
    recorded: labels.recorded, quantity: labels.quantityError, denied: labels.denied, pickup: labels.pickupFirst,
  };
  return (
    <form action={action} className="mt-2 grid gap-3 rounded-md border p-3">
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="allocation" value={allocation} />
      <label className="grid gap-1 text-sm">
        {labels.quantity}
        <Input className="min-h-11" name="quantity" type="number" min="0" max={planned} step="0.001" required />
      </label>
      <label className="grid gap-1 text-sm">
        {labels.pic}
        <Input className="min-h-11" name="pic" maxLength={120} />
      </label>
      <label className="grid gap-1 text-sm">
        {labels.reason}
        <Input className="min-h-11" name="reason" maxLength={500} />
      </label>
      <label className="grid gap-1 text-sm">
        {labels.proof}
        <Input className="min-h-11" name="proof" type="file" accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => { void shrinkProof(event.currentTarget); }} />
      </label>
      <Button type="submit" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : labels.record}
      </Button>
      {result && <p role="alert" className="text-sm text-destructive">{errors[result] ?? labels.failed}</p>}
    </form>
  );
}
