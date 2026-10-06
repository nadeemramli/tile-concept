import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { NO_ACCESS_COPY, toAccessState } from "@/lib/access-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { signOutAction } from "@/server/commands/auth";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "No workspace access" };

/**
 * A signed-in account with no active membership lands here instead of /login,
 * which would bounce it straight back to / and loop. It says why, who can fix
 * it, and offers sign-out so the user can switch to the right account.
 */
export default async function NoAccessPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // getSession() claims any pending invite first, so an invite recorded since
  // the last visit takes effect on "Check again" without a new email link.
  if (await getSession()) redirect("/");

  const { data: claim } = await supabase.rpc("claim_my_invites").maybeSingle();
  const state = toAccessState(claim?.access);
  if (state === "active") redirect("/");
  const copy = NO_ACCESS_COPY[state];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <LogoLockup size={64} priority className="ring-1 ring-border" />
          <div>
            <h1 className="text-base font-semibold tracking-tight">{copy.title}</h1>
            <p className="text-xs text-muted-foreground">Tile Concept OS is invite-only</p>
          </div>
        </div>
        <div role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {copy.body(user.email ?? "this account")}
        </div>
        <div className="flex gap-2">
          <Button asChild className="flex-1">
            <Link href="/" prefetch={false}>
              Check again
            </Link>
          </Button>
          <form action={signOutAction} className="flex-1">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
        <p className="text-[11px] text-muted-foreground">Signed in to the wrong account? Sign out and use the address your invitation was sent to.</p>
      </div>
    </div>
  );
}
