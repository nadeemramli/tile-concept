import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/patterns/explain";
import { cn } from "@/lib/utils";

/**
 * Minimal form field wrapper: label, control, hint, error. Pairs with
 * react-hook-form or plain forms. `hint` is always visible under the control;
 * `tip` is the ⓘ beside the label for the longer "why does this field exist".
 */
export function Field({ label, htmlFor, hint, tip, error, required, children, className }: { label: string; htmlFor?: string; hint?: string; tip?: string; error?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  const describedBy = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor} className="text-xs">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {tip && <InfoTip content={tip} label={label} />}
      </div>
      {children}
      {error ? (
        <p id={describedBy} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
