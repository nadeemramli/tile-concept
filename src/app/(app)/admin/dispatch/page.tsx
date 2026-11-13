import type { Metadata } from "next";
import { originalDoLabels } from "@/features/dispatch/original-do-labels";
import { OriginalDoReturns } from "@/features/dispatch/original-do-returns";
import { coordinatorSchedules } from "@/features/dispatch/schedule-data";
import { scheduleLabels } from "@/features/dispatch/schedule-labels";
import { ScheduleControl } from "@/features/dispatch/schedule-control";
import { z } from "zod";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { Localized } from "@/components/i18n/localized";
import { AreaDenied } from "@/features/workspace/components/entry";
import { dispatchLabels } from "@/features/dispatch/labels";
import { MoveDraftForm } from "@/features/dispatch/move-form";
import { messages } from "@/lib/i18n/messages";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/server/locale";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Draft dispatch board" };

const draftBoard = z.object({
  trips: z.array(z.object({ id: z.uuid(), label: z.string(), date: z.iso.date() })),
  allocations: z.array(z.object({
    id: z.uuid(), document: z.string(), line: z.string(), item: z.string(), origin: z.string(),
    quantity: z.number(), unit: z.string(), confirmed: z.number(), handedOver: z.number(),
    tripId: z.uuid().nullable(), version: z.int(), redelivery: z.boolean(), supplier: z.boolean(),
  })),
});

export default async function DispatchPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const labels = dispatchLabels[locale];
  if (process.env.TILE_SYNTHETIC_PREPARATION !== "1" || !session.permissions.includes("admin.coordinate")) {
    return (
      <Localized locale={locale}>
        <AreaDenied permission="admin.coordinate" roleLabel={session.roleLabel} home="/start" t={messages(locale)} />
      </Localized>
    );
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("synthetic_schedule_state");
  const parsed = z.object({ board: draftBoard, schedules: coordinatorSchedules }).safeParse(data);
  const scheduleText = scheduleLabels[locale];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-7xl">
        <PageHeader title={labels.title} description={labels.description} />
        <a href="#original-do-title" className="inline-flex min-h-11 items-center underline">
          {originalDoLabels[locale].title}
        </a>
        {error || !parsed.success ? <p role="alert">{labels.failed}</p> : (
          <div className="grid gap-4 lg:grid-cols-3">
            {[{ id: null, label: labels.unassigned, date: null }, ...parsed.data.board.trips].map((trip) => {
              const state = parsed.data.schedules.find((entry) => entry.tripId === trip.id);
              const items = state
                ? state.stops.flatMap((stop) => parsed.data.board.allocations.filter((item) => item.id === stop.id))
                : parsed.data.board.allocations.filter((item) => item.tripId === trip.id);
              return (
                <section aria-label={trip.label} key={trip.id ?? "unassigned"} className="grid content-start gap-3 rounded-lg border p-4">
                  <header>
                    <h2 className="font-semibold">{trip.label}</h2>
                    {trip.date && <time className="text-sm text-muted-foreground" dateTime={trip.date}>{date.format(new Date(trip.date))}</time>}
                    {state && <div className="mt-2 grid gap-1 text-sm">
                      <p>{state.driver ?? scheduleText.noDriver}</p>
                      <p role="status">{state.revision
                        ? `${scheduleText.revision} ${state.revision} · ${state.acknowledgedAt ? scheduleText.acknowledged : scheduleText.pending}`
                        : scheduleText.noRevision}</p>
                      {state.revision && state.changed && <p>{scheduleText.changed}</p>}
                      {(!state.driver || state.stops.length === 0 || state.stops.some((stop) => !stop.ready)) &&
                        <p>{scheduleText.notReady}</p>}
                      <ScheduleControl key={state.token + String(state.revision)} fields={{ action: "publish", trip: state.tripId, token: state.token }}
                        label={scheduleText.publish} labels={scheduleText} />
                    </div>}
                  </header>
                  {items.length === 0 && <p className="text-sm text-muted-foreground">{labels.empty}</p>}
                  {items.map((item, index) => (
                    <article key={item.id} className="grid gap-2 rounded-md border p-3">
                      <h3 className="font-medium">{item.document} · {item.item}{item.redelivery && <> · {labels.redelivery}</>}</h3>
                      <p className="text-sm">{labels.line} {item.line} · {item.origin} · {number.format(item.quantity)} {item.unit}</p>
                      <p className="text-sm font-medium">{item.confirmed >= item.quantity ? (item.supplier ? labels.supplierReady : labels.ready) : (item.supplier ? labels.supplierPending : labels.pending)}
                        {" · "}{number.format(item.confirmed)} / {number.format(item.quantity)} {item.unit}</p>
                      {item.handedOver > 0 && <p className="text-sm">{item.supplier ? labels.pickedUp : labels.handedOver} {number.format(item.handedOver)} {item.unit}</p>}
                      {state && <div className="flex flex-wrap gap-2">
                        {([-1, 1] as const).map((direction) => (
                          <ScheduleControl key={state.token + direction} fields={{ action: "reorder", trip: state.tripId,
                            token: state.token, allocation: item.id, direction: String(direction) }}
                            disabled={direction === -1 ? index === 0 : index === items.length - 1}
                            label={direction === -1 ? scheduleText.up : scheduleText.down} labels={scheduleText} />
                        ))}
                      </div>}
                      <MoveDraftForm key={item.version} allocation={item.id} version={item.version} tripId={item.tripId}
                        destinations={parsed.data.board.trips.map((destination) => ({ id: destination.id, label: destination.label + " · " + date.format(new Date(destination.date)) }))}
                        labels={labels} />
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        )}
        <OriginalDoReturns locale={locale} />
      </PageBody>
    </Localized>
  );
}
