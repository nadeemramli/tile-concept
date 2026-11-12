import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { z } from "zod";
import { Localized } from "@/components/i18n/localized";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { RecoveryForm } from "@/features/dispatch/recovery-form";
import { recoveryLabels } from "@/features/dispatch/recovery-labels";
import { AreaDenied } from "@/features/workspace/components/entry";
import { messages } from "@/lib/i18n/messages";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/server/locale";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Delivery recovery" };

const queue = z.object({
  canDecide: z.boolean(),
  rows: z.array(z.object({
    id: z.uuid(), document: z.string(), line: z.string(), item: z.string(), unit: z.string(),
    trip: z.string(), date: z.iso.date(), planned: z.number(), delivered: z.number(),
    reason: z.string().nullable(), recordedBy: z.string(), recordedAt: z.string(),
    redelivery: z.boolean(), open: z.number(),
    decisions: z.array(z.object({
      id: z.uuid(), kind: z.enum(["redelivery", "return"]), quantity: z.number(),
      note: z.string().nullable(), actor: z.string(), at: z.string(),
    })),
  })),
});

export default async function DeliveryRecoveryPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const labels = recoveryLabels[locale];
  const enabled = process.env.TILE_SYNTHETIC_PREPARATION === "1"
    && session.permissions.includes("admin.coordinate") && ["admin", "business_admin", "management"].includes(session.roleKey);
  const supabase = await createServerSupabase();
  const response = enabled ? await supabase.rpc("synthetic_delivery_recovery_queue") : null;
  const parsed = queue.safeParse(response?.data);
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <Localized locale={locale}>
      {!enabled ? <AreaDenied permission="admin.coordinate" roleLabel={session.roleLabel} home="/admin" t={messages(locale)} /> :
        <PageBody className="max-w-5xl">
          <PageHeader title={labels.title} description={labels.summary} />
          {response?.error || !parsed.success ? <p role="alert">{labels.unavailable}</p> : (
            <div className="grid gap-3">
              {!parsed.data.canDecide && <p>{labels.readOnly}</p>}
              {parsed.data.rows.length === 0 && <p>{labels.empty}</p>}
              {parsed.data.rows.map((row) => {
                const label = row.document + " · " + labels.line + " " + row.line;
                const amount = (value: number) => quantities.format(value) + " " + row.unit;
                const open = Math.round(row.open * 1000) > 0;
                return (
                  <article aria-label={label} key={row.id} className="grid gap-3 rounded-lg border p-4 text-sm">
                    <header>
                      <h2 className="break-words text-base font-semibold">{label}</h2>
                      <p>{row.item}</p>
                      <p role="status" className="font-medium">
                        {open ? labels.open : labels.resolved} · {row.delivered === 0 ? labels.failedDelivery : labels.partial}
                        {row.redelivery && <> · {labels.redeliveryAttempt}</>}
                      </p>
                    </header>
                    <p>{labels.scheduled} {amount(row.planned)} · {labels.delivered} {amount(row.delivered)} · {labels.outstanding} {amount(row.planned - row.delivered)}</p>
                    <p>{labels.trip} {row.trip} · <time dateTime={row.date}>{day.format(new Date(row.date))}</time></p>
                    {row.reason && <p className="break-words">{labels.driverReason}: {row.reason}</p>}
                    <p>{labels.recordedBy} {row.recordedBy} · <time dateTime={row.recordedAt}>{time.format(new Date(row.recordedAt))}</time></p>
                    {row.decisions.length > 0 && <div>
                      <h3 className="font-medium">{labels.decisions}</h3>
                      <ul className="grid gap-2">
                        {row.decisions.map((entry) => <li key={entry.id} className="grid gap-1 border-l pl-3">
                          <p>{entry.kind === "redelivery" ? labels.redelivery : labels.returned} · {amount(entry.quantity)}</p>
                          {entry.note && <p className="break-words">{entry.note}</p>}
                          <p>{entry.actor} · <time dateTime={entry.at}>{time.format(new Date(entry.at))}</time></p>
                        </li>)}
                      </ul>
                    </div>}
                    {open && <p className="font-medium">{labels.toDecide} {amount(row.open)}</p>}
                    {open && parsed.data.canDecide && <RecoveryForm key={row.id + row.decisions.length}
                      request={randomUUID()} result={row.id} open={row.open} labels={labels} />}
                  </article>
                );
              })}
            </div>
          )}
        </PageBody>}
    </Localized>
  );
}
