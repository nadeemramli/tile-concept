"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { receiveOriginalDo } from "./original-do-action";
import type { originalDoLabels } from "./original-do-labels";

export function OriginalDoForm({ document, labels }: {
  document: string;
  labels: typeof originalDoLabels.en;
}) {
  const [result, action, pending] = useActionState(receiveOriginalDo, "");
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="document" value={document} />
      <Button className="min-h-11 justify-self-start" size="sm" variant="outline" disabled={pending} type="submit">
        {pending ? labels.saving : labels.confirm}
      </Button>
      {result && <p role="alert" className="text-sm text-destructive">{labels.failed}</p>}
    </form>
  );
}
