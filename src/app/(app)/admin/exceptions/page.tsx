import type { Metadata } from "next";
import type { ReactNode } from "react";
import { z } from "zod";
import { Localized } from "@/components/i18n/localized";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { exceptionLabels } from "@/features/dispatch/exceptions-labels";
import { AreaDenied } from "@/features/workspace/components/entry";
import { messages } from "@/lib/i18n/messages";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/server/locale";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Fulfilment exceptions" };

const text = z.string();
const exceptions = z.object({
  late: z.array(z.object({ trip: text, date: z.iso.date(), document: text.nullable(), line: text.nullable(), published: z.boolean() })),
  unacknowledged: z.array(z.object({ trip: text, date: z.iso.date(), revision: z.int(), driver: text })),
  unresolved: z.array(z.object({ document: text, line: text, unit: text, open: z.number(), reason: text.nullable(), failed: z.boolean() })),
  proof: z.array(z.object({ document: text, line: text, status: z.enum(["missing", "unchecked", "unclear", "discrepancy"]) })),
  paper: z.array(z.object({ document: text })),
  pickup: z.array(z.object({ document: text, line: text, supplier: text, trip: text, date: z.iso.date() })),
});

export default async function ExceptionsPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const labels = exceptionLabels[locale];
  const enabled = process.env.TILE_SYNTHETIC_PREPARATION === "1"
    && session.permissions.includes("admin.coordinate") && ["admin", "business_admin", "management"].includes(session.roleKey);
  // "Today" follows the workspace time zone, so a trip is not late before its own day ends there.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: session.timezone }).format(new Date());
  const supabase = await createServerSupabase();
  const response = enabled ? await supabase.rpc("synthetic_management_exceptions", { p_today: today }) : null;
  const parsed = exceptions.safeParse(response?.data);
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const date = (value: string) => <time dateTime={value}>{day.format(new Date(value))}</time>;

  const section = (id: string, title: string, help: string, href: string, link: string, items: ReactNode[]) => (
    <section aria-labelledby={id} className="grid gap-2 rounded-lg border p-4 text-sm">
      <header>
        <h2 id={id} className="text-base font-semibold">{title} · {items.length}</h2>
        <p className="text-muted-foreground">{help}</p>
      </header>
      {items.length === 0 ? <p>{labels.none}</p> : <ul className="grid gap-1">
        {items.map((item, index) => <li key={index} className="break-words border-l pl-3">{item}</li>)}
      </ul>}
      <a className="inline-flex min-h-11 items-center justify-self-start underline" href={href}>{labels.open}: {link}</a>
    </section>
  );

  return (
    <Localized locale={locale}>
      {!enabled ? <AreaDenied permission="admin.coordinate" roleLabel={session.roleLabel} home="/admin" t={messages(locale)} /> :
        <PageBody className="max-w-5xl">
          <PageHeader title={labels.title} description={labels.summary} />
          {response?.error || !parsed.success ? <p role="alert">{labels.unavailable}</p> : (
            <div className="grid gap-3">
              <p>{labels.asOf} {date(today)}</p>
              {section("late", labels.late, labels.lateHelp, "/admin/dispatch", labels.openDispatch,
                parsed.data.late.map((item) => item.published
                  ? <>{item.document} · {labels.line} {item.line} · {labels.trip} {item.trip} · {date(item.date)}</>
                  : <>{labels.trip} {item.trip} · {date(item.date)} · {labels.neverPublished}</>))}
              {section("unresolved", labels.unresolved, labels.unresolvedHelp, "/admin/delivery-recovery", labels.openRecovery,
                parsed.data.unresolved.map((item) => <>{item.document} · {labels.line} {item.line} · {item.failed ? labels.failed : labels.partial}
                  {" · "}{labels.outstanding} {quantities.format(item.open)} {item.unit}{item.reason && <> · {item.reason}</>}</>))}
              {section("proof", labels.proof, labels.proofHelp, "/admin/proof-review", labels.openProof,
                parsed.data.proof.map((item) => <>{item.document} · {labels.line} {item.line} · {labels[item.status]}</>))}
              {section("paper", labels.paper, labels.paperHelp, "/admin/dispatch#original-do-title", labels.openPaper,
                parsed.data.paper.map((item) => <>{item.document}</>))}
              {section("unacknowledged", labels.unacknowledged, labels.unacknowledgedHelp, "/admin/dispatch", labels.openDispatch,
                parsed.data.unacknowledged.map((item) => <>{labels.trip} {item.trip} · {date(item.date)} · {labels.revision} {item.revision} · {item.driver}</>))}
              {section("pickup", labels.pickup, labels.pickupHelp, "/admin/supplier-pickup", labels.openPickup,
                parsed.data.pickup.map((item) => <>{item.document} · {labels.line} {item.line} · {labels.supplier} {item.supplier} · {labels.trip} {item.trip} · {date(item.date)}</>))}
            </div>
          )}
        </PageBody>}
    </Localized>
  );
}
