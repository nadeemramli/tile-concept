import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getLocations, getMembers } from "@/server/queries/reference";
import { WalkInWizard } from "@/features/walkins/components/walk-in-wizard";

export const metadata: Metadata = { title: "New walk-in" };

export default async function NewWalkInPage() {
  const session = await requireSession();
  if (!session.permissions.includes("sales.write")) return <PermissionDenied permission="sales.write" roleLabel={session.roleLabel} />;
  const [locations, members] = await Promise.all([getLocations(), getMembers()]);
  return (
    <PageBody className="max-w-3xl">
      <PageHeader title="New walk-in" description="Phone first. Resolve the customer safely, capture the visit, add a purchase if any — one guided flow." />
      <WalkInWizard locations={locations} members={members} />
    </PageBody>
  );
}
