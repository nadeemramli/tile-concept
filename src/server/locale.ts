import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n/locale";

/** The interface language for this request; English unless an explicit saved language says otherwise. */
export const getLocale = cache(async (): Promise<Locale> => {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
});
