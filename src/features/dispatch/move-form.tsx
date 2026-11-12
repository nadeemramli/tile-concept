"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { moveDraft } from "./actions";
import type { dispatchLabels } from "./labels";

type Props = {
  allocation: string;
  version: number;
  tripId: string | null;
  destinations: { id: string; label: string }[];
  labels: typeof dispatchLabels.en;
};

export function MoveDraftForm({ allocation, version, tripId, destinations, labels }: Props) {
  const [result, action, pending] = useActionState(moveDraft, "");
  const error = result === "conflict" ? labels.conflict
    : result === "recorded" ? labels.recorded
    : result === "invalid" ? labels.invalid
    : result ? labels.failedSave : "";
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="allocation" value={allocation} />
      <input type="hidden" name="version" value={version} />
      <label className="grid gap-1 text-sm">
        {labels.move}
        <select name="trip" className="min-h-11 rounded-md border bg-background px-2" defaultValue={tripId ?? ""}>
          <option value="">{labels.unassigned}</option>
          {destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}
        </select>
      </label>
      <Button type="submit" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : labels.save}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
