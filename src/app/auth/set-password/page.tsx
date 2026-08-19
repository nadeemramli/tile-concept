import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?reason=invalid-link");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Set your password</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}. Choose a password of at least 10 characters.</p>
        </div>
        <SetPasswordForm />
      </div>
    </div>
  );
}
