"use client";

import { Hint } from "@/components/patterns/explain";
import { cn } from "@/lib/utils";
import { statusMeta, TONE_CLASSES, TONE_DOT_CLASSES, type StatusMap, type StatusMeta, type StatusTone } from "@/lib/domain/status-maps";

interface StatusPillProps {
  map: StatusMap;
  value: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
  /** Override the map's hint, or pass `false` to render without one. */
  hint?: string | false;
}

/** Status pill: label + tone from the map, and the map's hint on hover/focus. */
export function StatusPill({ map, value, size = "sm", className, hint }: StatusPillProps) {
  const meta = statusMeta(map, value);
  return <TonePill tone={meta.tone} label={meta.label} size={size} className={className} hint={hint === false ? undefined : (hint ?? meta.hint)} />;
}

export function TonePill({ tone, label, size = "sm", className, dot = true, hint }: { tone: StatusTone; label: string; size?: "sm" | "md"; className?: string; dot?: boolean; hint?: string }) {
  const pill = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium tnum",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT_CLASSES[tone])} aria-hidden />}
      {label}
    </span>
  );
  if (!hint) return pill;
  return (
    <Hint content={hint} focusable className="max-w-64">
      {pill}
    </Hint>
  );
}

export function tonePill(meta: StatusMeta, label?: string) {
  return <TonePill tone={meta.tone} label={label ?? meta.label} hint={meta.hint} />;
}
