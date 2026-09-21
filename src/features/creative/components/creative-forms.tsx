"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog } from "@/features/crm/components/form-dialog";
import { createCreativeAction, creativeCommandAction } from "@/server/commands/creative";
import type { ActionResult } from "@/server/action-result";
import type { CreateCreativeInput, CreativeCommandInput } from "../schema";
import { CREATIVE_CHANNELS, CREATIVE_FORMATS, CREATIVE_SOURCE_MODES, CREATIVE_TEMPLATES, type CreativeDetail, type CreativeOptions, type CreativeCommandResult } from "../types";
import { CHANNEL_LABELS, CREATIVE_SELECT_CLASS, FORMAT_LABELS, SOURCE_MODE_META, TEMPLATE_META } from "../presentation";

export const fieldText = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
export const fieldNullable = (fd: FormData, name: string) => fieldText(fd, name) || null;
export const fieldChecked = (fd: FormData, name: string) => fd.get(name) === "on";
export type CreativeOperation = CreativeCommandInput extends infer C ? C extends CreativeCommandInput ? Omit<C, "id" | "expected_revision" | "request_id"> : never : never;

/** A network retry uses the same operation key; editing the payload gets a new one. */
export function useCreativeCommand(detail: Pick<CreativeDetail, "id" | "revision">) {
  const request = useRef({ body: "", id: "" });
  return async (operation: CreativeOperation): Promise<ActionResult<CreativeCommandResult>> => {
    const body = JSON.stringify({ ...operation, id: detail.id, expected_revision: detail.revision });
    if (body !== request.current.body) request.current = { body, id: crypto.randomUUID() };
    try {
      return await creativeCommandAction({ ...operation, id: detail.id, expected_revision: detail.revision, request_id: request.current.id });
    } catch {
      return { ok: false, error: "The connection was interrupted. Your entries are still here. Retry to check whether the change was saved." };
    }
  };
}

export function readCreativeDraft(fd: FormData): Omit<CreateCreativeInput, "request_id"> {
  return {
    title: fieldText(fd, "title"), template: fieldText(fd, "template") as CreateCreativeInput["template"],
    format: fieldNullable(fd, "format") as CreateCreativeInput["format"],
    source_mode: fieldText(fd, "source_mode") as CreateCreativeInput["source_mode"],
    owner_id: fieldNullable(fd, "owner_id"), reviewer_id: fieldNullable(fd, "reviewer_id"),
    production_due: fieldNullable(fd, "production_due"), review_due: fieldNullable(fd, "review_due"),
    channels: fd.getAll("channels").map(String) as CreateCreativeInput["channels"],
    priority: fieldText(fd, "priority") as CreateCreativeInput["priority"], next_action: fieldText(fd, "next_action"),
    brief: { objective: fieldText(fd, "objective"), audience: fieldText(fd, "audience"), key_message: fieldText(fd, "key_message"), cta: fieldText(fd, "cta"), shot_plan: fieldText(fd, "shot_plan"), caption: fieldText(fd, "caption"), mandatory_coverage: fieldText(fd, "mandatory_coverage"), claims: fieldText(fd, "claims") },
  };
}

