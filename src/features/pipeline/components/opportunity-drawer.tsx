"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, FileText, ListTodo, MessageSquarePlus, Pencil, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { OPPORTUNITY_STATUS, SOURCE_CHANNEL, STAGE_GROUP_TONE, TASK_STATUS } from "@/lib/domain/status-maps";
import { Timeline } from "@/components/patterns/timeline";
import { formatDate, formatDateTime, formatMoney, formatRelative, isOverdue, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/shell/session-context";
import type { OpportunityDetail } from "@/server/queries/opportunities";
import type { StageRef } from "@/server/queries/reference";
import type { MemberOption } from "@/features/crm/components/selects";
import { StageChangeDialog } from "@/features/pipeline/components/stage-dialog";
import { EditOpportunityDialog, QuoteVersionDialog, ReassignDialog } from "@/features/pipeline/components/opportunity-dialogs";
import { ActivityDialog, TaskDialog } from "@/features/crm/components/dialogs";
import { PurchasesList, QuotesList } from "@/features/crm/components/detail-sections";

type Which = "stage" | "edit" | "quote" | "activity" | "task" | "reassign" | null;

export function OpportunityDrawer({ opp, stages, members, suggestedQuoteNumber, onClose }: { opp: OpportunityDetail; stages: StageRef[]; members: MemberOption[]; suggestedQuoteNumber: string; onClose: () => void }) {
  const { can, session } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const stage = stages.find((s) => s.key === opp.stage_key);
  const names = new Map(members.map((m) => [m.user_id, m.full_name]));
  const canWrite = can("sales.write") && (can("sales.read_all") || !opp.owner_id || opp.owner_id === session.userId);
  const closed = opp.status !== "open";
  const stageLabel = (k: string | null) => stages.find((s) => s.key === k)?.label ?? k ?? "—";

  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {opp.name}
          <TonePill tone={STAGE_GROUP_TONE[stage?.reporting_group ?? "open"] ?? "info"} label={stage?.label ?? opp.stage_key} size="md" />
          <StatusPill map={OPPORTUNITY_STATUS} value={opp.status} />
        </span>
      }
      description={
        <span className="flex flex-wrap gap-x-2">
          {opp.account_id && (
            <Link href={`/sales/accounts/${opp.account_id}`} className="hover:underline">
              {opp.account_name}
            </Link>
          )}
          {opp.contact_id && (
            <Link href={`/sales/contacts/${opp.contact_id}`} className="hover:underline">
              {opp.contact_name}
            </Link>
          )}
          {opp.project_id && (
            <Link href={`/sales/projects/${opp.project_id}`} className="hover:underline">
              · {opp.project_name}
            </Link>
          )}
        </span>
      }
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setOpen("stage")}>
            <ArrowRightLeft className="size-3.5" aria-hidden /> Stage
          </Button>
        ) : null
      }
    >
      {closed && (
        <div className={cn("rounded-md border px-3 py-2 text-sm", opp.status === "won" ? "border-success/30 bg-success/10 text-success" : opp.status === "lost" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/50")}>
          <span className="font-medium">{titleCase(opp.status)}</span>
          {opp.won_at && ` · ${formatDate(opp.won_at)}`}
          {opp.lost_at && ` · ${formatDate(opp.lost_at)}`}
          {opp.deferred_until && ` · until ${formatDate(opp.deferred_until)}`}
          {opp.outcome_reason && <span className="block text-xs opacity-90">Reason: {opp.outcome_reason}</span>}
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("quote")}>
            <FileText className="size-3.5" aria-hidden /> Quote version
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("activity")}>
            <MessageSquarePlus className="size-3.5" aria-hidden /> Activity
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("task")}>
            <ListTodo className="size-3.5" aria-hidden /> Task
          </Button>
          {can("sales.assign") && (
            <Button variant="outline" size="sm" onClick={() => setOpen("reassign")}>
              <UserCog className="size-3.5" aria-hidden /> Reassign
            </Button>
          )}
        </div>
      )}

      <DrawerSection title="Facts">
        <FactList
          items={[
            { label: "Estimated value", value: opp.estimated_value !== null ? formatMoney(opp.estimated_value, opp.currency) : "—", mono: true },
            { label: "Probability", value: opp.probability_band ? titleCase(opp.probability_band) : "—" },
            { label: "Expected close", value: formatDate(opp.expected_close_date) },
            { label: "Owner", value: names.get(opp.owner_id ?? "") ?? "Unassigned" },
            { label: "Next action", value: <span className={cn(isOverdue(opp.next_action_due_at) && !closed && "text-destructive")}>{opp.next_action ?? "—"}{opp.next_action_due_at ? ` · ${formatRelative(opp.next_action_due_at)}` : ""}</span> },
            { label: "Source", value: opp.source_channel ? <StatusPill map={SOURCE_CHANNEL} value={opp.source_channel} /> : "—" },
            { label: "Product interest", value: opp.product_interest.length ? opp.product_interest.map(titleCase).join(", ") : "—" },
            { label: "Competitor", value: opp.competitor ?? "—" },
            { label: "Created", value: formatDateTime(opp.created_at) },
            { label: "Updated", value: formatRelative(opp.updated_at) },
          ]}
        />
        {opp.notes && <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{opp.notes}</p>}
      </DrawerSection>

      <DrawerSection title={`Quotes (${opp.quotes.length})`}>
        <QuotesList items={opp.quotes} />
      </DrawerSection>

      <DrawerSection title={`Stage history (${opp.stage_events.length})`}>
        <ul className="space-y-1 text-sm">
          {opp.stage_events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="tnum text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
              <span>
                {stageLabel(e.from_stage_key)} → <span className="font-medium">{stageLabel(e.to_stage_key)}</span>
              </span>
              {e.is_backward && <TonePill tone="warning" label="backward" />}
              <span className="text-xs text-muted-foreground">{names.get(e.actor_id ?? "") ?? "system"}</span>
              {e.reason && <span className="text-xs italic text-muted-foreground">“{e.reason}”</span>}
            </li>
          ))}
        </ul>
      </DrawerSection>

      <DrawerSection title={`Tasks (${opp.tasks.length})`}>
        {opp.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks.</p>
        ) : (
          <ul className="divide-y text-sm">
            {opp.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-1.5">
                <Link href={`/sales/tasks?task=${t.id}`} className="flex-1 truncate hover:underline">
                  {t.title}
                </Link>
                <span className={cn("tnum text-xs", isOverdue(t.due_at) && t.status === "open" ? "text-destructive" : "text-muted-foreground")}>{t.due_at ? formatRelative(t.due_at) : "—"}</span>
                <span className="text-xs text-muted-foreground">{names.get(t.assignee_id ?? "") ?? "—"}</span>
                <StatusPill map={TASK_STATUS} value={t.status} />
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title={`Purchases (${opp.purchases.length})`}>
        <PurchasesList items={opp.purchases} />
      </DrawerSection>

      <DrawerSection title="Timeline">
        <Timeline items={opp.timeline} />
      </DrawerSection>

      {canWrite && (
        <>
          <StageChangeDialog open={open === "stage"} onOpenChange={() => setOpen(null)} opportunityId={opp.id} currentStage={opp.stage_key} stages={stages} hasNextAction={!!opp.next_action && !!opp.next_action_due_at} />
          <EditOpportunityDialog open={open === "edit"} onOpenChange={() => setOpen(null)} opp={opp} members={members} canAssign={can("sales.assign")} />
          <QuoteVersionDialog open={open === "quote"} onOpenChange={() => setOpen(null)} opp={opp} suggestedNumber={suggestedQuoteNumber} />
          <ActivityDialog open={open === "activity"} onOpenChange={() => setOpen(null)} links={{ opportunity_id: opp.id, contact_id: opp.contact_id ?? undefined, account_id: opp.account_id ?? undefined, project_id: opp.project_id ?? undefined }} />
          <TaskDialog open={open === "task"} onOpenChange={() => setOpen(null)} members={members} links={{ opportunity_id: opp.id, contact_id: opp.contact_id ?? undefined, account_id: opp.account_id ?? undefined, project_id: opp.project_id ?? undefined }} defaultAssignee={session.userId} />
          {can("sales.assign") && <ReassignDialog open={open === "reassign"} onOpenChange={() => setOpen(null)} oppId={opp.id} members={members} current={opp.owner_id} />}
        </>
      )}
    </RecordDrawer>
  );
}
