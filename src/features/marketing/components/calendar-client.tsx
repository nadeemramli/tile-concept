"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAsString, parseAsBoolean, useQueryState } from "nuqs";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSession } from "@/components/shell/session-context";
import { AgendaList, MonthGrid, TimeGrid } from "@/features/marketing/components/calendar-grid";
import { BookingDrawer } from "@/features/marketing/components/booking-drawer";
import { BookingDialog } from "@/features/marketing/components/booking-dialog";
import { MarketingPill } from "@/features/marketing/components/pills";
import { BOOKING_STATUS, CONTENT_TYPES, meta, permissionBlocks } from "@/features/marketing/lib/status";
import { addDays, addMonths, dayLabel, eachDay, monthLabel, rangeFor, startOfWeek, todayKey, timeRangeLabel } from "@/features/marketing/lib/time";
import type { BookingDetail, CalendarBooking, SchedulableOpportunity } from "@/server/queries/marketing";
import type { ProfileRef } from "@/server/queries/reference";
import { formatDate } from "@/lib/format";

export type CalendarView = "month" | "week" | "day" | "agenda";

const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day", agenda: "Agenda" };

export function CalendarClient({
  bookings,
  upcoming,
  members,
  opportunities,
  detail,
  view,
  anchor,
}: {
  bookings: CalendarBooking[];
  upcoming: CalendarBooking[];
  members: ProfileRef[];
  opportunities: SchedulableOpportunity[];
  detail: BookingDetail | null;
  view: CalendarView;
  anchor: string;
}) {
  const router = useRouter();
  const { can, session } = useSession();
  const [, setBookingId] = useQueryState("booking", parseAsString);
  const [, setView] = useQueryState("view", parseAsString);
  const [, setDate] = useQueryState("date", parseAsString);
  const [mine, setMine] = useQueryState("mine", parseAsBoolean.withDefault(false));
  const [status, setStatus] = useState<string>("all");
  const [coordinator, setCoordinator] = useState<string>("all");
  const [contentType, setContentType] = useState<string>("all");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const days = useMemo(() => eachDay(range.from, range.to), [range]);

  const filtered = useMemo(
    () =>
      bookings.filter((b) => {
        if (mine && !b.participants.some((p) => p.user_id === session.userId) && b.coordinator_id !== session.userId) return false;
        if (status !== "all" && b.status !== status) return false;
        if (coordinator !== "all" && b.coordinator_id !== coordinator) return false;
        if (contentType !== "all" && !b.content_types.includes(contentType)) return false;
        if (exceptionsOnly && !permissionBlocks(b.permission_status, b.permission_expires_at) && b.readiness_state === "ready") return false;
        return true;
      }),
    [bookings, mine, status, coordinator, contentType, exceptionsOnly, session.userId],
  );

  const go = (delta: number) => {
    const next =
      view === "month" ? addMonths(anchor, delta) : view === "week" ? addDays(startOfWeek(anchor), delta * 7) : view === "day" ? addDays(anchor, delta) : addDays(anchor, delta * 30);
    setDate(next);
  };

  const heading = view === "month" ? monthLabel(anchor) : view === "day" ? dayLabel(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)} variant="outline" size="sm">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
            <ToggleGroupItem key={v} value={v} aria-label={VIEW_LABELS[v]}>
              {VIEW_LABELS[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" onClick={() => go(-1)} aria-label="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setDate(todayKey())}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="size-8" onClick={() => go(1)} aria-label="Next">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <span className="text-sm font-medium">{heading}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant={mine ? "default" : "outline"} size="sm" className="h-8" onClick={() => setMine(mine ? null : true)}>
            My assignments
          </Button>
          <Button variant={exceptionsOnly ? "default" : "outline"} size="sm" className="h-8" onClick={() => setExceptionsOnly((v) => !v)}>
            Exceptions only
          </Button>
          {can("marketing.write") && (
            <Button size="sm" className="h-8" onClick={() => setCreating(true)}>
              <CalendarPlus className="size-3.5" aria-hidden /> New booking
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {Object.keys(BOOKING_STATUS).map((s) => (
              <SelectItem key={s} value={s}>
                {meta(BOOKING_STATUS, s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={coordinator} onValueChange={setCoordinator}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Any coordinator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any coordinator</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={contentType} onValueChange={setContentType}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="Any content type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any content type</SelectItem>
            {CONTENT_TYPES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="tnum text-xs text-muted-foreground">
          {filtered.length} of {bookings.length} shown
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {view === "month" && <MonthGrid anchor={anchor} bookings={filtered} onOpen={setBookingId} />}
          {view === "week" && <TimeGrid days={days} bookings={filtered} onOpen={setBookingId} />}
          {view === "day" && <TimeGrid days={days} bookings={filtered} onOpen={setBookingId} />}
          {view === "agenda" && <AgendaList days={days} bookings={filtered} onOpen={setBookingId} emptyText="Nothing scheduled in the next 30 days." />}
        </div>

        <aside className="hidden space-y-2 xl:block">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Next 7 days</h2>
          {upcoming.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Nothing booked this week.</p>
          ) : (
            <ul className="space-y-1">
              {upcoming.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setBookingId(b.id)}
                    className="w-full rounded-md border bg-card px-2.5 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="tnum block text-[11px] text-muted-foreground">
                      {formatDate(b.starts_at)} · {timeRangeLabel(b.starts_at, b.ends_at)}
                    </span>
                    <span className="block truncate text-sm">{b.title ?? "Shoot"}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{b.project_name ?? b.contact_name ?? ""}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <MarketingPill map={BOOKING_STATUS} value={b.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {creating && <BookingDialog open onOpenChange={(o) => !o && setCreating(false)} members={members} opportunities={opportunities} defaultDay={anchor} />}
      {detail && (
        <BookingDrawer
          booking={detail}
          members={members}
          opportunities={opportunities}
          onClose={() => {
            setBookingId(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
