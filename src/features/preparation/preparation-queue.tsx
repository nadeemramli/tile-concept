import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppSession } from "@/server/session";
import { preparationLabels } from "./labels";
import { PreparationForm } from "./preparation-form";

const queue = z.array(z.object({
  id: z.uuid(),
  document: z.string(),
  line: z.string(),
  item: z.string(),
  unit: z.string(),
  origin: z.string(),
  ordered: z.number(),
  version: z.int(),
  allocations: z.array(z.object({
    id: z.uuid(),
    allocated: z.number(),
    warehouse: z.array(z.object({
      stage: z.enum(["ready", "handed_over"]),
      quantity: z.number(),
      recipient: z.string().nullable(),
      recordedAt: z.string(),
      recordedBy: z.string(),
    })),
    updates: z.array(z.object({
      packed: z.number(),
      shortage: z.number(),
      recordedAt: z.string(),
      recordedBy: z.string(),
    })),
  })),
}));

export async function PreparationQueue({ session, locale }: { session: AppSession; locale: "en" | "ms" }) {
  const labels = preparationLabels[locale];
  const canWrite = ["warehouse", "business_admin", "admin"].includes(session.roleKey);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("preparation_queue");
  const parsed = queue.safeParse(data);
  if (error || !parsed.success) return <p role="alert">{labels.failed}</p>;

  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: session.timezone,
  });

  return (
    <section aria-label={labels.demo} className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">{labels.demo}</h2>
        <p className="text-muted-foreground">{labels.description}</p>
      </div>
      {parsed.data.length === 0 && <p>{labels.noOrders}</p>}
      {parsed.data.map((line) => {
        const allocations = line.allocations.map((allocation) => ({
          ...allocation,
          ready: allocation.warehouse.reduce((sum, event) => sum + (event.stage === "ready" ? event.quantity : 0), 0),
          handedOver: allocation.warehouse.reduce((sum, event) => sum + (event.stage === "handed_over" ? event.quantity : 0), 0),
          packed: allocation.updates.reduce((sum, update) => sum + update.packed, 0),
          shortage: allocation.updates.reduce((sum, update) => sum + update.shortage, 0),
        }));
        const allocated = allocations.reduce((sum, item) => sum + item.allocated, 0);
        const packed = allocations.reduce((sum, item) => sum + item.packed, 0);
        const ready = allocations.reduce((sum, item) => sum + item.ready, 0);
        const handedOver = allocations.reduce((sum, item) => sum + item.handedOver, 0);
        const shortage = allocations.reduce((sum, item) => sum + item.shortage, 0);
        const quantity = (value: number) => format.format(Math.max(0, value)) + " " + line.unit;
        const metrics = [
          [labels.ordered, line.ordered], [labels.allocated, allocated], [labels.packed, packed],
          [labels.shortage, shortage], [labels.outstanding, line.ordered - packed],
          [labels.ready, ready - handedOver], [labels.handedOver, handedOver],
          [labels.notHandedOver, line.ordered - handedOver],
        ] as const;
        return (
          <article key={line.id} className="grid gap-4 rounded-lg border p-4">
            <header>
              <h3 className="font-semibold">{line.document} · {line.item}</h3>
              <p className="text-sm text-muted-foreground">{labels.line} {line.line} · {labels.origin} {line.origin}</p>
            </header>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {metrics.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{quantity(value)}</dd>
                </div>
              ))}
            </dl>
            {canWrite && Math.round((line.ordered - allocated) * 1000) > 0 && (
              <PreparationForm key={line.version} line={line.id} version={line.version} request={randomUUID()} labels={labels} />
            )}
            {allocations.map((allocation, index) => (
              <section key={allocation.id} aria-label={labels.allocation + " " + (index + 1)} className="grid gap-3 border-t pt-3">
                <h4 className="font-medium">{labels.allocation} {index + 1} · {quantity(allocation.allocated)}</h4>
                <ul className="grid gap-1 text-sm">
                  {allocation.updates.map((update, i) => (
                    <li key={i}>
                      {labels.packed} {quantity(update.packed)} · {labels.shortage} {quantity(update.shortage)}
                      {" · "}{update.recordedBy} · <time dateTime={update.recordedAt}>{date.format(new Date(update.recordedAt))}</time>
                    </li>
                  ))}
                  {allocation.warehouse.map((event, i) => (
                    <li key={"warehouse-" + i}>
                      {event.stage === "ready" ? labels.ready : labels.handedOver} {quantity(event.quantity)}
                      {event.recipient && <> · {labels.recipient} {event.recipient}</>}
                      {" · "}{event.recordedBy} · <time dateTime={event.recordedAt}>{date.format(new Date(event.recordedAt))}</time>
                    </li>
                  ))}
                </ul>
                {canWrite && Math.round((allocation.allocated - allocation.packed - allocation.shortage) * 1000) > 0 && (
                  <PreparationForm key={line.version} line={line.id} version={line.version} request={randomUUID()}
                    allocation={allocation.id} labels={labels} />
                )}
                {canWrite && Math.round((allocation.packed - allocation.ready) * 1000) > 0 && (
                  <PreparationForm key={"ready-" + line.version} line={line.id} version={line.version}
                    request={randomUUID()} allocation={allocation.id} stage="ready" labels={labels} />
                )}
                {canWrite && Math.round((allocation.ready - allocation.handedOver) * 1000) > 0 && (
                  <PreparationForm key={"handover-" + line.version} line={line.id} version={line.version}
                    request={randomUUID()} allocation={allocation.id} stage="handed_over" labels={labels} />
                )}
              </section>
            ))}
          </article>
        );
      })}
    </section>
  );
}
