"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { signInWithMagicLinkAction, signInWithPasswordAction, type AuthResult } from "@/server/commands/auth";

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [pwState, pwAction, pwPending] = useActionState<AuthResult | null, FormData>(signInWithPasswordAction, null);
  const [mlState, mlAction, mlPending] = useActionState<AuthResult | null, FormData>(signInWithMagicLinkAction, null);
  const [email, setEmail] = useState(demo ? "demo.admin@tileconcept.test" : "");

  return (
    <Tabs defaultValue="password" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="magic">Email link</TabsTrigger>
      </TabsList>
      <TabsContent value="password">
        <form action={pwAction} className="space-y-3 rounded-lg border bg-card p-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo ? "TileDemo!2026" : ""} />
          </div>
          {pwState && !pwState.ok && <p className="text-sm text-destructive">{pwState.error}</p>}
          <Button type="submit" className="w-full" disabled={pwPending}>
            {pwPending ? "Signing in…" : "Sign in"}
          </Button>
          {demo && (
            <p className="text-[11px] text-muted-foreground">
              Demo accounts: demo.admin / demo.manager / demo.rep1 / demo.rep2 / demo.showroom / demo.catalog / demo.marketing @tileconcept.test — password
              <code className="ml-1 font-mono">TileDemo!2026</code> (local stack only).
            </p>
          )}
        </form>
      </TabsContent>
      <TabsContent value="magic">
        <form action={mlAction} className="space-y-3 rounded-lg border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="ml-email">Email</Label>
            <Input id="ml-email" name="email" type="email" autoComplete="email" required />
          </div>
          {mlState && !mlState.ok && <p className="text-sm text-destructive">{mlState.error}</p>}
          {mlState && mlState.ok && <p className="text-sm text-success">{mlState.message}</p>}
          <Button type="submit" variant="outline" className="w-full" disabled={mlPending}>
            {mlPending ? "Sending…" : "Send sign-in link"}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}
