"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/server/action-result";

interface FormDialogProps<T> {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  submitLabel?: string;
  destructive?: boolean;
  /** Build the payload from the form; return null to abort with a message already shown. */
  action: (formData: FormData) => Promise<ActionResult<T>>;
  onSuccess?: (data: T) => void;
  children: React.ReactNode;
  className?: string;
}

/** Dialog wrapping a native form that posts to a Server Action and toasts the result. */
export function FormDialog<T>({ open, onOpenChange, title, description, submitLabel = "Save", destructive, action, onSuccess, children, className }: FormDialogProps<T>) {
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className ?? "sm:max-w-lg"}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const res = await action(fd);
              if (res.ok) {
                toast.success(res.message ?? "Saved");
                setFieldErrors({});
                onOpenChange(false);
                onSuccess?.(res.data);
              } else {
                setFieldErrors(res.fieldErrors ?? {});
                toast.error(res.error);
              }
            });
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-3">{children}</div>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {Object.entries(fieldErrors).map(([k, v]) => (
                <li key={k}>
                  <span className="font-medium">{k.replace(/_/g, " ")}:</span> {v.join(", ")}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Convert a FormData into a plain object; repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      if (Array.isArray(out[key])) (out[key] as unknown[]).push(v);
      else out[key] = [v];
    } else out[k] = v;
  }
  return out;
}
