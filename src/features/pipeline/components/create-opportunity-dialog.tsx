"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { EntitySearch } from "@/features/crm/components/entity-search";
import { EnumSelect, MemberSelect, clean, type MemberOption } from "@/features/crm/components/selects";
import { SOURCE_CHANNELS } from "@/features/crm/schema";
import { createOpportunityAction } from "@/server/commands/opportunities";
import { useSession } from "@/components/shell/session-context";

export function CreateOpportunityDialog({ open, onOpenChange, members, defaults }: {
  open: boolean; onOpenChange: (open: boolean) => void; members: MemberOption[];
  defaults?: { account_id?: string; account_name?: string; contact_id?: string; contact_name?: string; project_id?: string };
}) {
  const router = useRouter();
  const { can, session } = useSession();
  const request = useRef<string | null>(null);
  return <FormDialog open={open} onOpenChange={onOpenChange} title="New opportunity" submitLabel="Create opportunity"
    description="Choose a contact or company. A physical project is optional; you can create opportunities for an existing company at any time."
    action={async (fd) => {
      request.current ??= crypto.randomUUID();
      return createOpportunityAction({ ...clean(formToObject(fd)), project_id: defaults?.project_id, request_id: request.current });
    }} onSuccess={(data) => { request.current = null; if (data?.opportunity_id) router.push(`/sales/pipeline?opportunity=${data.opportunity_id}`); }}>
    <Field label="Opportunity name" htmlFor="opportunity-name" required><Input id="opportunity-name" name="name" required autoFocus placeholder="Kitchen tiles — quotation" /></Field>
    <EntitySearch kind="account" name="account_id" label="Company" defaultId={defaults?.account_id} defaultName={defaults?.account_name} />
    <EntitySearch kind="contact" name="contact_id" label="Contact" defaultId={defaults?.contact_id} defaultName={defaults?.contact_name} />
    <p className="text-xs text-muted-foreground">New customer? <Link className="underline" href="/sales/accounts?new=contact">Create a contact</Link> or <Link className="underline" href="/sales/accounts?new=account">create a company</Link> first, then use New opportunity on their record.</p>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Estimated value (MYR)" htmlFor="opportunity-value"><Input id="opportunity-value" name="estimated_value" type="number" min="0" step="0.01" /></Field>
      <Field label="Source"><EnumSelect name="source_channel" options={SOURCE_CHANNELS} /></Field>
    </div>
    <Field label="Next action" htmlFor="opportunity-next" required><Input id="opportunity-next" name="next_action" required placeholder="Send tile options" /></Field>
    <Field label="Due (Malaysia time)" htmlFor="opportunity-due" required><Input id="opportunity-due" name="next_action_due_at" type="datetime-local" required /></Field>
    {can("sales.assign") ? <Field label="Owner"><MemberSelect name="owner_id" members={members} defaultValue={session.userId} /></Field> : <input type="hidden" name="owner_id" value={session.userId} />}
    <Field label="Remarks" htmlFor="opportunity-notes"><Textarea id="opportunity-notes" name="notes" rows={3} /></Field>
  </FormDialog>;
}
