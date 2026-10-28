import { htmlLang, type Locale } from "@/lib/i18n/locale";

/** Declares the language of a translated page without adding a layout box. */
export function Localized({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <div lang={htmlLang(locale)} className="contents">
      {children}
    </div>
  );
}
