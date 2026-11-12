import type { Metadata } from "next";
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
    tripId: z.uuid().nullable(), version: z.int(),
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
  const { data, error } = await supabase.rpc("synthetic_dispatch_drafts");
  const parsed = draftBoard.safeParse(data);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <Localized locale={locale}>
      <PageBody className="max-w-7xl">
        <PageHeader title={labels.title} description={labels.description} />
        {error || !parsed.success ? <p role="alert">{labels.failed}</p> : (
          <div className="grid gap-4 lg:grid-cols-3">
            {[{ id: null, label: labels.unassigned, date: null }, ...parsed.data.trips].map((trip) => {
              const items = parsed.data.allocations.filter((item) => item.tripId === trip.id);
              return (
                <section aria-label={trip.label} key={trip.id ?? "unassigned"} className="grid content-start gap-3 rounded-lg border p-4">
                  <header>
                    <h2 className="font-semibold">{trip.label}</h2>
                    {trip.date && <time className="text-sm text-muted-foreground" dateTime={trip.date}>{date.format(new Date(trip.date))}</time>}
                  </header>
                  {items.length === 0 && <p className="text-sm text-muted-foreground">{labels.empty}</p>}
                  {items.map((item) => (
                    <article key={item.id} className="grid gap-2 rounded-md border p-3">
                      <h3 className="font-medium">{item.document} · {item.item}</h3>
                      <p className="text-sm">{labels.line} {item.line} · {item.origin} · {number.format(item.quantity)} {item.unit}</p>
                      <p className="text-sm font-medium">{item.confirmed >= item.quantity ? labels.ready : labels.pending}
                        {" · "}{number.format(item.confirmed)} / {number.format(item.quantity)} {item.unit}</p>
                      {item.handedOver > 0 && <p className="text-sm">{labels.handedOver} {number.format(item.handedOver)} {item.unit}</p>}
                      <MoveDraftForm key={item.version} allocation={item.id} version={item.version} tripId={item.tripId}
                        destinations={parsed.data.trips.map((destination) => ({ id: destination.id, label: destination.label + " · " + date.format(new Date(destination.date)) }))}
                        labels={labels} />
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
    </Localized>
  );
}
