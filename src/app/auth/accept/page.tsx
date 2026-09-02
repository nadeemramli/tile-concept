import type { Metadata } from "next";
import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { safeAuthNext } from "@/lib/auth-links";
import { AcceptEmailLinkForm } from "./accept-form";

export const metadata: Metadata = { title: "Verify access" };

type AcceptPageProps = {
  searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[]; next?: string | string[] }>;
};

export default async function AcceptPage({ searchParams }: AcceptPageProps) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const type = typeof params.type === "string" ? params.type : "";
  const fallback = type === "invite" || type === "recovery" || type === "email" ? "/auth/set-password" : "/";
  const next = safeAuthNext(params.next, fallback);
  const complete = tokenHash.length >= 16 && ["email", "invite", "recovery"].includes(type);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <LogoLockup size={64} priority className="ring-1 ring-border" />
          <div>
            <h1 className="text-base font-semibold tracking-tight">Verify Tile Concept access</h1>
            <p className="text-xs text-muted-foreground">One final confirmation</p>
          </div>
        </div>
        {complete ? (
          <AcceptEmailLinkForm tokenHash={tokenHash} type={type} next={next} />
        ) : (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <p className="text-sm text-destructive">This access link is incomplete or invalid.</p>
            <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
