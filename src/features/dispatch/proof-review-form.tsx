"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { recordProofReview } from "./proof-review-action";
import type { proofReviewLabels } from "./proof-review-labels";

export function ProofReviewForm({ row, labels, approve }: {
  row: { id: string; version: string; lastEvent: string | null; unitPrice: number | null };
  labels: typeof proofReviewLabels.en;
  approve: boolean;
}) {
  const [result, action, pending] = useActionState(recordProofReview, "");
  const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 py-2";
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="result" value={row.id} />
      <input type="hidden" name="version" value={row.version} />
      <input type="hidden" name="previous" value={row.lastEvent ?? ""} />
      {!approve && row.unitPrice !== null && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">{labels.quantity}
            <input className={fieldClass} name="quantity" inputMode="decimal" maxLength={15} />
          </label>
          <label className="grid gap-1">{labels.price}
            <input className={fieldClass} name="price" inputMode="decimal" maxLength={15} />
          </label>
        </div>
      )}
      <label className="grid gap-1">{approve ? labels.resolution : labels.note}
        <textarea className={fieldClass} name="note" maxLength={500} required={approve} />
      </label>
      <div className="flex flex-wrap gap-2">
        {approve ? <Button className="min-h-11" name="action" value="approve" disabled={pending}>
          {pending ? labels.saving : labels.approve}
        </Button> : <>
          {row.unitPrice !== null && <Button className="min-h-11" name="action" value="compare" disabled={pending}>
            {pending ? labels.saving : labels.compare}
          </Button>}
          <Button className="min-h-11" variant="outline" name="action" value="unclear" disabled={pending}>
            {pending ? labels.saving : labels.markUnclear}
          </Button>
        </>}
      </div>
      {result && <p role="alert" className="text-destructive">{result === "stale" ? labels.stale : labels.failed}</p>}
    </form>
  );
}
