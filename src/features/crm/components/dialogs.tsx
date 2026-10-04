"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { EntitySearch } from "@/features/crm/components/entity-search";
import { EnumSelect, MemberSelect, projectHandlers, clean, type MemberOption } from "@/features/crm/components/selects";
import { ACCOUNT_TYPES, ACTIVITY_KINDS, CUSTOMER_TYPES, PROJECT_STATUSES, PROJECT_TYPES, SOURCE_CHANNELS } from "@/features/crm/schema";
import { addActivityAction, addConsentAction, addContactPointAction, addTaskAction, createContactAction, linkContactAccountAction, revealContactPointsAction, updateContactAction } from "@/server/commands/contacts";
import { addAccountAliasAction, createAccountAction, updateAccountAction } from "@/server/commands/accounts";
import { addProjectSiteAction, registerProjectAction, updateProjectAction } from "@/server/commands/projects";
import type { ContactDetail } from "@/server/queries/contacts";
import type { AccountDetail } from "@/server/queries/accounts";
import type { ProjectDetail } from "@/server/queries/projects";
import { titleCase } from "@/lib/format";

type DialogProps = { open: boolean; onOpenChange: (o: boolean) => void };

/* ------------------------------------------------------------------ contacts */

export function NewContactDialog({ open, onOpenChange, members, defaultAccountId, defaultAccountName }: DialogProps & { members: MemberOption[]; defaultAccountId?: string; defaultAccountName?: string }) {
  const router = useRouter();
  void members;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New contact"
      description="Identity suggestions are reversible — we check for duplicates after saving and never merge automatically."
      submitLabel="Create contact"
      action={async (fd) => createContactAction(clean(formToObject(fd)))}
      onSuccess={(d) => {
        if (d.duplicates > 0) toast.warning(`${d.duplicates} possible duplicate(s) — review them in Identity Review.`, { action: { label: "Review", onClick: () => router.push("/sales/identity-review") } });
        router.push(`/sales/contacts/${d.id}`);
      }}
    >
      <Field label="Full name" htmlFor="display_name" required>
        <Input id="display_name" name="display_name" required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" htmlFor="phone" hint="Normalized to +60…">
          <Input id="phone" name="phone" inputMode="tel" placeholder="012-345 6789" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer type">
          <EnumSelect name="customer_type" options={CUSTOMER_TYPES} />
        </Field>
        <Field label="Acquisition source">
          <EnumSelect name="source" options={SOURCE_CHANNELS} />
        </Field>
      </div>
      <EntitySearch kind="account" name="account_id" label="Account (optional)" defaultId={defaultAccountId} defaultName={defaultAccountName} />
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>
    </FormDialog>
  );
}

export function EditContactDialog({ open, onOpenChange, contact }: DialogProps & { contact: ContactDetail }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Edit contact" action={async (fd) => updateContactAction({ id: contact.id, ...clean(formToObject(fd)) })}>
      <Field label="Display name" htmlFor="display_name" required>
        <Input id="display_name" name="display_name" defaultValue={contact.display_name} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Given name" htmlFor="given_name">
          <Input id="given_name" name="given_name" defaultValue={contact.given_name ?? ""} />
        </Field>
        <Field label="Family name" htmlFor="family_name">
          <Input id="family_name" name="family_name" defaultValue={contact.family_name ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer type">
          <EnumSelect name="customer_type" options={CUSTOMER_TYPES} defaultValue={contact.customer_type} />
        </Field>
        <Field label="Preferred language" htmlFor="preferred_language">
          <Input id="preferred_language" name="preferred_language" defaultValue={contact.preferred_language ?? ""} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={3} defaultValue={contact.notes ?? ""} />
      </Field>
    </FormDialog>
  );
}

export function AddContactPointDialog({ open, onOpenChange, contactId }: DialogProps & { contactId: string }) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add phone or email"
      action={async (fd) => {
        const o = formToObject(fd);
        return addContactPointAction({ contact_id: contactId, kind: (o.kind as "phone" | "whatsapp" | "email" | "other") ?? "phone", value: String(o.value ?? ""), label: String(o.label ?? "") || undefined, is_primary: o.is_primary === "on" });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <EnumSelect name="kind" options={["phone", "whatsapp", "email", "other"]} defaultValue="phone" allowEmpty={false} />
        </Field>
        <Field label="Label" htmlFor="label">
          <Input id="label" name="label" placeholder="Office, personal…" />
        </Field>
      </div>
      <Field label="Value" htmlFor="value" required>
        <Input id="value" name="value" required autoFocus />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="is_primary" /> Make primary
      </label>
    </FormDialog>
  );
}

