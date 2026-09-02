"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptEmailLinkAction, type AuthResult } from "@/server/commands/auth";

export function AcceptEmailLinkForm({ tokenHash, type, next }: { tokenHash: string; type: string; next: string }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(acceptEmailLinkAction, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border bg-card p-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <p className="text-sm text-muted-foreground">
        For your security, the email link has not been used yet. Continue to verify the address and finish signing in.
      </p>
      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Continue securely"}
      </Button>
    </form>
  );
}
