import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DeliveryForm } from "./delivery-form";
import { PickupForm } from "./pickup-form";
import { pickupLabels } from "./pickup-labels";
import { deliveryLabels } from "./delivery-labels";
import { createServerSupabase } from "@/lib/supabase/server";
import { driverSchedules } from "./schedule-data";
import { scheduleLabels } from "./schedule-labels";
import { RefreshSchedules, ScheduleControl } from "./schedule-control";

const deliveryResults = z.array(z.object({
  id: z.uuid(), allocation: z.uuid(), delivered: z.number(), planned: z.number(),
  pic: z.string().nullable(), reason: z.string().nullable(), proof: z.string().nullable(),
  recordedAt: z.string(), recordedBy: z.string(),
}));

export async function DriverSchedules({ locale }: { locale: "en" | "ms" }) {
  const labels = scheduleLabels[locale];
  const supabase = await createServerSupabase();
  const delivery = deliveryLabels[locale];
  const pickupText = pickupLabels[locale];
  const [schedule, results, pickups] = await Promise.all([
    supabase.rpc("my_synthetic_schedules"),
    supabase.rpc("my_synthetic_delivery_results"),
    supabase.rpc("my_synthetic_pickups"),
  ]);
  const parsedPickups = z.array(z.object({ allocation: z.uuid(), ready: z.number(), pickedUp: z.number() }))
    .safeParse(pickups.data);
  const collected = new Map(parsedPickups.data?.map((entry) => [entry.allocation, entry]));
  const parsed = driverSchedules.safeParse(schedule.data);
  if (schedule.error || !parsed.success) return <p role="alert">{labels.loadFailed}</p>;
  const parsedResults = deliveryResults.safeParse(results.data);
  const recorded = new Map(parsedResults.data?.map((result) => [result.allocation, result]));
  const resultsUnavailable = Boolean(results.error) || !parsedResults.success;
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const timestamps = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });

  return (
    <div className="grid gap-4">
      <RefreshSchedules />
      {resultsUnavailable && <p role="alert">{delivery.loadFailed}</p>}
      {parsed.data.length === 0 && <p>{labels.empty}</p>}
      {parsed.data.map((trip) => {
        const previous = trip.previousStops;
        const oldIds = new Set(previous?.map((stop) => stop.id));
        const newIds = new Set(trip.stops.map((stop) => stop.id));
        const removed = previous?.filter((stop) => !newIds.has(stop.id)) ?? [];
        const sharedOrder = trip.stops.filter((stop) => oldIds.has(stop.id));
        const reordered = previous?.filter((stop) => newIds.has(stop.id)).some(
          (stop, i) => stop.id !== sharedOrder[i]?.id,
        );
        return (
          <section key={trip.id} aria-label={trip.label} className="grid gap-3 rounded-lg border p-4">
            <header>
              <h2 className="text-lg font-semibold">{trip.label}</h2>
              <p><time dateTime={trip.date}>{dates.format(new Date(trip.date))}</time> · {labels.revision} {trip.revision}</p>
              <p role="status">{trip.acknowledgedAt ? labels.acknowledged : labels.pending}</p>
            </header>
            {reordered && <p>{labels.reordered}</p>}
            {removed.length > 0 && <p>{labels.removed} · {removed.map((stop) => stop.document + " / " + stop.line).join(", ")}</p>}
            <ol className="list-decimal space-y-2 pl-6">
              {trip.stops.map((stop) => {
                const result = recorded.get(stop.id);
                const amount = (value: number) => quantities.format(value) + " " + stop.unit;
                return (
                  <li key={stop.id}>
                    <strong>{stop.document}</strong> · {stop.line} · {stop.item} · {amount(stop.quantity)}
                    {previous && !oldIds.has(stop.id) && <span> · {labels.added}</span>}
                    {stop.pickup && (() => {
                      const state = collected.get(stop.id);
                      const left = (state?.ready ?? 0) - (state?.pickedUp ?? 0);
                      return (
                        <div className="mt-2 grid gap-1 rounded-md border p-3">
                          <p className="font-medium">{pickupText.pickupAt} {stop.pickup}</p>
                          <p>{pickupText.driverPicked} {amount(state?.pickedUp ?? 0)} / {amount(stop.quantity)}</p>
                          {!state || state.ready === 0 ? <p>{pickupText.driverWaiting}</p> : null}
                          {!result && trip.acknowledgedAt && Math.round(left * 1000) > 0 && <PickupForm
                            key={"pickup" + (state?.pickedUp ?? 0)} request={randomUUID()} allocation={stop.id}
                            stage="picked_up" remaining={left} labels={pickupText} />}
                        </div>
                      );
                    })()}
                    {result ? (
                      <div className="mt-2 grid gap-1 rounded-md border p-3">
                        <p className="font-medium">{result.delivered === 0 ? delivery.failedDelivery :
                          result.delivered < result.planned ? delivery.partial : delivery.delivered}</p>
                        <p>{delivery.quantity} {amount(result.delivered)} · {delivery.remaining} {amount(result.planned - result.delivered)}</p>
                        {result.pic && <p>{delivery.pic} · {result.pic}</p>}
                        {result.reason && <p>{result.reason}</p>}
                        <p>{delivery.recordedBy} · {result.recordedBy} · <time dateTime={result.recordedAt}>{timestamps.format(new Date(result.recordedAt))}</time></p>
                        {result.proof && <a className="inline-flex min-h-11 items-center underline"
                          href={`/admin/my-deliveries/proof/${result.id}`}>{delivery.download}</a>}
                      </div>
                    ) : trip.acknowledgedAt && !resultsUnavailable && (
                      <DeliveryForm revision={trip.id} allocation={stop.id} planned={stop.quantity} labels={delivery} />
                    )}
                  </li>
                );
              })}
            </ol>
            {!trip.acknowledgedAt && <ScheduleControl fields={{ action: "acknowledge", revision: trip.id }}
              label={labels.acknowledge} labels={labels} />}
          </section>
        );
      })}
    </div>
  );
}
