"use client";

import { Paperclip } from "lucide-react";
import { StatusPill } from "@/components/patterns/status-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { AVAILABILITY_EXPLAINER, AVAILABILITY_STATUS } from "@/features/stock/status";
import type { AvailabilityState } from "@/server/queries/stock";

/**
 * The availability pill and its quantity are rendered together so a state can
 * never be read as a number, and a number never appears without its state.
 */
export function AvailabilityCell({ state }: { state: AvailabilityState }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <StatusPill map={AVAILABILITY_STATUS} value={state} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{AVAILABILITY_EXPLAINER[state] ?? "No explanation recorded."}</TooltipContent>
    </Tooltip>
  );
}

/** Quantities only render for states that carry one; otherwise an em dash. */
export function QuantityCell({ state, quantity, unit }: { state: AvailabilityState; quantity: number | null; unit: string | null }) {
  if (quantity === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground">—</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">No quantity was given for a “{AVAILABILITY_STATUS[state]?.label ?? state}” state. It is not zero.</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="tnum">
      {formatNumber(quantity, 2)}
      {unit && <span className="ml-1 text-[11px] text-muted-foreground">{unit}</span>}
    </span>
  );
}

export function EvidenceCell({ path }: { path: string | null }) {
  if (!path) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Paperclip className="size-3.5" aria-hidden />
          <span className="sr-only">Evidence attached</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">Evidence attached: {path.split("/").pop()}. A screenshot is evidence of a conversation, not a structured stock figure.</TooltipContent>
    </Tooltip>
  );
}
