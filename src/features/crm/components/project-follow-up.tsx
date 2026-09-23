"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { useSession } from "@/components/shell/session-context";
import { assignProjectAction, followUpProjectAction } from "@/server/commands/projects";
import type { ProjectDetail } from "@/server/queries/projects";
import { FormDialog, formToObject } from "./form-dialog";
import { clean, MemberSelect, projectHandlers, type MemberOption } from "./selects";

export function ClaimProjectButton({ id, version }: { id: string; version: number }) {
  const { session, can } = useSession();
  const router = useRouter();
  const [pending, start] = useTransition();
  const request = useRef<{ version: number; id: string } | null>(null);
  if (!can("projects.follow_up")) return null;
  return <Button size="sm" disabled={pending} onClick={(e) => { e.stopPropagation(); start(async () => {
    if (!request.current || request.current.version !== version) request.current = { version, id: crypto.randomUUID() };
    try {
      const res = await assignProjectAction({ id, version, request_id: request.current.id, owner_id: session.userId, note: "Claimed for follow-up" });
      if (!res.ok) { toast.error(res.error); router.refresh(); return; }
      toast.success("You are handling this project."); router.refresh();
    } catch { toast.error("Assignment could not be confirmed. Retry to check the same request."); }
  }); }}>{pending ? "Claiming…" : "I'll handle this"}</Button>;
}

export function AssignProjectDialog({ project, members, open, onOpenChange }: { project: ProjectDetail; members: MemberOption[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const request = useRef<string | null>(null);
  const current = members.find((m) => m.user_id === project.owner_id)?.full_name ?? "Unassigned";
  return <FormDialog open={open} onOpenChange={onOpenChange} title="Assign project handler" submitLabel="Assign handler"
    description={`Currently: ${current}. Everyone can still see this project after assignment.`}
    action={async (fd) => { request.current ??= crypto.randomUUID(); return assignProjectAction({ ...clean(formToObject(fd)), id: project.id, version: project.version, request_id: request.current }); }}>
    <Field label="Internal project handler" htmlFor="handler"><MemberSelect id="handler" name="owner_id" members={projectHandlers(members)} defaultValue={project.owner_id} /></Field>
    <Field label="Handover reason" htmlFor="handover" required={!!project.owner_id} hint="Explain a change of handler so the team can follow the handover."><Textarea id="handover" name="note" required={!!project.owner_id} maxLength={4000} rows={3} /></Field>
  </FormDialog>;
}

export function ProjectFollowUpDialog({ project, open, onOpenChange }: { project: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const request = useRef<string | null>(null);
  return <FormDialog open={open} onOpenChange={onOpenChange} title="Log project follow-up" submitLabel="Record follow-up"
    description="Your name and the time are saved with this update. The current project handler stays assigned."
    action={async (fd) => { request.current ??= crypto.randomUUID(); return followUpProjectAction({ ...clean(formToObject(fd)), id: project.id, version: project.version, request_id: request.current }); }}>
    <Field label="Follow-up / outcome" htmlFor="followup-note" required><Textarea id="followup-note" name="note" required autoFocus rows={4} maxLength={4000} placeholder="Who you contacted, what they need, and what was agreed" /></Field>
    <Field label="Next action" htmlFor="next-action"><Input id="next-action" name="next_action" maxLength={1000} defaultValue={project.next_action ?? ""} placeholder="Optional" /></Field>
    <Field label="Next action due (Malaysia)" htmlFor="next-due"><Input id="next-due" name="next_action_due_at" type="datetime-local" defaultValue={project.next_action_due_at ? new Date(new Date(project.next_action_due_at).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : ""} /></Field>
  </FormDialog>;
}
