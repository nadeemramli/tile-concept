"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n/locale";
import { ok, type ActionResult } from "@/server/action-result";

/**
 * Remembers the interface language in a cookie. It works before sign-in (the
 * login page has the same toggle) and carries no authority of any kind.
 */
export async function setLocaleAction(locale: string): Promise<ActionResult<{ locale: string }>> {
  const value = parseLocale(locale);
  const store = await cookies();
  store.set(LOCALE_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return ok({ locale: value });
}
