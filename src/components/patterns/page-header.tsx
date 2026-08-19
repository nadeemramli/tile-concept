import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  eyebrow?: React.ReactNode;
}

export function PageHeader({ title, description, children, className, eyebrow }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1400px] space-y-5 p-4 md:p-5", className)}>{children}</div>;
}

/** Compact KPI / exception strip used at the top of index pages. */
export function ExceptionStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6", className)}>{children}</div>;
}
