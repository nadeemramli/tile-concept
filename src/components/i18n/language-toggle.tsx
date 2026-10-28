"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LOCALES } from "@/lib/i18n/locale";
import { useLocale } from "@/components/i18n/locale-context";
import { setLocaleAction } from "@/server/commands/locale";

/**
 * BM | EN, always labelled in text (never a flag or an icon alone). The choice
 * is a cookie, so it holds across reloads and on the sign-in page.
 */
export function LanguageToggle({ className, size = "sm" }: { className?: string; size?: "sm" | "lg" }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={t.language.label} className={cn("inline-flex shrink-0 rounded-md border bg-background p-0.5", className)}>
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l === "ms" ? "ms" : "en"}
            aria-pressed={active}
            aria-label={l === "ms" ? t.language.msName : t.language.enName}
            disabled={pending}
            onClick={() => {
              if (active) return;
              startTransition(async () => {
                await setLocaleAction(l);
                router.refresh();
              });
            }}
            className={cn(
              "rounded font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              size === "lg" ? "min-w-12 px-3 py-2 text-sm" : "min-w-9 px-2 py-1 text-xs",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {l === "ms" ? t.language.ms : t.language.en}
          </button>
        );
      })}
    </div>
  );
}
