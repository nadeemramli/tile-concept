"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { EnumSelect, MemberSelect, clean, type MemberOption } from "@/features/crm/components/selects";
import { PRODUCT_INTERESTS, SOURCE_CHANNELS } from "@/features/crm/schema";
import { addQuoteVersionAction, reassignOpportunityAction, updateOpportunityAction } from "@/server/commands/opportunities";
import type { OpportunityDetail } from "@/server/queries/opportunities";
import { titleCase } from "@/lib/format";

type P = { open: boolean; onOpenChange: (o: boolean) => void };

export function EditOpportunityDialog({ open, onOpenChange, opp, members, canAssign }: P & { opp: OpportunityDetail; members: MemberOption[]; canAssign: boolean }) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit opportunity"
      className="sm:max-w-xl"
      action={async (fd) => {
        const o = clean(formToObject(fd));
        o.product_interest = fd.getAll("product_interest[]");
        return updateOpportunityAction({ id: opp.id, ...o });
      }}
    >
      <Field label="Name" htmlFor="name" required>
        <Input id="name" name="name" required defaultValue={opp.name} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
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
      <div className="grid grid-cols-3 gap-3">
        <Field label="Expected close" htmlFor="expected_close_date">
          <Input id="expected_close_date" name="expected_close_date" type="date" defaultValue={opp.expected_close_date ?? ""} />
        </Field>
        <Field label="Next action" htmlFor="next_action">
          <Input id="next_action" name="next_action" defaultValue={opp.next_action ?? ""} />
        </Field>
        <Field label="Due" htmlFor="next_action_due_at">
          <Input id="next_action_due_at" name="next_action_due_at" type="datetime-local" defaultValue={opp.next_action_due_at ? toLocalInput(opp.next_action_due_at) : ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
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

export function ReassignDialog({ open, onOpenChange, oppId, members, current }: P & { oppId: string; members: MemberOption[]; current: string | null }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Reassign owner" submitLabel="Reassign" action={async (fd) => reassignOpportunityAction({ opportunity_id: oppId, ...clean(formToObject(fd)) })}>
      <Field label="New owner" required>
        <MemberSelect name="owner_id" members={members} defaultValue={current} />
      </Field>
      <Field label="Reason" htmlFor="reason">
        <Input id="reason" name="reason" />
      </Field>
    </FormDialog>
  );
}

export function QuoteVersionDialog({ open, onOpenChange, opp, suggestedNumber }: P & { opp: OpportunityDetail; suggestedNumber: string }) {
  const existing = opp.quotes[0];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? `Add quote version (v${existing.current_version_no + 1})` : "Add quote"}
      description="Each issued version is immutable. Link the SQL Account quotation number to keep one reference across systems."
      submitLabel="Issue version"
      action={async (fd) => addQuoteVersionAction({ opportunity_id: opp.id, quote_id: existing?.id, ...clean(formToObject(fd)), link_sql_document: fd.get("link_sql_document") === "on" })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quote number" htmlFor="quote_number" required>
          <Input id="quote_number" name="quote_number" className="font-mono" defaultValue={existing?.quote_number ?? suggestedNumber} readOnly={!!existing} required />
        </Field>
        <Field label="Total amount" htmlFor="total_amount">
          <Input id="total_amount" name="total_amount" type="number" step="0.01" min="0" className="tnum" defaultValue={opp.estimated_value ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Issued" htmlFor="issued_at">
          <Input id="issued_at" name="issued_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Valid until" htmlFor="valid_until">
          <Input id="valid_until" name="valid_until" type="date" />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Input id="currency" name="currency" defaultValue={opp.currency} maxLength={3} className="font-mono uppercase" />
        </Field>
      </div>
      <Field label="SQL Account quotation no. (external ref)" htmlFor="external_ref">
        <Input id="external_ref" name="external_ref" className="font-mono" placeholder="SQ-00123" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="link_sql_document" defaultChecked /> Record as external document link (system: SQL Account)
      </label>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>
    </FormDialog>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
