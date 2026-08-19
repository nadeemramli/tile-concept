import Link from "next/link";
import { StatusPill } from "@/components/patterns/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OPPORTUNITY_STATUS, PURCHASE_STATUS } from "@/lib/domain/status-maps";
import { formatDate, formatMoney, formatRelative, isOverdue, titleCase } from "@/lib/format";
import type { OpportunitySummary, PurchaseSummary, QuoteSummary, AuditRow } from "@/server/queries/contacts";
import { cn } from "@/lib/utils";

export function SectionCard({ title, count, action, children, className }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-2 py-3", className)}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>
            {title}
            {typeof count === "number" && <span className="tnum ml-1.5 text-xs font-normal text-muted-foreground">{count}</span>}
          </span>
          {action}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

export function OpportunitiesList({ items, stageLabels, memberNames }: { items: OpportunitySummary[]; stageLabels: Map<string, string>; memberNames: Map<string, string> }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No opportunities yet.</p>;
  return (
    <ul className="divide-y">
      {items.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <Link href={`/sales/pipeline?opportunity=${o.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            {o.name}
          </Link>
          <span className="text-xs text-muted-foreground">{stageLabels.get(o.stage_key) ?? o.stage_key}</span>
          <StatusPill map={OPPORTUNITY_STATUS} value={o.status} />
          <span className="tnum w-24 text-right">{o.estimated_value !== null ? formatMoney(o.estimated_value, o.currency) : "—"}</span>
          <span className={cn("tnum w-40 truncate text-xs", isOverdue(o.next_action_due_at) && o.status === "open" ? "text-destructive" : "text-muted-foreground")}>
            {o.next_action ?? "—"}
            {o.next_action_due_at ? ` · ${formatRelative(o.next_action_due_at)}` : ""}
          </span>
          <span className="w-24 truncate text-xs text-muted-foreground">{memberNames.get(o.owner_id ?? "") ?? "—"}</span>
        </li>
      ))}
    </ul>
  );
}

export function PurchasesList({ items }: { items: PurchaseSummary[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No purchases recorded.</p>;
  return (
    <ul className="divide-y">
      {items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span className="tnum w-24 text-xs text-muted-foreground">{formatDate(p.purchased_at)}</span>
          <span className="w-28 font-mono text-[12px] tnum">{p.external_ref ?? "—"}</span>
          <span className="tnum w-28 font-medium">{formatMoney(p.amount, p.currency)}</span>
          <span className="flex-1 truncate text-xs text-muted-foreground">{p.payments.map((m) => titleCase(m)).join(", ") || "—"}</span>
          {p.is_repeat && <span className="rounded-full border border-ai/25 bg-ai/12 px-2 text-[11px] text-ai">repeat</span>}
          <StatusPill map={PURCHASE_STATUS} value={p.status} />
        </li>
      ))}
    </ul>
  );
}

export function QuotesList({ items }: { items: QuoteSummary[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No quotes yet.</p>;
  return (
    <ul className="divide-y">
      {items.map((q) => (
        <li key={q.id} className="py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3">
            <span className="font-mono text-[12px] tnum">{q.quote_number ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{titleCase(q.status)}</span>
            <Link href={`/sales/pipeline?opportunity=${q.opportunity_id}`} className="truncate text-xs hover:underline">
              {q.opportunity_name}
            </Link>
            {q.external_docs.map((d) => (
              <span key={d.document_number} className="rounded border px-1.5 text-[11px] text-muted-foreground">
                {d.system}: {d.document_type} {d.document_number}
              </span>
            ))}
          </div>
          <ul className="mt-1 space-y-0.5 pl-3 text-xs text-muted-foreground">
            {q.versions.map((v) => (
              <li key={v.id} className="tnum">
                v{v.version_no} · {v.total_amount !== null ? formatMoney(v.total_amount, v.currency) : "—"} · issued {formatDate(v.issued_at)} · valid until {formatDate(v.valid_until)}
                {v.external_ref ? ` · ref ${v.external_ref}` : ""}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function AuditList({ items, memberNames }: { items: AuditRow[]; memberNames: Map<string, string> }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No audit events.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="tnum text-muted-foreground">{formatRelative(a.occurred_at)}</span>
          <span className="font-mono">{a.action}</span>
          {a.object_table && <span className="text-muted-foreground">{a.object_table}</span>}
          <span className="text-muted-foreground">{memberNames.get(a.actor_id ?? "") ?? "system"}</span>
          {a.reason && <span className="italic text-muted-foreground">“{a.reason}”</span>}
        </li>
      ))}
    </ul>
  );
}
