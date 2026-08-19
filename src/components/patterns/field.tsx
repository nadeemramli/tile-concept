import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Minimal form field wrapper: label, control, hint, error. Pairs with react-hook-form or plain forms. */
export function Field({ label, htmlFor, hint, error, required, children, className }: { label: string; htmlFor?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
