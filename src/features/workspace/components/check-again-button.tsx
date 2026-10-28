"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Re-renders the page from the server; the one action on an empty queue. */
export function CheckAgainButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="lg" className="h-12 w-full max-w-xs text-base" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw className={pending ? "size-5 animate-spin" : "size-5"} aria-hidden />
      {pending ? pendingLabel : label}
    </Button>
  );
}
