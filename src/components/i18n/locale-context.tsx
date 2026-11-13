"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { messages, type Messages } from "@/lib/i18n/messages";

const Ctx = createContext<{ locale: Locale; t: Messages } | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: messages(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Falls back to the default language outside the provider (e.g. isolated tests). */
export function useLocale() {
  return useContext(Ctx) ?? { locale: DEFAULT_LOCALE, t: messages(DEFAULT_LOCALE) };
}
