"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/domain/status-maps";

interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatusTone;
  href?: string;
  className?: string;
  /** Definition, grain, source and freshness behind the info affordance — no bare metrics (PRD §7.1). */
  info?: { definition: string; grain?: string; source?: string; freshness?: string; caveat?: string };
  compact?: boolean;
}

const VALUE_TONE: Record<StatusTone, string> = {
  neutral: "",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
  ai: "text-ai",
};

export function MetricCard({ label, value, hint, tone = "neutral", href, className, info, compact }: MetricCardProps) {
  const body = (
    <Card className={cn("gap-1 px-3.5 py-2.5 transition-colors", href && "hover:bg-accent/50", compact ? "rounded-md" : "", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {info && (
          <Popover>
            <PopoverTrigger
              className="rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Definition of ${label}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Info className="size-3.5" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 text-sm">
              <div className="space-y-2">
                <span className="font-medium">{label}</span>
                <p className="text-xs text-muted-foreground">{info.definition}</p>
                {info.grain && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Grain: </span>
                    {info.grain}
                  </div>
                )}
                {info.source && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Source: </span>
                    {info.source}
                  </div>
                )}
                {info.freshness && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Freshness: </span>
                    {info.freshness}
                  </div>
                )}
                {info.caveat && <p className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-xs text-warning">{info.caveat}</p>}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("tnum font-semibold tracking-tight", compact ? "text-lg" : "text-2xl", VALUE_TONE[tone])}>{value}</span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
  if (href) {
    return (
      <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {body}
      </Link>
    );
  }
  return body;
}
