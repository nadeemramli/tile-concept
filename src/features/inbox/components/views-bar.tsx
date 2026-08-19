"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export interface ViewTab {
  key: string;
  label: string;
  count?: number;
}

/** Saved-view tabs driven by a URL search param; shareable and keyboard-operable. */
export function ViewsBar({ tabs, active, param = "view", basePath, extra }: { tabs: ViewTab[]; active: string; param?: string; basePath: string; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b pb-2">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${basePath}?${param}=${t.key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {t.label}
            {typeof t.count === "number" && <span className={cn("tnum rounded px-1 text-[10px]", isActive ? "bg-background/60" : "bg-muted")}>{t.count}</span>}
          </Link>
        );
      })}
      {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  );
}
