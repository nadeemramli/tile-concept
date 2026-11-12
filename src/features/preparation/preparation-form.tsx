"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordPreparation, recordWarehouseStage } from "./actions";
import type { preparationLabels } from "./labels";

interface Props {
  line: string;
  version: number;
  request: string;
  allocation?: string;
  stage?: "ready" | "handed_over";
  labels: typeof preparationLabels.en;
}

export function PreparationForm({ line, version, request, allocation, stage, labels }: Props) {
  const [result, action, pending] = useActionState(stage ? recordWarehouseStage : recordPreparation, "");
  const packing = allocation && !stage;
  const quantityLabel = stage === "ready" ? labels.readyQuantity
    : stage === "handed_over" ? labels.handoverQuantity
    : packing ? labels.amountPacked : labels.quantity;
  const submitLabel = stage === "ready" ? labels.markReady
    : stage === "handed_over" ? labels.saveHandover
    : packing ? labels.savePack : labels.allocate;
  const error = result === "stale" ? labels.stale
    : result === "limit" ? labels.limit
    : result === "invalid" ? labels.invalid
    : result === "recipient" ? labels.recipientRequired
    : result === "denied" ? labels.denied
    : result ? labels.failedSave : "";

  return (
    <form action={action} className="grid gap-3 rounded-lg border p-3">
      <input type="hidden" name="line" value={line} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="request" value={request} />
      {allocation && <input type="hidden" name="allocation" value={allocation} />}
      {stage && <input type="hidden" name="stage" value={stage} />}
      <label className="grid gap-1 text-sm">
        {quantityLabel}
        <Input className="min-h-11" name="quantity" type="number" min={packing ? "0" : "0.001"}
          step="0.001" required defaultValue={packing ? "0" : undefined} />
      </label>
      {packing && (
        <label className="grid gap-1 text-sm">
          {labels.amountShort}
          <Input className="min-h-11" name="shortage" type="number" min="0" step="0.001" required defaultValue="0" />
        </label>
      )}
      {stage === "handed_over" && (
        <label className="grid gap-1 text-sm">
          {labels.recipient}
          <Input className="min-h-11" name="recipient" maxLength={120} required />
        </label>
      )}
      <Button className="min-h-11 justify-self-start" type="submit" disabled={pending}>
        {pending ? labels.saving : submitLabel}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
