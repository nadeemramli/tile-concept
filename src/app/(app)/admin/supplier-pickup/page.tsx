import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { z } from "zod";
import { Localized } from "@/components/i18n/localized";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PickupForm } from "@/features/dispatch/pickup-form";
import { pickupLabels } from "@/features/dispatch/pickup-labels";
import { AreaDenied } from "@/features/workspace/components/entry";
import { messages } from "@/lib/i18n/messages";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/server/locale";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Supplier pickup" };

const list = z.object({
  canRecord: z.boolean(),
  rows: z.array(z.object({
    id: z.uuid(), document: z.string(), line: z.string(), item: z.string(), unit: z.string(),
    supplier: z.string(), quantity: z.number(), ready: z.number(), pickedUp: z.number(),
    trip: z.string().nullable(), date: z.iso.date().nullable(),
    events: z.array(z.object({
      stage: z.enum(["supplier_ready", "picked_up"]), quantity: z.number(), note: z.string().nullable(),
      actor: z.string(), at: z.string(),
    })),
  })),
});

export default async function SupplierPickupPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const labels = pickupLabels[locale];
  const enabled = process.env.TILE_SYNTHETIC_PREPARATION === "1"
    && session.permissions.includes("admin.coordinate") && ["admin", "business_admin", "management"].includes(session.roleKey);
  const supabase = await createServerSupabase();
  const response = enabled ? await supabase.rpc("synthetic_supplier_pickups") : null;
  const parsed = list.safeParse(response?.data);
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const positive = (value: number) => Math.round(value * 1000) > 0;

  return (
    <Localized locale={locale}>
      {!enabled ? <AreaDenied permission="admin.coordinate" roleLabel={session.roleLabel} home="/admin" t={messages(locale)} /> :
        <PageBody className="max-w-5xl">
          <PageHeader title={labels.title} description={labels.summary} />
          {response?.error || !parsed.success ? <p role="alert">{labels.unavailable}</p> : (
            <div className="grid gap-3">
              {!parsed.data.canRecord && <p>{labels.readOnly}</p>}
              {parsed.data.rows.length === 0 && <p>{labels.empty}</p>}
              {parsed.data.rows.map((row) => {
                const label = row.document + " · " + labels.line + " " + row.line;
                const amount = (value: number) => quantities.format(value) + " " + row.unit;
                const status = !positive(row.ready) ? labels.waiting
                  : !positive(row.pickedUp) ? labels.readyStatus
                  : positive(row.quantity - row.pickedUp) ? labels.partCollected : labels.collected;
                return (
                  <article aria-label={label} key={row.id} className="grid gap-3 rounded-lg border p-4 text-sm">
                    <header>
                      <h2 className="break-words text-base font-semibold">{label}</h2>
                      <p>{row.item}</p>
                      <p role="status" className="font-medium">{status}</p>
                    </header>
                    <p>{labels.supplier} {row.supplier}</p>
                    <p>{labels.planned} {amount(row.quantity)} · {labels.ready} {amount(row.ready)} · {labels.pickedUp} {amount(row.pickedUp)}</p>
                    <p>{row.trip && row.date ? <>{labels.trip} {row.trip} · <time dateTime={row.date}>{day.format(new Date(row.date))}</time></> : labels.noTrip}</p>
                    {row.events.length > 0 && <div>
                      <h3 className="font-medium">{labels.history}</h3>
                      <ul className="grid gap-2">
                        {row.events.map((entry, index) => <li key={index} className="grid gap-1 border-l pl-3">
                          <p>{entry.stage === "supplier_ready" ? labels.readyEvent : labels.pickedEvent} · {amount(entry.quantity)}</p>
                          {entry.note && <p className="break-words">{entry.note}</p>}
                          <p>{entry.actor} · <time dateTime={entry.at}>{time.format(new Date(entry.at))}</time></p>
                        </li>)}
                      </ul>
                    </div>}
                    {parsed.data.canRecord && positive(row.quantity - row.ready) && <PickupForm key={"ready" + row.events.length}
                      request={randomUUID()} allocation={row.id} stage="supplier_ready" remaining={row.quantity - row.ready} labels={labels} />}
                    {parsed.data.canRecord && positive(row.ready - row.pickedUp) && <PickupForm key={"picked" + row.events.length}
                      request={randomUUID()} allocation={row.id} stage="picked_up" remaining={row.ready - row.pickedUp} labels={labels} />}
                  </article>
                );
              })}
            </div>
          )}
        </PageBody>}
    </Localized>
  );
}
