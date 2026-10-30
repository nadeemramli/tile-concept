"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { EnumSelect, MemberSelect, clean, type MemberOption } from "@/features/crm/components/selects";
import { PRODUCT_INTERESTS, SOURCE_CHANNELS } from "@/features/crm/schema";
import { OPPORTUNITY_SEGMENTS } from "@/features/pipeline/schema";
import { reassignOpportunityAction, updateOpportunityAction } from "@/server/commands/opportunities";
import type { OpportunityDetail } from "@/server/queries/opportunities";
import { titleCase } from "@/lib/format";

type P = { open: boolean; onOpenChange: (o: boolean) => void };

export function EditOpportunityDialog({ open, onOpenChange, opp, members, canAssign }: P & { opp: OpportunityDetail; members: MemberOption[]; canAssign: boolean }) {
  const request = useRef<string | null>(null);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit opportunity"
      className="sm:max-w-xl"
      action={async (fd) => {
        const o = clean(formToObject(fd));
        o.product_interest = fd.getAll("product_interest[]");
        request.current ??= crypto.randomUUID();
        return updateOpportunityAction({ id: opp.id, version: opp.version, request_id: request.current, ...o });
      }}
    >
      <Field label="Name" htmlFor="name" required>
        <Input id="name" name="name" required defaultValue={opp.name} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Est. value" htmlFor="estimated_value">
          <Input id="estimated_value" name="estimated_value" type="number" step="0.01" min="0" className="tnum" defaultValue={opp.estimated_value ?? ""} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Input id="currency" name="currency" defaultValue={opp.currency} maxLength={3} className="font-mono uppercase" />
        </Field>
        <Field label="Probability">
          <EnumSelect name="probability_band" options={["low", "medium", "high"]} defaultValue={opp.probability_band} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Expected close" htmlFor="expected_close_date">
          <Input id="expected_close_date" name="expected_close_date" type="date" defaultValue={opp.expected_close_date ?? ""} />
        </Field>
        <Field label="Next action" htmlFor="next_action">
          <Input id="next_action" name="next_action" defaultValue={opp.next_action ?? ""} />
        </Field>
        <Field label="Due (Malaysia time)" htmlFor="next_action_due_at">
          <Input id="next_action_due_at" name="next_action_due_at" type="datetime-local" defaultValue={opp.next_action_due_at ? toLocalInput(opp.next_action_due_at) : ""} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Segment">
          <EnumSelect name="segment" options={OPPORTUNITY_SEGMENTS} defaultValue={opp.segment} labels={{ institutional: "Institutional / Gov", residential: "Residential", fnb: "F&B / Retail", hospitality: "Hospitality", commercial: "Commercial", other: "Other" }} />
        </Field>
        <Field label="Source">
          <EnumSelect name="source_channel" options={SOURCE_CHANNELS} defaultValue={opp.source_channel} />
        </Field>
        <Field label="Competitor" htmlFor="competitor">
          <Input id="competitor" name="competitor" defaultValue={opp.competitor ?? ""} />
        </Field>
      </div>
      <Field label="Product interest">
        <div className="flex flex-wrap gap-3">
          {PRODUCT_INTERESTS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-xs">
              <Checkbox name="product_interest[]" value={p} defaultChecked={opp.product_interest.includes(p)} /> {titleCase(p)}
            </label>
          ))}
        </div>
      </Field>
      {canAssign && (
        <Field label="Owner">
          <MemberSelect name="owner_id" members={members} defaultValue={opp.owner_id} />
        </Field>
      )}
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={3} defaultValue={opp.notes ?? ""} />
      </Field>
    </FormDialog>
  );
}

export function ReassignDialog({ open, onOpenChange, oppId, version, members, current }: P & { oppId: string; version: number; members: MemberOption[]; current: string | null }) {
  const request = useRef<string | null>(null);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Reassign owner" submitLabel="Reassign" action={async (fd) => { request.current ??= crypto.randomUUID(); return reassignOpportunityAction({ opportunity_id: oppId, version, request_id: request.current, ...clean(formToObject(fd)) }); }}>
      <Field label="New owner" required>
        <MemberSelect name="owner_id" members={members} defaultValue={current} />
      </Field>
      <Field label="Reason" htmlFor="reason">
        <Input id="reason" name="reason" />
      </Field>
    </FormDialog>
  );
}

function toLocalInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0,16);
}
