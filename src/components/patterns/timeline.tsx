import { Phone, MessageSquare, Mail, Users, Store, StickyNote, Package, MapPin, ListChecks, GitCommitHorizontal, Bot, type LucideIcon } from "lucide-react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  kind: string;
  channel?: string | null;
  subject?: string | null;
  body?: string | null;
  occurred_at: string;
  actor_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

const KIND_ICON: Record<string, LucideIcon> = {
  call: Phone,
  message: MessageSquare,
  email: Mail,
  meeting: Users,
  walk_in: Store,
  note: StickyNote,
  sample: Package,
  site_visit: MapPin,
  task_outcome: ListChecks,
  stage_change: GitCommitHorizontal,
  system: Bot,
};

/** Append-oriented evidence timeline (PRD §7.3). */
export function Timeline({ items, emptyText = "No activity yet.", className }: { items: TimelineItem[]; emptyText?: string; className?: string }) {
  if (items.length === 0) return <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol className={cn("relative space-y-3 border-l pl-5", className)}>
      {items.map((it) => {
        const Icon = KIND_ICON[it.kind] ?? StickyNote;
        return (
          <li key={it.id} className="relative">
            <span className="absolute -left-[29px] flex size-[18px] items-center justify-center rounded-full border bg-card">
              <Icon className="size-3 text-muted-foreground" aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-medium">{it.subject ?? it.kind.replace(/_/g, " ")}</span>
              <time className="tnum text-[11px] text-muted-foreground" title={formatDateTime(it.occurred_at)} dateTime={it.occurred_at}>
                {formatRelative(it.occurred_at)}
              </time>
            </div>
            {it.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{it.body}</p>}
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              {it.actor_name && <span>{it.actor_name}</span>}
              {it.channel && <span>· {it.channel.replace(/_/g, " ")}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
