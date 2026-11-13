"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { attachProof } from "./proof-upload-action";
import { shrinkProof } from "./shrink-proof";
import type { proofUploadLabels } from "./proof-upload-labels";

export function ProofUploadForm({ result, behalf, labels }: {
  result: string; behalf: boolean; labels: typeof proofUploadLabels.en;
}) {
  const [outcome, action, pending] = useActionState(attachProof, "");
  const [reason, setReason] = useState("");
  const errors: Record<string, string> = {
    proof: labels.proof, reason: labels.reasonRequired, stored: labels.stored, denied: labels.denied,
  };
  const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 py-2";
  return (
    <form action={action} className="grid gap-3 rounded-md border p-3">
      <p className="font-medium">{behalf ? labels.behalfTitle : labels.ownTitle}</p>
      <input type="hidden" name="result" value={result} />
      <input type="hidden" name="behalf" value={behalf ? "1" : "0"} />
      <label className="grid gap-1 text-sm">{labels.file}
        <input className={fieldClass} name="proof" type="file" accept="application/pdf,image/jpeg,image/png" required
          onChange={(event) => { void shrinkProof(event.currentTarget); }} />
      </label>
      {behalf && <label className="grid gap-1 text-sm">{labels.reason}
        <textarea className={fieldClass} name="reason" maxLength={500} required
          value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>}
      <Button type="submit" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : labels.upload}
      </Button>
      {outcome && <p role="alert" className="text-sm text-destructive">{errors[outcome] ?? labels.failed}</p>}
    </form>
  );
}
