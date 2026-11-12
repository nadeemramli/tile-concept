"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateSchedule } from "./schedule-action";
import type { scheduleLabels } from "./schedule-labels";

export function ScheduleControl({ fields, label, labels, disabled }: {
  fields: Record<string, string>;
  label: string;
  labels: typeof scheduleLabels.en;
  disabled?: boolean;
}) {
  const [result, action, pending] = useActionState(updateSchedule, "");
  const error = result === "stale" ? labels.stale
    : result === "recorded" ? labels.recorded
    : result === "notReady" ? labels.notReady
    : result ? labels.failed : "";
  return (
    <form action={action} className="grid gap-1">
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <Button className="min-h-11 justify-self-start" size="sm" variant="outline" type="submit" disabled={disabled || pending}>
        {pending ? labels.saving : label}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function RefreshSchedules() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
