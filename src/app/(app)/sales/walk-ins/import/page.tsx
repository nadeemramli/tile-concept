import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getLocations } from "@/server/queries/reference";
import { ImportWizard } from "@/features/walkins/components/import-wizard";

export const metadata: Metadata = { title: "Import walk-in workbook" };

export default async function ImportPage() {
  const session = await requireSession();
  if (!session.permissions.includes("sales.write")) return <PermissionDenied permission="sales.write" roleLabel={session.roleLabel} />;
  const locations = await getLocations();
  return (
    <PageBody>
      <PageHeader title="Import walk-in workbook" description="Map the current Excel columns, preview valid / corrected / duplicate / rejected rows, then commit. The spreadsheet stays a read-only archive — the app is the live ledger from here." />
      <ImportWizard locations={locations} />
    </PageBody>
  );
}
