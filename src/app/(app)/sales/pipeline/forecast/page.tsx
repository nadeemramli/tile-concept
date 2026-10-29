import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { ErrorState, PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { getMembers, getStages } from "@/server/queries/reference";
import { getForecastQueue, getForecastWeek } from "@/server/queries/forecast";
import { ForecastView } from "@/features/forecast/components/forecast-view";
import { DEFAULT_STALE_DAYS, FORECAST_QUEUES, STALE_DAY_OPTIONS, type ForecastMode, type ForecastQueue } from "@/features/forecast/schema";
import { parseWeekParam } from "@/features/forecast/week";
import { uuid } from "@/lib/zod";

export const metadata: Metadata = { title: "Weekly forecast" };

export default async function ForecastPage({ searchParams }: PageProps<"/sales/pipeline/forecast">) {
  const session = await requireSession();
  if (!hasPermission(session, "sales.read")) return <PermissionDenied permission="sales.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const mode: ForecastMode = sp.mode === "recorded" ? "recorded" : "current";
  const requestedQueue = FORECAST_QUEUES.includes(sp.list as ForecastQueue) ? (sp.list as ForecastQueue) : "week";
  const queue: ForecastQueue = requestedQueue === "not_recorded" && mode !== "recorded" ? "week" : requestedQueue;
  const staleDays = STALE_DAY_OPTIONS.find((d) => String(d) === sp.stale) ?? DEFAULT_STALE_DAYS;
  const params = {
    weekStart: parseWeekParam(sp.week),
    mode,
    ownerId: uuid().safeParse(sp.owner).success ? (sp.owner as string) : null,
    staleDays,
  };
  const page = Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1);
  const [week, list, members, stages] = await Promise.all([getForecastWeek(params), getForecastQueue({ ...params, queue, page }), getMembers(), getStages()]);

  return (
    <PageBody>
      <PageHeader
        title="Weekly forecast"
        description="Open work expected to close in the selected Kuala Lumpur week, by the owner's stated likelihood. Values are unweighted estimates, not sales. Missing, passed and unreviewed forecasts are listed for review."
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/sales/pipeline">Pipeline</Link>
        </Button>
      </PageHeader>
      {"error" in week ? (
        <ErrorState title="Forecast unavailable" description={week.error} />
      ) : (
        <ForecastView week={week.data} list={{ queue, page, ...list }} params={params} members={members} stages={stages} />
      )}
    </PageBody>
  );
}
