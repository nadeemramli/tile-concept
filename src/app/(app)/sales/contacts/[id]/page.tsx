import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getContactDetail } from "@/server/queries/contacts";
import { getMembers, getStages } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { LIFECYCLE_STATE, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, maskValue, titleCase } from "@/lib/format";
import { Timeline } from "@/components/patterns/timeline";
import { FactList } from "@/components/patterns/record-drawer";
import { ContactActions } from "@/features/crm/components/contact-actions";
import { AuditList, OpportunitiesList, PurchasesList, QuotesList, SectionCard } from "@/features/crm/components/detail-sections";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: PageProps<"/sales/contacts/[id]">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const { id } = await params;
  const [contact, members, stages] = await Promise.all([getContactDetail(id), getMembers(), getStages()]);
  if (!contact) notFound();
  const memberNames = new Map(members.map((m) => [m.user_id, m.full_name]));
  const stageLabels = new Map(stages.map((s) => [s.key, s.label]));

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href="/sales/accounts" className="hover:underline">
            Accounts & Contacts
          </Link>
        }
        title={contact.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill map={LIFECYCLE_STATE} value={contact.lifecycle_state} />
            {contact.customer_type && <span>{titleCase(contact.customer_type)}</span>}
            {contact.original_acquisition_source && (
              <span className="flex items-center gap-1">
                · acquired via <StatusPill map={SOURCE_CHANNEL} value={contact.original_acquisition_source} /> {contact.original_acquisition_at ? formatDate(contact.original_acquisition_at) : ""}
              </span>
            )}
            {contact.is_provisional && <TonePill tone="warning" label="Provisional — identity review pending" />}
          </span>
        }
      >
        <ContactActions contact={contact} members={members} />
      </PageHeader>

      {contact.merged_into_contact_id && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden />
          This record was merged into{" "}
          <Link href={`/sales/contacts/${contact.merged_into_contact_id}`} className="font-medium underline">
            {contact.merged_into_name ?? "another contact"}
          </Link>
          . It is kept for audit; work on the surviving record.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Contact points</div>
                {contact.points.length === 0 && <p className="text-sm text-muted-foreground">None recorded.</p>}
                <ul className="space-y-1 text-sm">
                  {contact.points.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="w-16 text-xs text-muted-foreground">{titleCase(p.kind)}</span>
                      <span className="font-mono text-[12px] tnum">{maskValue(p.normalized_value, p.kind)}</span>
                      {p.is_primary && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">primary</Badge>}
                      {p.label && <span className="text-xs text-muted-foreground">{p.label}</span>}
                      {p.source && <span className="text-[11px] text-muted-foreground">· {p.source}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Organisations</div>
                {contact.relationships.length === 0 && <p className="text-sm text-muted-foreground">Not linked to an account.</p>}
                <ul className="space-y-1 text-sm">
                  {contact.relationships.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <Link href={`/sales/accounts/${r.account_id}`} className="font-medium hover:underline">
                        {r.account_name}
                      </Link>
                      {r.role && <span className="text-xs text-muted-foreground">{r.role}</span>}
                      {r.is_primary && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">primary</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Opportunities" count={contact.opportunities.length}>
            <OpportunitiesList items={contact.opportunities} stageLabels={stageLabels} memberNames={memberNames} />
          </SectionCard>

          <SectionCard title="Projects" count={contact.projects.length}>
            {contact.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects.</p>
            ) : (
              <ul className="divide-y text-sm">
                {contact.projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <Link href={`/sales/projects/${p.id}`} className="flex-1 truncate font-medium hover:underline">
                      {p.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{titleCase(p.project_type ?? "")}</span>
                    <span className="text-xs text-muted-foreground">{p.area ?? ""}</span>
                    <TonePill tone={p.status === "completed" ? "success" : p.status === "active" ? "info" : "neutral"} label={titleCase(p.status)} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Purchases" count={contact.purchases.length}>
            <PurchasesList items={contact.purchases} />
          </SectionCard>

          <SectionCard title="Quotes" count={contact.quotes.length}>
            <QuotesList items={contact.quotes} />
          </SectionCard>

          <SectionCard title="Visits" count={contact.visits.length}>
            {contact.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No showroom visits.</p>
            ) : (
              <ul className="divide-y text-sm">
                {contact.visits.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                    <span className="tnum text-xs text-muted-foreground">{formatDateTime(v.occurred_at)}</span>
                    <span>{titleCase(v.purpose ?? "visit")}</span>
                    <span className="text-xs text-muted-foreground">{v.location_name ?? ""}</span>
                    {v.is_new_customer && <TonePill tone="info" label="first visit" />}
                    {v.notes && <span className="truncate text-xs text-muted-foreground">{v.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Timeline" count={contact.timeline.length}>
            <Timeline items={contact.timeline} />
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Provenance">
            <FactList
              className="sm:grid-cols-1"
              items={[
                { label: "Original acquisition source", value: contact.original_acquisition_source ? titleCase(contact.original_acquisition_source) : "Unknown" },
                { label: "First seen", value: formatDateTime(contact.original_acquisition_at ?? contact.created_at) },
                { label: "Created by", value: memberNames.get(contact.created_by ?? "") ?? "—" },
                { label: "Created", value: formatDateTime(contact.created_at) },
                { label: "Updated", value: formatDateTime(contact.updated_at) },
                { label: "Record id", value: contact.id, mono: true },
              ]}
            />
            {contact.external_identities.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">External identities</div>
                <ul className="space-y-0.5 text-xs">
                  {contact.external_identities.map((e) => (
                    <li key={e.id} className="font-mono">
                      {e.provider}: {e.external_id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {contact.notes && <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{contact.notes}</p>}
          </SectionCard>

          <SectionCard title="Consent" count={contact.consents.length}>
            {contact.consents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No consent records. Media permission for marketing is tracked separately (Phase 2).</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {contact.consents.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span>{titleCase(c.channel)}</span>
                    <span className="text-xs text-muted-foreground">{c.purpose}</span>
                    <TonePill tone={c.status === "granted" ? "success" : c.status === "declined" || c.status === "withdrawn" ? "destructive" : "neutral"} label={titleCase(c.status)} />
                    <span className="tnum text-[11px] text-muted-foreground">{formatDate(c.recorded_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Audit" count={contact.audit.length}>
            <AuditList items={contact.audit} memberNames={memberNames} />
          </SectionCard>
        </div>
      </div>
    </PageBody>
  );
}
