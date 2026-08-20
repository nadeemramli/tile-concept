import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getContentCounts, getContentOpportunityDetail, listContentOpportunities, listSchedulableOpportunities, type ContentView } from "@/server/queries/marketing";
import { getMembers } from "@/server/queries/reference";
import { ContentOpportunitiesClient } from "@/features/marketing/components/content-client";

export const metadata: Metadata = { title: "Content Opportunities" };

const VIEWS: ContentView[] = ["inbox", "accepted", "scheduled", "completed", "declined", "all"];

export default async function ContentOpportunitiesPage({ searchParams }: PageProps<"/marketing/content-opportunities">) {
  const session = await requireSession();
  if (!hasPermission(session, "marketing.read")) return <PermissionDenied permission="marketing.read" roleLabel={session.roleLabel} />;

  const sp = await searchParams;
  const view = (VIEWS.includes(sp.view as ContentView) ? sp.view : "inbox") as ContentView;
  const selected = typeof sp.opportunity === "string" ? sp.opportunity : null;

  const [rows, counts, members, detail, schedulable] = await Promise.all([
    listContentOpportunities(view),
    getContentCounts(),
    getMembers(),
    selected ? getContentOpportunityDetail(selected) : Promise.resolve(null),
    listSchedulableOpportunities(),
  ]);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Content Opportunities"
        description="Customer projects nominated for marketing. Permission is recorded separately from sales consent, and nothing is published without it."
      />
      <ContentOpportunitiesClient rows={rows} counts={counts} members={members} detail={detail} schedulable={schedulable} view={view} />
    </PageBody>
  );
}
