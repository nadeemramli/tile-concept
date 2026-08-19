"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action-result";

/** Runs a Server Action with pending state, toasts, and field errors. */
export function useAction<TArgs extends unknown[], TData>(action: (...args: TArgs) => Promise<ActionResult<TData>>, opts?: { onSuccess?: (data: TData) => void; refresh?: boolean; silent?: boolean }) {
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (...args: TArgs) =>
    new Promise<ActionResult<TData>>((resolve) => {
      start(async () => {
        const res = await action(...args);
        if (res.ok) {
          setFieldErrors({});
          setError(null);
          if (!opts?.silent && res.message) toast.success(res.message);
          opts?.onSuccess?.(res.data);
          if (opts?.refresh !== false) router.refresh();
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          setError(res.error);
          if (!opts?.silent) toast.error(res.error);
        }
        resolve(res);
      });
    });

  return { run, pending, fieldErrors, error, setError };
}

export function fieldError(errors: Record<string, string[]>, key: string) {
  return errors[key]?.[0];
}
