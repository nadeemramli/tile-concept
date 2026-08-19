"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/patterns/data-table";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill } from "@/components/patterns/status-pill";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { ViewsBar } from "@/features/inbox/components/views-bar";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/domain/status-maps";
import { formatDateTime, formatRelative, isOverdue } from "@/lib/format";
import { useSession } from "@/components/shell/session-context";
import { cn } from "@/lib/utils";
import { cancelTaskAction, completeTaskAction, createTaskAction, reopenTaskAction, updateTaskAction } from "@/server/commands/tasks";
import type { TaskRow } from "@/features/tasks/types";
import type { TaskView } from "@/features/tasks/schema";
import type { ProfileRef } from "@/server/queries/reference";

interface Props {
  view: TaskView;
  tasks: TaskRow[];
  counts: { mine: number; overdue: number; open: number; doneWeek: number };
  members: ProfileRef[];
  prefill: { contact_id?: string; opportunity_id?: string; lead_id?: string; account_id?: string; project_id?: string };
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function TasksClient({ view, tasks, counts, members, prefill }: Props) {
  const router = useRouter();
  const { session, can } = useSession();
  const [taskId, setTaskId] = useQueryState("task");
  const [newParam, setNewParam] = useQueryState("new");
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState("");
  const [completing, setCompleting] = useState(false);

  const task = tasks.find((t) => t.id === taskId) ?? null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Failed");
        return;
      }
      if (r.message) toast.success(r.message);
      after?.();
      router.refresh();
    });

  const columns = useMemo<ColumnDef<TaskRow, unknown>[]>(
    () => [
      { accessorKey: "title", header: "Task", cell: ({ row }) => <span className={cn("font-medium", row.original.status !== "open" && "text-muted-foreground line-through")}>{row.original.title}</span> },
      { accessorKey: "priority", header: "Priority", cell: ({ row }) => <StatusPill map={TASK_PRIORITY} value={row.original.priority} /> },
      {
        accessorKey: "due_at",
        header: "Due",
        cell: ({ row }) => {
          const t = row.original;
          if (!t.due_at) return <span className="text-muted-foreground">—</span>;
          const over = t.status === "open" && isOverdue(t.due_at);
          return <span className={cn("tnum", over ? "font-medium text-destructive" : "text-muted-foreground")} title={formatDateTime(t.due_at)}>{formatRelative(t.due_at)}</span>;
        },
      },
      { accessorKey: "assignee_name", header: "Assignee", cell: ({ row }) => row.original.assignee_name ?? <span className="text-muted-foreground">Unassigned</span> },
      {
        id: "links",
        header: "Linked to",
        accessorFn: (r) => `${r.contact_name ?? ""} ${r.opportunity_name ?? ""}`,
        cell: ({ row }) => (
          <div className="flex flex-col text-xs">
            {row.original.contact_id && <Link href={`/sales/contacts/${row.original.contact_id}`} className="truncate hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.contact_name ?? "Contact"}</Link>}
            {row.original.opportunity_id && <Link href={`/sales/pipeline?opportunity=${row.original.opportunity_id}`} className="truncate text-muted-foreground hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.opportunity_name ?? "Opportunity"}</Link>}
            {!row.original.contact_id && !row.original.opportunity_id && <span className="text-muted-foreground">—</span>}
          </div>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={TASK_STATUS} value={row.original.status} /> },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="My open tasks" value={counts.mine} href="/sales/tasks?view=mine" info={{ definition: "Open tasks assigned to you.", grain: "Task", source: "sales.tasks" }} />
        <MetricCard compact label="Overdue" value={counts.overdue} tone={counts.overdue ? "destructive" : "neutral"} href="/sales/tasks?view=overdue" info={{ definition: "Open tasks past their due time (all visible owners).", grain: "Task", source: "sales.tasks" }} />
        <MetricCard compact label="All open" value={counts.open} href="/sales/tasks?view=all" info={{ definition: "Open tasks within your scope.", grain: "Task", source: "sales.tasks" }} />
        <MetricCard compact label="Done (7d)" value={counts.doneWeek} tone="success" href="/sales/tasks?view=done" info={{ definition: "Tasks completed in the last 7 days.", grain: "Task", source: "sales.tasks" }} />
      </div>

      <ViewsBar
        tabs={[
          { key: "mine", label: "My work", count: counts.mine },
          { key: "overdue", label: "Overdue", count: counts.overdue },
          { key: "all", label: "All open", count: counts.open },
          { key: "done", label: "Done / cancelled" },
        ]}
        active={view}
        basePath="/sales/tasks"
        extra={can("sales.write") ? <Button size="sm" className="h-7" onClick={() => setNewParam("1")}><Plus className="size-3.5" aria-hidden /> New task</Button> : null}
      />

      <DataTable columns={columns} data={tasks} rowKey={(r) => r.id} searchable columnToggle onRowClick={(r) => setTaskId(r.id)} isRowActive={(r) => r.id === taskId} emptyTitle="No tasks here" emptyDescription="Tasks are created from leads, opportunities and contacts, or directly." />

      <RecordDrawer
        open={!!task}
        onOpenChange={(o) => !o && setTaskId(null)}
        width="md"
        title={task ? <span className="flex items-center gap-2">{task.title} <StatusPill map={TASK_STATUS} value={task.status} size="md" /></span> : ""}
        description={task?.due_at ? `Due ${formatDateTime(task.due_at)}` : "No due date"}
      >
        {task && (
          <>
            <div className="flex flex-wrap gap-2">
              {task.status === "open" && can("sales.write") && (
                <>
                  <Button size="sm" className="h-7" onClick={() => setCompleting(true)}><Check className="size-3.5" aria-hidden /> Complete</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={pending} onClick={() => run(() => cancelTaskAction(task.id))}><X className="size-3.5" aria-hidden /> Cancel</Button>
                </>
              )}
              {task.status !== "open" && can("sales.write") && (
                <Button size="sm" variant="outline" className="h-7" disabled={pending} onClick={() => run(() => reopenTaskAction(task.id))}><RotateCcw className="size-3.5" aria-hidden /> Reopen</Button>
              )}
            </div>
            <DrawerSection title="Details">
              <FactList
                items={[
                  { label: "Priority", value: <StatusPill map={TASK_PRIORITY} value={task.priority} /> },
                  { label: "Assignee", value: task.assignee_name ?? "Unassigned" },
                  { label: "Created", value: formatRelative(task.created_at) },
                  { label: "Completed", value: task.completed_at ? formatDateTime(task.completed_at) : "—" },
                  { label: "Contact", value: task.contact_id ? <Link href={`/sales/contacts/${task.contact_id}`} className="hover:underline">{task.contact_name ?? "Open"}</Link> : "—" },
                  { label: "Opportunity", value: task.opportunity_id ? <Link href={`/sales/pipeline?opportunity=${task.opportunity_id}`} className="hover:underline">{task.opportunity_name ?? "Open"}</Link> : "—" },
                  { label: "Lead", value: task.lead_id ? <Link href={`/sales/inbox?view=all&lead=${task.lead_id}`} className="hover:underline">Open lead</Link> : "—" },
                  { label: "Project", value: task.project_id ? <Link href={`/sales/projects/${task.project_id}`} className="hover:underline">Open project</Link> : "—" },
                ]}
              />
              {task.description && <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-sm">{task.description}</p>}
              {task.outcome && <p className="text-sm"><span className="text-muted-foreground">Outcome: </span>{task.outcome}</p>}
            </DrawerSection>
            {task.status === "open" && can("sales.write") && (
              <DrawerSection title="Edit">
                <EditForm task={task} members={members} pending={pending} onSave={(patch) => run(() => updateTaskAction({ task_id: task.id, ...patch }))} />
              </DrawerSection>
            )}
          </>
        )}
      </RecordDrawer>

      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete task</DialogTitle>
            <DialogDescription>The outcome is appended to the linked contact / opportunity timeline.</DialogDescription>
          </DialogHeader>
          <Field label="Outcome (optional)"><Textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus /></Field>
          <DialogFooter>
            <Button disabled={pending || !task} onClick={() => task && run(() => completeTaskAction({ task_id: task.id, outcome }), () => { setCompleting(false); setOutcome(""); })}>{pending ? "Saving…" : "Mark done"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewTaskDialog open={newParam === "1"} onOpenChange={(o) => setNewParam(o ? "1" : null)} members={members} defaultAssignee={session.userId} prefill={prefill} onCreated={() => router.refresh()} />
    </div>
  );
}

function EditForm({ task, members, pending, onSave }: { task: TaskRow; members: ProfileRef[]; pending: boolean; onSave: (patch: { due_at?: string; assignee_id?: string; priority?: "low" | "normal" | "high" | "urgent" }) => void }) {
  const [due, setDue] = useState(toLocalInput(task.due_at));
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [priority, setPriority] = useState(task.priority as "low" | "normal" | "high" | "urgent");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Due"><Input type="datetime-local" className="h-8" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <Field label="Assignee">
        <Select value={assignee || "none"} onValueChange={(v) => setAssignee(v === "none" ? "" : v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">Unassigned</SelectItem>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Priority">
        <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>{(["low", "normal", "high", "urgent"] as const).map((p) => <SelectItem key={p} value={p}>{TASK_PRIORITY[p].label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="sm:col-span-3"><Button size="sm" className="h-7" disabled={pending} onClick={() => onSave({ due_at: due, assignee_id: assignee, priority })}>Save changes</Button></div>
    </div>
  );
}

export function NewTaskDialog({ open, onOpenChange, members, defaultAssignee, prefill, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; members: ProfileRef[]; defaultAssignee: string; prefill: Props["prefill"]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [contactId, setContactId] = useState(prefill.contact_id ?? "");
  const [oppId, setOppId] = useState(prefill.opportunity_id ?? "");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Tasks drive the “My work” list and the Command Centre.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title" required><Input className="h-8" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{(["low", "normal", "high", "urgent"] as const).map((p) => <SelectItem key={p} value={p}>{TASK_PRIORITY[p].label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Due"><Input type="datetime-local" className="h-8" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Assignee">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact id (optional)" hint="Prefilled when opened from a record"><Input className="h-8 font-mono text-xs" value={contactId} onChange={(e) => setContactId(e.target.value)} /></Field>
            <Field label="Opportunity id (optional)"><Input className="h-8 font-mono text-xs" value={oppId} onChange={(e) => setOppId(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || title.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await createTaskAction({ title, description, priority, due_at: due, assignee_id: assignee, contact_id: contactId, opportunity_id: oppId, lead_id: prefill.lead_id ?? "", account_id: prefill.account_id ?? "", project_id: prefill.project_id ?? "" });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.message);
                setTitle(""); setDescription(""); setDue("");
                onOpenChange(false);
                onCreated();
              })
            }
          >
            {pending ? "Saving…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
