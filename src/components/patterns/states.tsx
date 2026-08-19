import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PERMISSION_EXPLAINERS, type PermissionKey } from "@/lib/rbac/matrix";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className, children }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      <Icon className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && (
        <Button asChild size="sm" className="mt-4">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function ErrorState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-8 text-destructive" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function PermissionDenied({ permission, roleLabel }: { permission: PermissionKey; roleLabel?: string }) {
  return (
    <div className="flex h-full min-h-96 flex-col items-center justify-center px-6 py-16 text-center">
      <Lock className="mb-3 size-8 text-muted-foreground/60" aria-hidden />
      <h2 className="text-base font-medium">Not available{roleLabel ? ` to ${roleLabel}` : ""}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {PERMISSION_EXPLAINERS[permission] ?? "Your role does not include this area."} Ask an administrator if you need access.
      </p>
    </div>
  );
}

const CELL_WIDTHS = ["w-3/4", "w-1/2", "w-full"];

export function SkeletonTable({ rows = 8, cols = 6, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("overflow-hidden rounded-lg border", className)}>
      <div className="flex h-9 items-center gap-3 border-b px-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1 animate-skeleton" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={cn("flex h-[33px] items-center gap-3 px-3", r > 0 && "border-t")}>
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={cn("h-4 animate-skeleton", CELL_WIDTHS[(r + c) % CELL_WIDTHS.length])} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function InlineCount({ value, width = "w-10" }: { value: number | string | null; width?: string }) {
  if (value !== null) return <>{typeof value === "number" ? value.toLocaleString() : value}</>;
  return <Skeleton className={cn("inline-block h-3.5 translate-y-[2px] rounded", width)} aria-label="loading" />;
}

export function RefreshChip({ label = "Updating…", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}
