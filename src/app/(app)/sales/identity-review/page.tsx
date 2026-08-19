import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { listCandidates, listMergeEvents } from "@/server/queries/identity";
import { getMembers } from "@/server/queries/reference";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { MetricCard } from "@/components/patterns/metric-card";
import { IdentityReview } from "@/features/identity/components/identity-review";

export const metadata: Metadata = { title: "Identity Review" };

export default async function IdentityReviewPage({ searchParams }: PageProps<"/sales/identity-review">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["suggested", "confirmed", "rejected"].includes(sp.status) ? sp.status : "suggested";
  const [pairs, events, members] = await Promise.all([listCandidates(status), listMergeEvents(), getMembers()]);
  const high = pairs.filter((p) => p.confidence === "high").length;
  return (
    <PageBody>
      <PageHeader title="Identity Review" description="Exact or fuzzy matches are proposed with reasons; ambiguous people are never silently merged. Merges are reversible." />
      {status === "suggested" && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricCard label="Waiting review" value={pairs.length} tone={pairs.length ? "warning" : "neutral"} info={{ definition: "Suggested candidate pairs not yet confirmed or rejected.", grain: "Pair", source: "identity.identity_match_candidates" }} />
          <MetricCard label="High confidence" value={high} tone={high ? "info" : "neutral"} info={{ definition: "Pairs with an exact phone/email/registration match (score ≥ 55).", grain: "Pair", source: "identity.identity_match_candidates" }} />
          <MetricCard label="Merges (shown)" value={events.filter((e) => !e.reversed_at).length} info={{ definition: "Confirmed merges in the history list below.", grain: "Merge event", source: "identity.identity_merge_events" }} />
          <MetricCard label="Reversed" value={events.filter((e) => !!e.reversed_at).length} info={{ definition: "Merges that were later undone.", grain: "Merge event", source: "identity.identity_merge_events" }} />
        </div>
      )}
      <IdentityReview pairs={pairs} events={events} members={members} status={status} />
    </PageBody>
  );
}