export function RevealButton({ contactId, canReveal }: { contactId: string; canReveal: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ id: string; kind: string; raw_value: string; normalized_value: string; is_primary: boolean; label: string | null }[] | null>(null);
  const [pending, start] = useTransition();
  if (!canReveal) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          start(async () => {
            const res = await revealContactPointsAction(contactId);
            if (res.ok) setRows(res.data);
            else toast.error(res.error);
          });
        }}
      >
        <Eye className="size-3.5" aria-hidden /> Reveal details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contact details</DialogTitle>
            <DialogDescription>This reveal is audited (actor, time, record).</DialogDescription>
          </DialogHeader>
          {pending || !rows ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contact points on record.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {titleCase(r.kind)}
                    {r.label ? ` · ${r.label}` : ""}
                    {r.is_primary ? " · primary" : ""}
                  </span>
                  <span className="font-mono text-[13px] tnum">
                    {r.normalized_value}
                    {r.raw_value !== r.normalized_value && <span className="ml-2 text-[11px] text-muted-foreground">({r.raw_value})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LinkAccountDialog({ open, onOpenChange, contactId }: DialogProps & { contactId: string }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Link to account" submitLabel="Link" action={async (fd) => linkContactAccountAction({ contact_id: contactId, ...clean(formToObject(fd)), is_primary: fd.get("is_primary") === "on" })}>
      <EntitySearch kind="account" name="account_id" label="Account" />
      <Field label="Role at account" htmlFor="role">
        <Input id="role" name="role" placeholder="Director, project manager…" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="is_primary" /> Primary account for this contact
      </label>
    </FormDialog>
  );
}

export function ConsentDialog({ open, onOpenChange, contactId }: DialogProps & { contactId: string }) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record consent"
      description="Contact consent for communication channels. Media permission for marketing is a separate Phase 2 record."
      action={async (fd) => {
        const o = clean(formToObject(fd));
        return addConsentAction({ contact_id: contactId, channel: String(o.channel), purpose: String(o.purpose), status: (o.status as "granted" | "declined" | "withdrawn" | "unknown") ?? "unknown", evidence: String(o.evidence ?? "") || undefined });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel">
          <EnumSelect name="channel" options={["whatsapp", "email", "sms", "phone", "marketing"]} defaultValue="whatsapp" allowEmpty={false} />
        </Field>
        <Field label="Status">
          <EnumSelect name="status" options={["granted", "declined", "withdrawn", "unknown"]} defaultValue="granted" allowEmpty={false} />
        </Field>
      </div>
      <Field label="Purpose" htmlFor="purpose" required>
        <Input id="purpose" name="purpose" required placeholder="Follow-up on inquiry" />
      </Field>
      <Field label="Evidence" htmlFor="evidence" hint="Where/how consent was given">
        <Input id="evidence" name="evidence" />
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ accounts */

export function NewAccountDialog({ open, onOpenChange, members }: DialogProps & { members: MemberOption[] }) {
  const router = useRouter();
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New account" submitLabel="Create account" action={async (fd) => createAccountAction(clean(formToObject(fd)))} onSuccess={(d) => router.push(`/sales/accounts/${d.id}`)}>
      <AccountFields members={members} />
    </FormDialog>
  );
}

export function EditAccountDialog({ open, onOpenChange, account, members }: DialogProps & { account: AccountDetail; members: MemberOption[] }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Edit account" action={async (fd) => updateAccountAction({ id: account.id, ...clean(formToObject(fd)) })}>
      <AccountFields members={members} account={account} />
    </FormDialog>
  );
}

function AccountFields({ members, account }: { members: MemberOption[]; account?: AccountDetail }) {
  return (
    <>
      <Field label="Company name" htmlFor="name" required>
        <Input id="name" name="name" required defaultValue={account?.name ?? ""} autoFocus={!account} />
      </Field>
      <Field label="Company telephone" htmlFor="telephone" hint="Company switchboard or office number. Each PIC keeps their own contact number."><Input id="telephone" name="telephone" inputMode="tel" maxLength={50} defaultValue={account?.telephone ?? ""} placeholder="03-1234 5678" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <EnumSelect name="account_type" options={ACCOUNT_TYPES} defaultValue={account?.account_type} />
        </Field>
        <Field label="Registration no." htmlFor="registration_number">
          <Input id="registration_number" name="registration_number" className="font-mono" defaultValue={account?.registration_number ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={account?.address.city ?? ""} />
        </Field>
        <Field label="State" htmlFor="state">
          <Input id="state" name="state" defaultValue={account?.address.state ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Website" htmlFor="website">
          <Input id="website" name="website" defaultValue={account?.website ?? ""} />
        </Field>
        <Field label="Owner">
          <MemberSelect name="owner_id" members={members} defaultValue={account?.owner_id} />
        </Field>
      </div>
      {!account && (
        <Field label="Acquisition source">
          <EnumSelect name="source" options={SOURCE_CHANNELS} />
        </Field>
      )}
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} defaultValue={account?.notes ?? ""} />
      </Field>
    </>
  );
}

export function AddAliasDialog({ open, onOpenChange, accountId }: DialogProps & { accountId: string }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add alias" description="Trading names, short names, or spellings used by staff and suppliers." submitLabel="Add" action={async (fd) => addAccountAliasAction(accountId, String(fd.get("alias") ?? ""))}>
      <Field label="Alias" htmlFor="alias" required>
        <Input id="alias" name="alias" required autoFocus />
      </Field>
    </FormDialog>
  );
}

export function AddContactToAccountDialog({ open, onOpenChange, accountId }: DialogProps & { accountId: string }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add contact to account" submitLabel="Link" action={async (fd) => linkContactAccountAction({ account_id: accountId, ...clean(formToObject(fd)), is_primary: fd.get("is_primary") === "on" })}>
      <EntitySearch kind="contact" name="contact_id" label="Contact" />
      <Field label="Role" htmlFor="role">
        <Input id="role" name="role" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="is_primary" /> Primary contact
      </label>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ activity / task */

export function ActivityDialog({ open, onOpenChange, links }: DialogProps & { links: { contact_id?: string; account_id?: string; project_id?: string; opportunity_id?: string } }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Log activity" submitLabel="Log" action={async (fd) => addActivityAction({ ...links, ...clean(formToObject(fd)) })}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <EnumSelect name="kind" options={ACTIVITY_KINDS} defaultValue="call" allowEmpty={false} />
        </Field>
        <Field label="Channel">
          <EnumSelect name="channel" options={["phone", "whatsapp", "email", "in_person", "other"]} />
        </Field>
      </div>
      <Field label="Subject" htmlFor="subject" required>
        <Input id="subject" name="subject" required autoFocus />
      </Field>
      <Field label="Notes" htmlFor="body">
        <Textarea id="body" name="body" rows={3} />
      </Field>
    </FormDialog>
  );
}

export function TaskDialog({ open, onOpenChange, members, links, defaultAssignee }: DialogProps & { members: MemberOption[]; links: { contact_id?: string; account_id?: string; project_id?: string; opportunity_id?: string }; defaultAssignee?: string }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New task" submitLabel="Create task" action={async (fd) => addTaskAction({ ...links, ...clean(formToObject(fd)) })}>
      <Field label="Title" htmlFor="title" required>
        <Input id="title" name="title" required autoFocus />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Due" htmlFor="due_at">
          <Input id="due_at" name="due_at" type="datetime-local" />
        </Field>
        <Field label="Priority">
          <EnumSelect name="priority" options={["low", "normal", "high", "urgent"]} defaultValue="normal" allowEmpty={false} />
        </Field>
        <Field label="Assignee">
          <MemberSelect name="assignee_id" members={members} defaultValue={defaultAssignee} placeholder="Me" />
        </Field>
      </div>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ projects */

export function ProjectOpportunityDialog({ open, onOpenChange, members, defaults }: DialogProps & { members: MemberOption[]; defaults?: { contact_id?: string; contact_name?: string; account_id?: string; account_name?: string } }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaults?.account_id ?? "");
  const request = useRef<string | null>(null);
  return <FormDialog open={open} onOpenChange={onOpenChange} title="Register project" submitLabel="Register project" closeOnSuccess={false}
    description="Start with a title. Everyone in the company can add details later; salespeople can pick up the follow-up."
    className="sm:max-w-xl"
    action={async (fd) => { request.current ??= crypto.randomUUID(); return registerProjectAction({ ...clean(formToObject(fd)), request_id: request.current }); }}
    onSuccess={(data) => router.push(`/sales/projects/${data.project_id}`)}>
    <Field label="Project title" htmlFor="project-name" required><Input id="project-name" name="name" required autoFocus maxLength={200} placeholder="e.g. New shop renovation in Cheras" /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Area / town" htmlFor="project-area"><Input id="project-area" name="area" placeholder="Optional" /></Field>
      <Field label="Internal project handler" htmlFor="project-handler" hint="Leave unassigned for a salesperson to claim."><MemberSelect id="project-handler" name="owner_id" members={projectHandlers(members)} /></Field>
    </div>
    <Field label="What the customer wants" htmlFor="project-notes"><Textarea id="project-notes" name="notes" rows={2} maxLength={4000} placeholder="Add anything known so far (optional)" /></Field>
    <details className="rounded-md border p-3" open={defaults?.account_id || defaults?.contact_id ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium">Add contacts, site and specifications</summary>
      <div className="mt-3 space-y-3">
        <EntitySearch project kind="account" name="account_id" label="Company" defaultId={defaults?.account_id} defaultName={defaults?.account_name} onSelect={(hit) => setAccountId(hit?.id ?? "")} />
        <EntitySearch project kind="contact" name="contact_id" label="Customer / project owner" defaultId={defaults?.contact_id} defaultName={defaults?.contact_name} />
        <EntitySearch project key={accountId} kind="contact" name="follow_up_contact_id" label="Customer/company PIC" accountId={accountId || undefined} />
        <Field label="Site location / address" htmlFor="project-site"><Textarea id="project-site" name="site_address" rows={2} maxLength={1000} /></Field>
        <Field label="Products / specifications proposed" htmlFor="project-spec"><Textarea id="project-spec" name="product_specification" rows={3} maxLength={4000} placeholder="Product, size, finish, quantity or application" /></Field>
        <Field label="Project type"><EnumSelect name="project_type" options={PROJECT_TYPES} defaultValue="other" allowEmpty={false} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Expected start" htmlFor="expected_start"><Input id="expected_start" name="expected_start" type="date" /></Field>
          <Field label="Expected completion" htmlFor="expected_completion"><Input id="expected_completion" name="expected_completion" type="date" /></Field>
        </div>
      </div>
    </details>
  </FormDialog>;
}

export function EditProjectDialog({ open, onOpenChange, project }: DialogProps & { project: ProjectDetail; members: MemberOption[] }) {
  const [accountId, setAccountId] = useState(project.account_id ?? "");
  const request = useRef<string | null>(null);
  return <FormDialog open={open} onOpenChange={onOpenChange} title="Enrich project" className="sm:max-w-xl"
    description="Add what you know. The project remains visible to the whole company."
    action={async (fd) => { request.current ??= crypto.randomUUID(); return updateProjectAction({ ...clean(formToObject(fd)), id: project.id, version: project.version, request_id: request.current }); }}>
    <Field label="Project title" htmlFor="name" required><Input id="name" name="name" required maxLength={200} defaultValue={project.name} /></Field>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Type"><EnumSelect name="project_type" options={PROJECT_TYPES} defaultValue={project.project_type ?? "other"} allowEmpty={false} /></Field>
      <Field label="Status"><EnumSelect name="status" options={PROJECT_STATUSES} defaultValue={project.status} allowEmpty={false} /></Field>
      <Field label="Area / town" htmlFor="area"><Input id="area" name="area" defaultValue={project.area ?? ""} /></Field>
    </div>
    <EntitySearch project kind="account" name="account_id" label="Company" defaultId={project.account_id ?? undefined} defaultName={project.account_name ?? undefined} onSelect={(hit) => setAccountId(hit?.id ?? "")} />
    <EntitySearch project kind="contact" name="contact_id" label="Customer / project owner" defaultId={project.contact_id ?? undefined} defaultName={project.contact_name ?? undefined} />
    <EntitySearch project key={accountId} kind="contact" name="follow_up_contact_id" label="Customer/company PIC" accountId={accountId || undefined} defaultId={accountId === (project.account_id ?? "") ? project.follow_up_contact_id ?? undefined : undefined} defaultName={accountId === (project.account_id ?? "") ? project.follow_up_contact_name ?? undefined : undefined} />
    <Field label="Site location / address" htmlFor="site_address"><Textarea id="site_address" name="site_address" maxLength={1000} rows={2} defaultValue={project.sites[0]?.address.line1 ?? ""} /></Field>
    <Field label="Products / specifications proposed" htmlFor="product_specification"><Textarea id="product_specification" name="product_specification" rows={3} maxLength={4000} defaultValue={project.product_specification ?? ""} /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Expected start" htmlFor="expected_start"><Input id="expected_start" name="expected_start" type="date" defaultValue={project.expected_start ?? ""} /></Field>
      <Field label="Expected completion" htmlFor="expected_completion"><Input id="expected_completion" name="expected_completion" type="date" defaultValue={project.expected_completion ?? ""} /></Field>
    </div>
    <Field label="What the customer wants / notes" htmlFor="notes"><Textarea id="notes" name="notes" rows={3} maxLength={4000} defaultValue={project.notes ?? ""} /></Field>
  </FormDialog>;
}

export function AddSiteDialog({ open, onOpenChange, projectId }: DialogProps & { projectId: string }) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Add site" submitLabel="Add" action={async (fd) => addProjectSiteAction({ project_id: projectId, ...clean(formToObject(fd)) })}>
      <Field label="Label" htmlFor="label" required>
        <Input id="label" name="label" required defaultValue="Site" />
      </Field>
      <Field label="Address line" htmlFor="line1">
        <Input id="line1" name="line1" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" htmlFor="city">
          <Input id="city" name="city" />
        </Field>
        <Field label="State" htmlFor="state">
          <Input id="state" name="state" />
        </Field>
      </div>
      <Field label="Access notes" htmlFor="access_notes">
        <Textarea id="access_notes" name="access_notes" rows={2} placeholder="Parking, guard house, lift booking…" />
      </Field>
    </FormDialog>
  );
}
