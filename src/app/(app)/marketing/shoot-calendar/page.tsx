import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getBookingDetail, listCalendarBookings, listSchedulableOpportunities, listUpcomingBookings } from "@/server/queries/marketing";
import { getMembers } from "@/server/queries/reference";
import { CalendarClient, type CalendarView } from "@/features/marketing/components/calendar-client";
import { todayKey } from "@/features/marketing/lib/time";

export const metadata: Metadata = { title: "Shoot Calendar" };

const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];

export default async function ShootCalendarPage({ searchParams }: PageProps<"/marketing/shoot-calendar">) {
  const session = await requireSession();
  if (!hasPermission(session, "marketing.read")) return <PermissionDenied permission="marketing.read" roleLabel={session.roleLabel} />;

  const sp = await searchParams;
  const view = (VIEWS.includes(sp.view as CalendarView) ? sp.view : "month") as CalendarView;
  const anchor = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const bookingId = typeof sp.booking === "string" ? sp.booking : null;

  const [bookings, upcoming, members, opportunities, detail] = await Promise.all([
    listCalendarBookings(view, anchor),
    listUpcomingBookings(7),
    getMembers(),
    listSchedulableOpportunities(),
    bookingId ? getBookingDetail(bookingId) : Promise.resolve(null),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="Shoot Calendar"
        description="Tentative holds, standby crew and confirmed bookings stay distinct. Confirming checks for clashes; rescheduling keeps the previous slot."
      />
      <CalendarClient bookings={bookings} upcoming={upcoming} members={members} opportunities={opportunities} detail={detail} view={view} anchor={anchor} />
    </PageBody>
  );
}
