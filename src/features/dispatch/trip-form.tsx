"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadSamples, saveTrip } from "./trip-action";
import type { tripLabels } from "./trip-labels";

type Labels = typeof tripLabels.en;
type Driver = { id: string; name: string };
const fieldClass = "min-h-11 w-full rounded-md border bg-background px-3 py-2";

function message(outcome: string, labels: Labels) {
  const errors: Record<string, string> = {
    exists: labels.exists, invalid: labels.invalid, stale: labels.stale, denied: labels.denied,
  };
  return outcome ? errors[outcome] ?? labels.failed : "";
}

function DriverSelect({ drivers, value, onChange, labels }: {
  drivers: Driver[]; value: string; onChange: (value: string) => void; labels: Labels;
}) {
  return (
    <label className="grid gap-1 text-sm">{labels.driver}
      <select name="driver" className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{labels.noDriver}</option>
        {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
      </select>
    </label>
  );
}

export function NewTripForm({ drivers, labels }: { drivers: Driver[]; labels: Labels }) {
  const [outcome, action, pending] = useActionState(saveTrip, "");
  // Controlled fields keep what was typed when the server refuses the trip.
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [driver, setDriver] = useState("");
  return (
    <form action={action} aria-label={labels.newTrip} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-4 sm:items-end">
      <input type="hidden" name="action" value="create" />
      <label className="grid gap-1 text-sm">{labels.tripName}
        <input className={fieldClass} name="label" maxLength={100} required value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">{labels.tripDate}
        <input className={fieldClass} name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <DriverSelect drivers={drivers} value={driver} onChange={setDriver} labels={labels} />
      <Button type="submit" className="min-h-11" disabled={pending}>{pending ? labels.saving : labels.create}</Button>
      {outcome && <p role="alert" className="text-sm text-destructive sm:col-span-4">{message(outcome, labels)}</p>}
    </form>
  );
}

export function AssignDriverForm({ trip, token, current, drivers, labels }: {
  trip: string; token: string; current: string; drivers: Driver[]; labels: Labels;
}) {
  const [outcome, action, pending] = useActionState(saveTrip, "");
  const [driver, setDriver] = useState(current);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="action" value="assign" />
      <input type="hidden" name="trip" value={trip} />
      <input type="hidden" name="token" value={token} />
      <DriverSelect drivers={drivers} value={driver} onChange={setDriver} labels={labels} />
      <Button type="submit" size="sm" variant="outline" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : labels.assign}
      </Button>
      {outcome && <p role="alert" className="text-sm text-destructive">{message(outcome, labels)}</p>}
    </form>
  );
}

export function LoadSamplesForm({ labels }: {
  labels: { load: string; saving: string; added: string; none: string; failed: string };
}) {
  const [outcome, action, pending] = useActionState(async () => loadSamples(), "");
  return (
    <form action={action} className="grid gap-1">
      <Button type="submit" variant="outline" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? labels.saving : labels.load}
      </Button>
      {outcome && <p role={outcome === "added" || outcome === "none" ? "status" : "alert"} className="text-sm">
        {outcome === "added" ? labels.added : outcome === "none" ? labels.none : labels.failed}</p>}
    </form>
  );
}
