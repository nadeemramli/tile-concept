"use client";

import { Fragment, useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHIP_CLASSES, BOOKING_STATUS, meta, permissionBlocks } from "@/features/marketing/lib/status";
import { addDays, dayKey, dayLabel, eachDay, minutesOfDay, timeLabel, timeRangeLabel, todayKey } from "@/features/marketing/lib/time";
import type { CalendarBooking } from "@/server/queries/marketing";

/**
 * Month / week / day / agenda grids over Kuala Lumpur wall time.
 *
 * Hand-built rather than FullCalendar: the installed FullCalendar is a broken
 * mix (core v7 stub with v6 view plugins), and the calendar needs Tile Concept
 * status tokens, permission warnings and MYT bucketing anyway.
 */

const DAY_START = 7 * 60; // 07:00
const DAY_END = 21 * 60; // 21:00
const PX_PER_MIN = 0.9;

function groupByDay(bookings: CalendarBooking[]): Map<string, CalendarBooking[]> {
  const map = new Map<string, CalendarBooking[]>();
  for (const b of bookings) {
    if (!b.starts_at) continue;
    const key = dayKey(b.starts_at);
    const list = map.get(key);
    if (list) list.push(b);
    else map.set(key, [b]);
  }
  for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return map;
}

function Chip({ booking, onOpen, compact }: { booking: CalendarBooking; onOpen: (id: string) => void; compact?: boolean }) {
  const m = meta(BOOKING_STATUS, booking.status);
  const Icon = m.icon;
  const blocked = permissionBlocks(booking.permission_status, booking.permission_expires_at);
  return (
    <button
      type="button"
      onClick={() => onOpen(booking.id)}
      title={`${m.label} · ${timeRangeLabel(booking.starts_at, booking.ends_at)}${blocked ? " · permission not approved" : ""}`}
      className={cn(
        "flex w-full items-center gap-1 overflow-hidden rounded border border-l-2 px-1.5 py-0.5 text-left text-[11px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
        CHIP_CLASSES[m.tone],
        booking.status === "cancelled" && "line-through opacity-70",
      )}
    >
      <Icon className="size-2.5 shrink-0" aria-hidden />
      {!compact && <span className="tnum shrink-0 opacity-80">{timeLabel(booking.starts_at)}</span>}
      <span className="min-w-0 flex-1 truncate">{booking.title ?? booking.project_name ?? "Shoot"}</span>
      {blocked && <ShieldAlert className="size-2.5 shrink-0" aria-hidden />}
    </button>
  );
}

