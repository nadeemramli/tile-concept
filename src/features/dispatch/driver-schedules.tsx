import { createServerSupabase } from "@/lib/supabase/server";
import { driverSchedules } from "./schedule-data";
import { scheduleLabels } from "./schedule-labels";
import { RefreshSchedules, ScheduleControl } from "./schedule-control";

export async function DriverSchedules({ locale }: { locale: "en" | "ms" }) {
  const labels = scheduleLabels[locale];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("my_synthetic_schedules");
  const parsed = driverSchedules.safeParse(data);
  if (error || !parsed.success) return <p role="alert">{labels.loadFailed}</p>;
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });

  return (
    <div className="grid gap-4">
      <RefreshSchedules />
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
              {trip.stops.map((stop) => (
                <li key={stop.id}>
                  <strong>{stop.document}</strong> · {stop.line} · {stop.item} · {quantities.format(stop.quantity)} {stop.unit}
                  {previous && !oldIds.has(stop.id) && <span> · {labels.added}</span>}
                </li>
              ))}
            </ol>
            {!trip.acknowledgedAt && <ScheduleControl fields={{ action: "acknowledge", revision: trip.id }}
              label={labels.acknowledge} labels={labels} />}
          </section>
        );
      })}
    </div>
  );
}
