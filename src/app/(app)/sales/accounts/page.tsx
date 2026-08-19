import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { listContacts } from "@/server/queries/contacts";
import { listAccounts } from "@/server/queries/accounts";
import { getMembers } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { AccountsContactsView } from "@/features/crm/components/contacts-table";

export const metadata: Metadata = { title: "Accounts & Contacts" };

export default async function AccountsPage({ searchParams }: PageProps<"/sales/accounts">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const includeMerged = sp.merged === "1";
  const [contacts, accounts, members] = await Promise.all([listContacts({ includeMerged }), listAccounts({ includeMerged }), getMembers()]);
  return (
    <PageBody>
      <PageHeader title="Accounts & Contacts" description="One durable identity per person and per organisation. Lists mask contact details; reveal is permissioned and audited." />
      <AccountsContactsView contacts={contacts} accounts={accounts} members={members} includeMerged={includeMerged} />
    </PageBody>
  );
}
