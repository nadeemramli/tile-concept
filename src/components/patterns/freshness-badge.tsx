"use client";

import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TONE = {
  fresh: "bg-success/12 text-success border-success/25",
  aging: "bg-warning/12 text-warning border-warning/25",
  stale: "bg-destructive/12 text-destructive border-destructive/25",
  unknown: "bg-muted text-muted-foreground border-transparent",
};

export type Freshness = keyof typeof TONE;

export function freshnessOf(lastSuccessAt: string | null | undefined, slaMinutes: number): Freshness {
  if (!lastSuccessAt) return "unknown";
  const ageMin = (Date.now() - new Date(lastSuccessAt).getTime()) / 60_000;
  if (ageMin <= slaMinutes) return "fresh";
  if (ageMin <= slaMinutes * 3) return "aging";
  return "stale";
}

/** Every source-dependent value can expose "as of" + freshness state (PRD §2.2 #5). */
export function FreshnessBadge({ lastSuccessAt, slaMinutes, className, label }: { lastSuccessAt: string | null | undefined; slaMinutes: number; className?: string; label?: string }) {
  const state = freshnessOf(lastSuccessAt, slaMinutes);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium tnum", TONE[state], className)}>
          {label ? `${label} · ` : ""}
          {lastSuccessAt ? formatRelative(lastSuccessAt) : "never"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {state === "fresh"
          ? `Within the ${slaMinutes >= 60 ? `${Math.round(slaMinutes / 60)}h` : `${slaMinutes}m`} freshness SLA`
          : state === "aging"
            ? "Older than the freshness SLA — monitor"
            : state === "stale"
              ? "Well past the freshness SLA — data from this source is stale"
              : "No successful read recorded"}
      </TooltipContent>
    </Tooltip>
  );
}
