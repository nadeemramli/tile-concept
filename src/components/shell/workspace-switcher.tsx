"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, Check, ChevronDown, LayoutDashboard, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { useLocale } from "@/components/i18n/locale-context";
import { areaForPath, areaHome, canRememberDefault, permittedAreas, type Area } from "@/lib/workspace/areas";
import { setDefaultAreaAction } from "@/server/commands/workspace";
import { htmlLang } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

const ICONS = { operating: Briefcase, admin: Truck, neutral: LayoutDashboard } as const;

/**
 * Always visible in the top bar, so a person can see which system they are in.
 * Switching is ordinary client navigation inside the same session — no second
 * sign-in. It offers only areas the role can enter; the pages behind them still
 * check their own permissions, so the menu is a convenience, never a grant.
 */
export function WorkspaceSwitcher({ onNavigate, className, full = false }: { onNavigate?: () => void; className?: string; full?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, permissions, can } = useSession();
  const { locale, t } = useLocale();
  const lang = htmlLang(locale);
  const [pending, startTransition] = useTransition();

  const areas = permittedAreas(permissions);
  const current = areaForPath(pathname);
  const showOverview = can("overview.read");
  // Above both areas: the overview names itself; the chooser is just "Workspace".
  const onOverview = pathname === "/overview";
  const name = (a: Area | "neutral", short = false) =>
    a === "neutral"
      ? onOverview ? (short ? t.areas.overviewShort : t.areas.overview) : t.areas.workspace
      : a === "operating" ? (short ? t.areas.operatingShort : t.areas.operating) : short ? t.areas.adminShort : t.areas.admin;
  const Icon = ICONS[current];
  const label = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      {full ? (
        <span className="truncate">{name(current)}</span>
      ) : (
        <>
          <span className="truncate sm:hidden">{name(current, true)}</span>
          <span className="hidden truncate sm:inline">{name(current)}</span>
        </>
      )}
    </>
  );

  // One area and no overview: nothing to switch to, but still say where you are.
  if (areas.length <= 1 && !showOverview) {
    return (
      <Hint content={t.areas.onlyArea} focusable>
        <span lang={lang} className={cn("inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium", className)} data-testid="workspace-current">
          {label}
        </span>
      </Hint>
    );
  }

  const remember = canRememberDefault(permissions);
  const saveDefault = (value: string) => {
    const area = value === "ask" ? null : (value as Area);
    startTransition(async () => {
      const result = await setDefaultAreaAction(area);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(area ? t.areas.defaultSaved : t.areas.defaultCleared);
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button lang={lang} variant="outline" size="sm" className={cn("h-8 min-w-0 gap-1.5 px-2.5 font-medium", className)} aria-label={current === "neutral" && !onOverview ? t.areas.workspace : `${t.areas.workspace}: ${name(current)}`}>
          {label}
          <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent lang={lang} align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{t.areas.workspace}</DropdownMenuLabel>
        {showOverview && (
          <DropdownMenuItem asChild className="min-h-10">
            <Link href="/overview" onClick={onNavigate} aria-current={onOverview ? "page" : undefined}>
              <LayoutDashboard className="size-4" aria-hidden />
              <span className="flex-1">{t.areas.overview}</span>
              {onOverview && <Check className="size-4" aria-label={t.areas.current} />}
            </Link>
          </DropdownMenuItem>
        )}
        {areas.map((a) => {
          const AreaIcon = ICONS[a];
          return (
            <DropdownMenuItem key={a} asChild className="min-h-10">
              <Link href={areaHome(a, permissions)} onClick={onNavigate} aria-current={current === a ? "page" : undefined}>
                <AreaIcon className="size-4" aria-hidden />
                <span className="flex-1">{name(a)}</span>
                {current === a && <Check className="size-4" aria-label={t.areas.current} />}
              </Link>
            </DropdownMenuItem>
          );
        })}
        {remember && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{t.areas.isDefault}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={session.defaultArea ?? "ask"} onValueChange={saveDefault}>
              {areas.map((a) => (
                <DropdownMenuRadioItem key={a} value={a} disabled={pending} className="min-h-10">
                  {name(a)}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="ask" disabled={pending} className="min-h-10">
                {t.areas.askEachTime}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
