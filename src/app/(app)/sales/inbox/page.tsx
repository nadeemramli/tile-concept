import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getInboxCounts, getLead, getLeadIntakeEvents, getLeadTimeline, getLinkedContactSummary, listLeads } from "@/server/queries/leads";
import { getLocations, getMembers, getSavedViews } from "@/server/queries/reference";
import { LEAD_VIEWS, type LeadView } from "@/features/inbox/schema";
import { InboxClient } from "@/features/inbox/components/inbox-client";

export const metadata: Metadata = { title: "Inquiry Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/sales/inbox">) {
  const session = await requireSession();
  if (!session.permissions.includes("sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const viewParam = typeof sp.view === "string" ? sp.view : "new";
  const view: LeadView = (LEAD_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as LeadView) : "new";
  const selectedId = typeof sp.lead === "string" ? sp.lead : null;

  const [leads, counts, members, locations, savedViews, selected] = await Promise.all([
    listLeads(view, session),
    getInboxCounts(session),
    getMembers(),
    getLocations(),
    getSavedViews("inbox"),
    selectedId ? getLead(selectedId) : Promise.resolve(null),
  ]);
  const [intake, timeline, contact] = selected
    ? await Promise.all([getLeadIntakeEvents(selected.id), getLeadTimeline(selected.id), getLinkedContactSummary(selected.contact_id)])
    : [[], [], null];

  return (
    <PageBody>
      <PageHeader title="Inquiry Inbox" description="Every inquiry from TikTok, Meta, website, DMs, WhatsApp, calls, referrals and walk-ins — resolved to one identity, responded to on time." />
      <InboxClient
        view={view}
        leads={leads}
        counts={counts}
        members={members}
        locations={locations}
        savedViews={savedViews}
        selected={selected}
        selectedIntake={intake}
        selectedTimeline={timeline}
        selectedContact={contact}
      />
    </PageBody>
  );
}