export function CreativeDraftFields({ detail, options, initialTitle = "", defaultOwner, initialBrief, existingOutput }: { detail?: CreativeDetail; options: CreativeOptions; initialTitle?: string; defaultOwner?: string; initialBrief?: { title: string; key_message: string; mandatory_coverage: string }; existingOutput?: boolean }) {
  const [template, setTemplate] = useState<string>(detail?.template ?? "project_showcase");
  const [sourceMode, setSourceMode] = useState<string>(detail?.source_mode ?? (existingOutput ? "existing_footage" : "new_footage"));
  return <div className="space-y-5">
    <Field label="Creative title" htmlFor="title" required hint="One deliverable, such as a transformation reel. Each channel release is planned separately.">
      <Input id="title" name="title" required minLength={2} maxLength={200} defaultValue={detail?.title ?? initialTitle} placeholder="e.g. Kota Damansara kitchen transformation" />
    </Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Content template" htmlFor="template"><select id="template" name="template" className={CREATIVE_SELECT_CLASS} value={template} onChange={(e) => setTemplate(e.target.value)}>{CREATIVE_TEMPLATES.map((v) => <option key={v} value={v}>{TEMPLATE_META[v].label}</option>)}</select></Field>
      <Field label="Deliverable format" htmlFor="format"><select id="format" name="format" className={CREATIVE_SELECT_CLASS} defaultValue={detail?.format ?? ""}><option value="">Choose before production</option>{CREATIVE_FORMATS.map((v) => <option key={v} value={v}>{FORMAT_LABELS[v]}</option>)}</select></Field>
    </div>
    <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">{TEMPLATE_META[template].prompt}</p>
    <Field label="What source material will this use?" htmlFor="source_mode" hint={SOURCE_MODE_META[sourceMode].prompt}>
      <select id="source_mode" name="source_mode" className={CREATIVE_SELECT_CLASS} value={sourceMode} onChange={(e) => setSourceMode(e.target.value)}>{CREATIVE_SOURCE_MODES.map((v) => <option key={v} value={v}>{SOURCE_MODE_META[v].label}</option>)}</select>
    </Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Owner" htmlFor="owner_id"><select id="owner_id" name="owner_id" className={CREATIVE_SELECT_CLASS} defaultValue={detail?.owner_id ?? defaultOwner ?? ""}><option value="">Unassigned · triage needed</option>{options.members.filter((m) => m.can_write).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Reviewer" htmlFor="reviewer_id" hint="Only staff with creative approval access are listed."><select id="reviewer_id" name="reviewer_id" className={CREATIVE_SELECT_CLASS} defaultValue={detail?.reviewer_id ?? ""}><option value="">Choose before production</option>{options.members.filter((m) => m.can_review).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="Production due" htmlFor="production_due"><Input id="production_due" name="production_due" type="date" defaultValue={detail?.production_due ?? ""} /></Field>
      <Field label="Review due" htmlFor="review_due"><Input id="review_due" name="review_due" type="date" defaultValue={detail?.review_due ?? ""} /></Field>
    </div>
    <fieldset className="space-y-2"><legend className="text-xs font-medium">Intended channels</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{CREATIVE_CHANNELS.map((v) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="channels" value={v} defaultChecked={detail?.channels.includes(v)} className="size-4 accent-primary" />{CHANNEL_LABELS[v]}</label>)}</div></fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Objective" htmlFor="objective"><Textarea id="objective" name="objective" rows={2} defaultValue={detail?.brief.objective ?? ""} placeholder="What should this creative achieve?" /></Field>
      <Field label="Audience" htmlFor="audience"><Textarea id="audience" name="audience" rows={2} defaultValue={detail?.brief.audience ?? ""} placeholder="Who is this for?" /></Field>
      <Field label="Hook / key message" htmlFor="key_message"><Textarea id="key_message" name="key_message" rows={2} defaultValue={detail?.brief.key_message ?? initialBrief?.key_message ?? ""} /></Field>
      <Field label="Call to action" htmlFor="cta"><Textarea id="cta" name="cta" rows={2} defaultValue={detail?.brief.cta ?? ""} /></Field>
    </div>
    <Field label="Shot plan / interview questions" htmlFor="shot_plan" hint="List shots and questions here, or add a shot-list link under Sources after saving."><Textarea id="shot_plan" name="shot_plan" rows={3} defaultValue={detail?.brief.shot_plan ?? ""} /></Field>
    <Field label="Must-have coverage" htmlFor="mandatory_coverage" hint="Record what must be present before editing: before/after, detail shots, interview answers or approved copy."><Textarea id="mandatory_coverage" name="mandatory_coverage" rows={2} defaultValue={detail?.brief.mandatory_coverage ?? initialBrief?.mandatory_coverage ?? ""} /></Field>
    <Field label="Caption / copy" htmlFor="caption"><Textarea id="caption" name="caption" rows={3} defaultValue={detail?.brief.caption ?? ""} /></Field>
    <Field label="Facts, offer dates and claims to check" htmlFor="claims"><Textarea id="claims" name="claims" rows={2} defaultValue={detail?.brief.claims ?? ""} /></Field>
    <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
      <Field label="Next action" htmlFor="next_action"><Input id="next_action" name="next_action" defaultValue={detail?.next_action ?? ""} placeholder="e.g. Confirm before photos with Sales" /></Field>
      <Field label="Priority" htmlFor="priority"><select id="priority" name="priority" className={CREATIVE_SELECT_CLASS} defaultValue={detail?.priority ?? "normal"}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></Field>
    </div>
  </div>;
}

export function CreateCreativeDialog({ options, sourceId, shootId, outputId, defaultOwner, initialBrief, onClose, onCreated }: { initialBrief?: { title: string; key_message: string; mandatory_coverage: string }; options: CreativeOptions; sourceId?: string; shootId?: string; outputId?: string; defaultOwner: string; onClose: () => void; onCreated: (id: string) => void }) {
  const request = useRef({ body: "", id: "" });
  const created = useRef(false);
  const source = options.opportunities.find((o) => o.id === sourceId);
  const initialTitle = initialBrief?.title ?? (source ? `${source.title} · creative` : "");
  return <FormDialog open onOpenChange={(open) => { if (!open && !created.current) onClose(); }} title="New creative" description="Start with a draft. The next-step checks will guide you through preparation, production and review." submitLabel="Create draft" className="sm:max-w-2xl" action={async (fd) => {
    const input = { ...readCreativeDraft(fd), content_opportunity_id: sourceId ?? null, shoot_booking_id: shootId ?? null, shoot_output_id: outputId ?? null };
    const body = JSON.stringify(input);
    if (request.current.body !== body) request.current = { body, id: crypto.randomUUID() };
    try { const result = await createCreativeAction({ ...input, request_id: request.current.id }); created.current = result.ok; return result; }
    catch { return { ok: false, error: "The connection was interrupted. Retry with your entries intact." }; }
  }} onSuccess={(data) => onCreated(data.id)}>
    {(sourceId || shootId || outputId) && <p className="rounded-md border bg-muted/30 p-3 text-xs">This draft will be linked to the {shootId ? "selected shoot" : outputId ? "selected shoot asset" : "selected content opportunity"}. Customer media permission stays with the original source.</p>}
    <CreativeDraftFields options={options} initialBrief={initialBrief} existingOutput={Boolean(outputId)} initialTitle={initialTitle} defaultOwner={defaultOwner} />
  </FormDialog>;
}

export function EditCreativeDialog({ detail, options, onClose }: { detail: CreativeDetail; options: CreativeOptions; onClose: () => void }) {
  const run = useCreativeCommand(detail);
  const router = useRouter();
  return <FormDialog open onOpenChange={(open) => !open && onClose()} title="Edit creative brief" description="Changes are recorded in activity. Submitted and approved content must be reopened before it can change." className="sm:max-w-2xl" action={(fd) => run({ action: "update", data: readCreativeDraft(fd) })} onSuccess={() => router.refresh()}>
    <CreativeDraftFields detail={detail} options={options} />
  </FormDialog>;
}
