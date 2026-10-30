/**
 * Interface language for the shared sign-in and the workspace entry surfaces.
 * Bahasa Melayu is the default; English is one tap away and remembered in a
 * cookie so it also applies before sign-in. Existing Operating System screens
 * are still English-only (see docs/architecture/Workspace Entry.md).
 */
export const LOCALES = ["ms", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ms";
export const LOCALE_COOKIE = "tc.locale";

export function parseLocale(value: unknown): Locale {
  return value === "en" || value === "ms" ? value : DEFAULT_LOCALE;
}

/**
 * BCP 47 tag for a translated subtree. `<html lang>` stays "en" because the
 * Operating System screens are still English; translated surfaces declare
 * their own language so screen readers pronounce each part correctly.
 */
export function htmlLang(locale: Locale): string {
  return locale === "ms" ? "ms-MY" : "en";
}
