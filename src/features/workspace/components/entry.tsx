import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Construction, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TonePill } from "@/components/patterns/status-pill";
import type { DeniedPermission, Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** A large, labelled entry card: one system or queue, one obvious action. */
export function EntryCard({
  icon: Icon,
  title,
  summary,
  href,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  summary: string;
  href: string;
  action: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border bg-card p-5", className)}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
      </div>
      {children}
      <Button asChild size="lg" className="mt-auto h-11 w-full justify-between text-base sm:w-auto sm:self-start">
        <Link href={href}>
          {action} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}

/** An operational queue that does not exist yet: says so, shows no numbers. */
export function NotBuiltQueue({ icon: Icon, title, summary, t }: { icon: LucideIcon; title: string; summary: string; t: Messages }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-dashed p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <TonePill tone="neutral" label={t.queues.notBuilt} hint={t.queues.notBuiltHint} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      </div>
    </li>
  );
}

/**
 * The honest placeholder for an unbuilt Admin System queue, sized for a phone:
 * large type, an icon and a text label for the state, at most one action.
 */
export function NotBuiltState({ title, description, t, children }: { title: string; description: string; t: Messages; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-5 py-10 text-center">
      <Construction className="size-10 text-muted-foreground" aria-hidden />
      <TonePill tone="neutral" size="md" label={t.queues.notBuilt} hint={t.queues.notBuiltHint} />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-base leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

/** Refusal for an entry page the role cannot open, with the way back home. */
export function AreaDenied({ permission, roleLabel, home, t }: { permission: DeniedPermission; roleLabel: string; home: string; t: Messages }) {
  return (
    <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Lock className="size-8 text-muted-foreground/60" aria-hidden />
      <h1 className="text-lg font-semibold">{t.denied.title}</h1>
      <p className="text-sm text-muted-foreground">{roleLabel}</p>
      <p className="max-w-md text-base text-muted-foreground">{t.denied.reasons[permission]}</p>
      <Button asChild size="lg" className="h-11 text-base">
        <Link href={home}>{t.denied.goHome}</Link>
      </Button>
    </div>
  );
}
