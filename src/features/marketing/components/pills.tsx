"use client";

import { Hint, type HintContent } from "@/components/patterns/explain";
import { TonePill } from "@/components/patterns/status-pill";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/lib/domain/status-maps";
import { meta, type MarketingStatusMeta } from "@/features/marketing/lib/status";

/** Status pill that pairs the tone with an icon — colour is never the only cue. */
export function MarketingPill({
  map,
  value,
  size = "sm",
  className,
  hint,
}: {
  map: Record<string, MarketingStatusMeta>;
  value: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
  /** Override the map's hint (for example to add the expiry), or `false` for none. */
  hint?: HintContent;
}) {
  const m = meta(map, value);
  const Icon = m.icon;
  const pill = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        TONE_CLASSES[m.tone],
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {m.label}
    </span>
  );
  const content = hint === false ? null : (hint ?? m.hint);
  if (!content) return pill;
  return (
    <Hint content={content} focusable className="max-w-64">
      {pill}
    </Hint>
  );
}

/** Small chips for content types, uses, products. `hints` explains each value on hover. */
export function Chips({ values, labels, hints, empty = "—", className }: { values: string[]; labels?: Record<string, string>; hints?: Record<string, string>; empty?: string; className?: string }) {
  if (!values.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {values.map((v) => (
        <TonePill key={v} tone="neutral" dot={false} label={labels?.[v] ?? v.replace(/_/g, " ")} hint={hints?.[v]} />
      ))}
    </span>
  );
}
