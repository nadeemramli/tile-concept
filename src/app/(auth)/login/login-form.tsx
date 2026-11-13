"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/components/i18n/locale-context";
import { enterAsGuestAction, signInWithMagicLinkAction, signInWithPasswordAction, type AuthResult } from "@/server/commands/auth";

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [pwState, pwAction, pwPending] = useActionState<AuthResult | null, FormData>(signInWithPasswordAction, null);
  const [mlState, mlAction, mlPending] = useActionState<AuthResult | null, FormData>(signInWithMagicLinkAction, null);
  const [guestState, guestAction, guestPending] = useActionState<AuthResult | null, FormData>(enterAsGuestAction, null);
  const [email, setEmail] = useState(demo ? "demo.admin@tileconcept.test" : "");
  const { t } = useLocale();

  return (
    <div className="w-full space-y-4">
    <Tabs defaultValue="password" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="password">{t.login.password}</TabsTrigger>
        <TabsTrigger value="magic">{t.login.emailLink}</TabsTrigger>
      </TabsList>
      <TabsContent value="password">
        <form action={pwAction} className="space-y-3 rounded-lg border bg-card p-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email">{t.login.email}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t.login.password}</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo ? "TileDemo!2026" : ""} />
          </div>
          {pwState && !pwState.ok && <p className="text-sm text-destructive">{pwState.error}</p>}
          <Button type="submit" className="w-full" disabled={pwPending}>
            {pwPending ? t.login.signingIn : t.login.signIn}
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
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="ml-email">{t.login.email}</Label>
            <Input id="ml-email" name="email" type="email" autoComplete="email" required />
          </div>
          {mlState && !mlState.ok && <p className="text-sm text-destructive">{mlState.error}</p>}
          {mlState && mlState.ok && <p className="text-sm text-success">{mlState.message}</p>}
          <Button type="submit" variant="outline" className="w-full" disabled={mlPending}>
            {mlPending ? t.login.sending : t.login.sendLink}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t.login.linkHint}</p>
        </form>
      </TabsContent>
    </Tabs>

    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.login.or}</span>
      <span className="h-px flex-1 bg-border" />
    </div>

    <form action={guestAction} className="space-y-2">
      <input type="hidden" name="next" value={next} />
      {guestState && !guestState.ok && <p className="text-sm text-destructive">{guestState.error}</p>}
      <Button type="submit" variant="secondary" className="w-full" disabled={guestPending}>
        {guestPending ? t.login.guestPreparing : t.login.guest}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t.login.guestDescription}</p>
    </form>
    </div>
  );
}
