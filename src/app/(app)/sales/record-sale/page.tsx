import { notFound } from "next/navigation";
import { uuid } from "@/lib/zod";
import { requireSession } from "@/server/session";
import { getSaleWorkspace } from "@/server/queries/sales";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { SaleWorkbench } from "@/features/sales/sale-workbench";

export const metadata = { title: "Sales & receipts" };
export default async function RecordSalePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const q = await searchParams;
  const pick = (name: string) => typeof q[name] === "string" && uuid().safeParse(q[name]).success ? q[name] as string : undefined;
  const id = pick("id"), lead = pick("lead"), visit = pick("visit");
  if ((q.id && !id) || (q.lead && !lead) || (q.visit && !visit)) notFound();
  const data = await getSaleWorkspace({ id, lead, visit, page: Number(q.page) || 1 });
  if ((id && !data.sale) || (lead && !data.lead) || (visit && !data.visit)) notFound();
  return <PageBody className="max-w-5xl"><PageHeader title="Sales & receipts" description="Confirm a documented sale, then record deposits and later payments against that same sale. Revenue excludes sales tax." />
    <SaleWorkbench key={`${id ?? lead ?? visit ?? "ledger"}:${data.sale?.version ?? 0}`} data={data} leadId={lead} visitId={visit} />
  </PageBody>;
}
