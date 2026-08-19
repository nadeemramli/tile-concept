import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { publicEnv } from "@/lib/env";
import { LogoLockup } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  "no-membership": "Your account is signed in but has no workspace membership. Ask an administrator for an invitation.",
  "auth-callback-failed": "That sign-in link could not be verified. Request a new one.",
  "invalid-link": "That link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" ? REASONS[sp.reason] : undefined;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <LogoLockup size={64} priority className="ring-1 ring-border" />
          <div>
            <h1 className="text-base font-semibold tracking-tight">Tile Concept OS</h1>
            <p className="text-xs text-muted-foreground">Invite-only internal workspace</p>
          </div>
        </div>
        {reason && <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">{reason}</p>}
        <LoginForm next={next} demo={publicEnv.appMode === "demo"} />
        <p className="text-[11px] text-muted-foreground">
          Access is granted by invitation. Sessions are cookie-based; permissions are enforced in the database.
        </p>
      </div>
    </div>
  );
}
