import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { getAuditTables, listAuditEvents } from "@/server/queries/platform";
import { getMembers } from "@/server/queries/reference";
import { AuditTable } from "@/features/platform/components/audit-table";

export const metadata: Metadata = { title: "Audit" };

export default async function AuditPage({ searchParams }: PageProps<"/platform/audit">) {
  const session = await requireSession();
  if (!hasPermission(session, "audit.read")) return <PermissionDenied permission="audit.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [rows, tables, members] = await Promise.all([listAuditEvents({ action: s("action"), table: s("table"), actor: s("actor"), from: s("from"), to: s("to"), objectId: s("object") }), getAuditTables(), getMembers()]);
  const all = hasPermission(session, "audit.read_all");
  return (
    <PageBody>
      <PageHeader title="Audit" description={all ? "Append-only actor/action/change events across the workspace (latest 500 matching)." : "Showing events you are permitted to see: your own actions plus your role's scope (latest 500 matching)."} />
      <AuditTable rows={rows} tables={tables} members={members.map((m) => ({ user_id: m.user_id, full_name: m.full_name }))} />
    </PageBody>
  );
}
