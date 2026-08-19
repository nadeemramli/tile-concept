import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getAccountDetail } from "@/server/queries/accounts";
import { getMembers, getStages } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { LIFECYCLE_STATE, SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDate, formatDateTime, maskValue, titleCase } from "@/lib/format";
import { Timeline } from "@/components/patterns/timeline";
import { FactList } from "@/components/patterns/record-drawer";
import { AccountActions } from "@/features/crm/components/account-actions";
import { AuditList, OpportunitiesList, PurchasesList, QuotesList, SectionCard } from "@/features/crm/components/detail-sections";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ params }: PageProps<"/sales/accounts/[id]">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const { id } = await params;
  const [account, members, stages] = await Promise.all([getAccountDetail(id), getMembers(), getStages()]);
  if (!account) notFound();
  const memberNames = new Map(members.map((m) => [m.user_id, m.full_name]));
  const stageLabels = new Map(stages.map((s) => [s.key, s.label]));

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href="/sales/accounts?tab=accounts" className="hover:underline">
            Accounts & Contacts
          </Link>
        }
        title={account.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill map={LIFECYCLE_STATE} value={account.lifecycle_state} />
            {account.account_type && <span>{titleCase(account.account_type)}</span>}
            {account.registration_number && <span className="font-mono text-xs">{account.registration_number}</span>}
            {account.original_acquisition_source && (
              <span className="flex items-center gap-1">
                · acquired via <StatusPill map={SOURCE_CHANNEL} value={account.original_acquisition_source} /> {account.original_acquisition_at ? formatDate(account.original_acquisition_at) : ""}
              </span>
            )}
            {account.owner_id && <span>· owner {memberNames.get(account.owner_id) ?? "—"}</span>}
          </span>
        }
      >
        <AccountActions account={account} members={members} />
      </PageHeader>

      {account.merged_into_account_id && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="size-4" aria-hidden />
          Merged into{" "}
          <Link href={`/sales/accounts/${account.merged_into_account_id}`} className="font-medium underline">
            {account.merged_into_name ?? "another account"}
          </Link>
          .
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Contacts" count={account.contacts.length}>
            {account.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts linked yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {account.contacts.map((c) => (
                  <li key={c.rel_id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                    <Link href={`/sales/contacts/${c.contact_id}`} className="font-medium hover:underline">
                      {c.display_name}
                    </Link>
                    {c.role && <span className="text-xs text-muted-foreground">{c.role}</span>}
                    {c.is_primary && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">primary</Badge>}
                    <span className="ml-auto font-mono text-[12px] tnum text-muted-foreground">{maskValue(c.primary_phone, "phone")}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Opportunities" count={account.opportunities.length}>
            <OpportunitiesList items={account.opportunities} stageLabels={stageLabels} memberNames={memberNames} />
          </SectionCard>

          <SectionCard title="Projects & sites" count={account.projects.length}>
            {account.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects.</p>
            ) : (
              <ul className="divide-y text-sm">
                {account.projects.map((p) => (
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

          <SectionCard title="Purchases" count={account.purchases.length}>
            <PurchasesList items={account.purchases} />
          </SectionCard>

          <SectionCard title="Quotes" count={account.quotes.length}>
            <QuotesList items={account.quotes} />
          </SectionCard>

          <SectionCard title="Timeline" count={account.timeline.length}>
            <Timeline items={account.timeline} />
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Registration & identifiers">
            <FactList
              className="sm:grid-cols-1"
              items={[
                { label: "Registration number", value: account.registration_number ?? "—", mono: true },
                { label: "Website", value: account.website ?? "—" },
                { label: "Address", value: [account.address.city, account.address.state].filter(Boolean).join(", ") || "—" },
                { label: "Owner", value: memberNames.get(account.owner_id ?? "") ?? "—" },
                { label: "Created", value: formatDateTime(account.created_at) },
                { label: "Record id", value: account.id, mono: true },
              ]}
            />
            {account.external_identities.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs font-mono">
                {account.external_identities.map((e) => (
                  <li key={e.id}>
                    {e.provider}: {e.external_id}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Aliases" count={account.aliases.length}>
            {account.aliases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No aliases. Add trading or short names to improve matching.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {account.aliases.map((a) => (
                  <li key={a.id} className="rounded-full border px-2 py-0.5 text-xs">
                    {a.alias}
                    {a.source && <span className="ml-1 text-muted-foreground">· {a.source}</span>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {account.notes && (
            <SectionCard title="Notes">
              <p className="whitespace-pre-wrap text-sm">{account.notes}</p>
            </SectionCard>
          )}

          <SectionCard title="Audit" count={account.audit.length}>
            <AuditList items={account.audit} memberNames={memberNames} />
          </SectionCard>
        </div>
      </div>
    </PageBody>
  );
}
