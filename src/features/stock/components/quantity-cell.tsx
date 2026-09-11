"use client";

import { Paperclip } from "lucide-react";
import { StatusPill } from "@/components/patterns/status-pill";
import { Hint } from "@/components/patterns/explain";
import { formatNumber } from "@/lib/format";
import { AVAILABILITY_STATUS } from "@/features/stock/status";
import type { AvailabilityState } from "@/server/queries/stock";

/**
 * The availability pill and its quantity are rendered together so a state can
 * never be read as a number, and a number never appears without its state.
 * The pill explains itself from the map's hint.
 */
export function AvailabilityCell({ state }: { state: AvailabilityState }) {
  return <StatusPill map={AVAILABILITY_STATUS} value={state} />;
}

/** Quantities only render for states that carry one; otherwise an em dash. */
export function QuantityCell({ state, quantity, unit }: { state: AvailabilityState; quantity: number | null; unit: string | null }) {
  if (quantity === null) {
    return (
      <Hint content={`No quantity was given for a “${AVAILABILITY_STATUS[state]?.label ?? state}” state. It is not zero.`} focusable>
        <span className="text-muted-foreground">—</span>
      </Hint>
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
    <Hint content={`Evidence attached: ${path.split("/").pop()}. A screenshot is evidence of a conversation, not a structured stock figure.`} focusable>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Paperclip className="size-3.5" aria-hidden />
        <span className="sr-only">Evidence attached</span>
      </span>
    </Hint>
  );
}
