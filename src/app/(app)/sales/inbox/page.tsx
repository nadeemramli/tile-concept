import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getInquiryDetail, getInquiryPage } from "@/server/queries/leads";
import { getLocations, getMembers } from "@/server/queries/reference";
import { LEAD_VIEWS, SOURCE_CHANNELS, type LeadView } from "@/features/inbox/schema";
import { InboxClient } from "@/features/inbox/components/inbox-client";
import { uuid } from "@/lib/zod";

export const metadata: Metadata = { title: "Inquiry Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/sales/inbox">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const viewParam = typeof sp.view === "string" ? sp.view : "needs-action";
  const view: LeadView = (LEAD_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as LeadView) : "needs-action";
  const owner = typeof sp.owner === "string" && (["all", "mine", "unassigned"].includes(sp.owner) || uuid().safeParse(sp.owner).success) ? sp.owner : "all";
  const source = typeof sp.source === "string" && (SOURCE_CHANNELS as readonly string[]).includes(sp.source) ? sp.source : "";
  const filters = {
    view, search: typeof sp.q === "string" ? sp.q.slice(0, 200) : "",
    owner, source,
    page: Math.min(1000000, Math.max(1, Math.floor(Number(sp.page) || 1))),
  };
  const selectedId = uuid().safeParse(sp.lead).data ?? null;

  // One wave: the list, reference data and the whole drawer detail together.
  const [inbox, members, locations, detail] = await Promise.all([
    getInquiryPage(filters),
    getMembers(),
    getLocations(),
    selectedId ? getInquiryDetail(selectedId) : Promise.resolve(null),
  ]);
  const selected = detail?.lead ?? null;

  return (
    <PageBody>
      <PageHeader title="Inquiry Inbox" description="Know who needs attention, what happened last, and when to follow up. Every inquiry stays in your history." />
      {sp.lead && !selected && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">This inquiry link is invalid or the record is unavailable to your account. You can still search your authorized inquiries below.</p>}
      <InboxClient
        refreshedAt={new Date().toISOString()}
        key={`${filters.search}|${filters.owner}|${filters.source}`}
        view={view}
        {...inbox}
        filters={filters}
        members={members}
        locations={locations}
        selected={detail}
      />
    </PageBody>
  );
}
