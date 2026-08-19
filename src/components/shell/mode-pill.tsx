"use client";

import { CircleDot } from "lucide-react";
import { publicEnv } from "@/lib/env";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MODE_META = {
  demo: { label: "Demo", className: "bg-ai/12 text-ai border-ai/30", blurb: "Synthetic data only. Actions change app state and are audited, but never reach any external system." },
  shadow: { label: "Shadow", className: "bg-info/12 text-info border-info/30", blurb: "Reads mirror authorized sources; external writes are recorded but not sent." },
  live: { label: "Live", className: "bg-warning/12 text-warning border-warning/30", blurb: "Approved workflows create operational records; external writes are separately gated." },
} as const;

/** Operating mode is an environment decision (PRD §12.9), not a user toggle. */
export function ModePill() {
  const meta = MODE_META[publicEnv.appMode] ?? MODE_META.demo;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", meta.className)} aria-label={`Operating mode: ${meta.label}`}>
          <CircleDot className="size-3" aria-hidden />
          {meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{meta.blurb}</TooltipContent>
    </Tooltip>
  );
}
