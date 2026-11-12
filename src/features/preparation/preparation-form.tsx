"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordPreparation } from "./actions";
import type { preparationLabels } from "./labels";

interface Props {
  line: string;
  version: number;
  request: string;
  allocation?: string;
  labels: typeof preparationLabels.en;
}

export function PreparationForm({ line, version, request, allocation, labels }: Props) {
  const [result, action, pending] = useActionState(recordPreparation, "");
  const error = result === "stale" ? labels.stale
    : result === "limit" ? labels.limit
    : result === "invalid" ? labels.invalid
    : result === "denied" ? labels.denied
    : result ? labels.failedSave : "";

  return (
    <form action={action} className="grid gap-3 rounded-lg border p-3">
      <input type="hidden" name="line" value={line} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="request" value={request} />
      {allocation && <input type="hidden" name="allocation" value={allocation} />}
      <label className="grid gap-1 text-sm">
        {allocation ? labels.amountPacked : labels.quantity}
        <Input className="min-h-11" name="quantity" type="number" min={allocation ? "0" : "0.001"}
          step="0.001" required defaultValue={allocation ? "0" : undefined} />
      </label>
      {allocation && (
        <label className="grid gap-1 text-sm">
          {labels.amountShort}
          <Input className="min-h-11" name="shortage" type="number" min="0" step="0.001" required defaultValue="0" />
        </label>
      )}
      <Button className="min-h-11 justify-self-start" type="submit" disabled={pending}>
        {pending ? labels.saving : allocation ? labels.savePack : labels.allocate}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