export function MonthGrid({ anchor, bookings, onOpen }: { anchor: string; bookings: CalendarBooking[]; onOpen: (id: string) => void }) {
  const byDay = useMemo(() => groupByDay(bookings), [bookings]);
  const first = useMemo(() => {
    const [y, m] = anchor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    const dow = (d.getUTCDay() + 6) % 7;
    return addDays(`${anchor.slice(0, 7)}-01`, -dow);
  }, [anchor]);
  const days = useMemo(() => eachDay(first, addDays(first, 41)), [first]);
  const today = todayKey();
  const month = anchor.slice(0, 7);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const items = byDay.get(day) ?? [];
          const outside = day.slice(0, 7) !== month;
          return (
            <div key={day} className={cn("min-h-24 space-y-1 border-b border-r p-1", i % 7 === 6 && "border-r-0", outside && "bg-muted/30")}>
              <div className={cn("tnum px-1 text-[11px]", day === today ? "font-semibold text-brand" : outside ? "text-muted-foreground/60" : "text-muted-foreground")}>
                {Number(day.slice(8))}
              </div>
              {items.map((b) => (
                <Chip key={b.id} booking={b} onOpen={onOpen} compact />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeGrid({ days, bookings, onOpen }: { days: string[]; bookings: CalendarBooking[]; onOpen: (id: string) => void }) {
  const byDay = useMemo(() => groupByDay(bookings), [bookings]);
  const hours = useMemo(() => Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START + i * 60), []);
  const today = todayKey();
  const height = (DAY_END - DAY_START) * PX_PER_MIN;

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="min-w-[640px]">
        <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div key={d} className={cn("px-2 py-1.5 text-xs font-medium", d === today && "text-brand")}>
              {dayLabel(d)}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative" style={{ height }}>
            {hours.map((h) => (
              <div key={h} className="tnum absolute -translate-y-1/2 pr-2 text-right text-[10px] text-muted-foreground" style={{ top: (h - DAY_START) * PX_PER_MIN, width: 56 }}>
                {String(Math.floor(h / 60)).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((day) => {
            const items = byDay.get(day) ?? [];
            return (
              <div key={day} className="relative border-l" style={{ height }}>
                {hours.map((h) => (
                  <div key={h} className="absolute w-full border-t border-border/60" style={{ top: (h - DAY_START) * PX_PER_MIN }} />
                ))}
                {items.map((b) => {
                  const startMin = Math.max(minutesOfDay(b.starts_at), DAY_START);
                  const endMin = Math.min(b.ends_at ? minutesOfDay(b.ends_at) : startMin + 60, DAY_END);
                  const top = (startMin - DAY_START) * PX_PER_MIN;
                  const h = Math.max((endMin - startMin) * PX_PER_MIN, 22);
                  const m = meta(BOOKING_STATUS, b.status);
                  const Icon = m.icon;
                  const blocked = permissionBlocks(b.permission_status, b.permission_expires_at);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onOpen(b.id)}
                      className={cn(
                        "absolute inset-x-1 overflow-hidden rounded border border-l-2 px-1.5 py-0.5 text-left text-[11px] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
                        CHIP_CLASSES[m.tone],
                        b.status === "cancelled" && "line-through opacity-70",
                      )}
                      style={{ top, height: h }}
                    >
                      <span className="flex items-center gap-1">
                        <Icon className="size-2.5 shrink-0" aria-hidden />
                        <span className="tnum shrink-0 opacity-80">{timeLabel(b.starts_at)}</span>
                        {blocked && <ShieldAlert className="size-2.5 shrink-0" aria-hidden />}
                      </span>
                      <span className="block truncate">{b.title ?? b.project_name ?? "Shoot"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgendaList({ days, bookings, onOpen, emptyText = "Nothing scheduled in this window." }: { days: string[]; bookings: CalendarBooking[]; onOpen: (id: string) => void; emptyText?: string }) {
  const byDay = useMemo(() => groupByDay(bookings), [bookings]);
  const withItems = days.filter((d) => (byDay.get(d) ?? []).length > 0);
  if (withItems.length === 0) return <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const today = todayKey();

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {withItems.map((day) => (
        <Fragment key={day}>
          <div className={cn("border-b bg-muted/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wider", day === today ? "text-brand" : "text-muted-foreground")}>
            {dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <ul className="divide-y">
            {(byDay.get(day) ?? []).map((b) => {
              const m = meta(BOOKING_STATUS, b.status);
              const Icon = m.icon;
              const blocked = permissionBlocks(b.permission_status, b.permission_expires_at);
              return (
                <li key={b.id}>
                  <button type="button" onClick={() => onOpen(b.id)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="tnum w-24 shrink-0 text-xs text-muted-foreground">{timeRangeLabel(b.starts_at, b.ends_at)}</span>
                    <Icon className={cn("size-3.5 shrink-0", `text-${m.tone === "neutral" ? "muted-foreground" : m.tone}`)} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {b.title ?? "Shoot"}
                      <span className="ml-2 text-xs text-muted-foreground">{b.project_name ?? b.contact_name ?? ""}</span>
                    </span>
                    {blocked && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                        <ShieldAlert className="size-3" aria-hidden /> permission
                      </span>
                    )}
                    <span className={cn("shrink-0 rounded-full border px-1.5 text-[11px]", CHIP_CLASSES[m.tone])}>{m.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}
