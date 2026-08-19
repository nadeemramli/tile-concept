"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface RecordDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: "md" | "lg" | "xl";
  actions?: React.ReactNode;
}

/** Right-side drawer for contextual inspect/edit flows (PRD §12.2). */
export function RecordDrawer({ open, onOpenChange, title, description, children, width = "lg", actions }: RecordDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn("flex w-full flex-col gap-0 overflow-y-auto p-0", width === "md" && "sm:max-w-xl", width === "lg" && "sm:max-w-2xl", width === "xl" && "sm:max-w-4xl")}>
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="text-base">{title}</SheetTitle>
              {description && <SheetDescription className="mt-0.5">{description}</SheetDescription>}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
        </SheetHeader>
        <div className="flex-1 space-y-5 px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function DrawerSection({ title, children, className, action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FactList({ items, className }: { items: { label: string; value: React.ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{it.label}</dt>
          <dd className={cn("truncate", it.mono && "font-mono text-[12px] tnum")}>{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
