"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-context";
import { htmlLang } from "@/lib/i18n/locale";

export default function MyLeadsError({ reset }: { reset: () => void }) {
  const { locale, t } = useLocale();
  return (
    <div lang={htmlLang(locale)} className="m-4 rounded-lg border p-6 md:m-6" role="alert">
      <h2 className="font-semibold">{t.myLeads.loadFailed}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t.myLeads.loadFailedHint}</p>
      <Button className="mt-4 h-11" onClick={reset}>{t.myLeads.retry}</Button>
    </div>
  );
}
