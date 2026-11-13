import type { Metadata } from "next";
import { z } from "zod";
import { Localized } from "@/components/i18n/localized";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { ProofReviewForm } from "@/features/dispatch/proof-review-form";
import { ProofUploadForm } from "@/features/dispatch/proof-upload-form";
import { proofUploadLabels } from "@/features/dispatch/proof-upload-labels";
import { proofReviewLabels } from "@/features/dispatch/proof-review-labels";
import { AreaDenied } from "@/features/workspace/components/entry";
import { messages } from "@/lib/i18n/messages";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLocale } from "@/server/locale";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Signed proof review" };

const kind = z.enum(["unclear", "matched", "discrepancy", "approved"]);
const queue = z.object({
  canApprove: z.boolean(),
  rows: z.array(z.object({
    id: z.uuid(), document: z.string(), line: z.string(), item: z.string(), unit: z.string(),
    ordered: z.number(), delivered: z.number(), planned: z.number(), agreement: z.string().nullable(), unitPrice: z.number().nullable(),
    proof: z.string().nullable(), version: z.string(), lastEvent: z.string().nullable(),
    status: z.union([kind, z.enum(["missing", "unchecked"])]), changed: z.boolean(),
    history: z.array(z.object({
      id: z.string(), kind, current: z.boolean(), quantity: z.number().nullable(), price: z.number().nullable(),
      quantityMismatch: z.boolean(), priceMismatch: z.boolean(), note: z.string().nullable(),
      actor: z.string(), at: z.string(),
    })),
  })),
});

export default async function ProofReviewPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const labels = proofReviewLabels[locale];
  const supabase = await createServerSupabase();
  const enabled = process.env.TILE_SYNTHETIC_PREPARATION === "1"
    && session.permissions.includes("admin.coordinate") && ["admin", "business_admin", "management"].includes(session.roleKey);
  const response = enabled ? await supabase.rpc("synthetic_proof_review_queue") : null;
  const parsed = queue.safeParse(response?.data);
  const uploadText = proofUploadLabels[locale];
  const uploadsResponse = enabled ? await supabase.rpc("synthetic_proof_uploads") : null;
  const uploads = new Map(z.array(z.object({
    result: z.uuid(), driver: z.string(), uploader: z.string().nullable(), reason: z.string().nullable(), onBehalf: z.boolean(),
  })).safeParse(uploadsResponse?.data).data?.map((entry) => [entry.result, entry]));
  const quantities = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const price = new Intl.NumberFormat(locale, { style: "currency", currency: session.currency.trim(), maximumFractionDigits: 4 });
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone });

  return (
    <Localized locale={locale}>
      {!enabled ? <AreaDenied permission="admin.coordinate" roleLabel={session.roleLabel} home="/admin" t={messages(locale)} /> :
        <PageBody className="max-w-5xl">
          <PageHeader title={labels.title} description={labels.summary} />
          {response?.error || !parsed.success ? <p role="alert">{labels.unavailable}</p> : (
            <div className="grid gap-3">
              {parsed.data.rows.length === 0 && <p>{labels.empty}</p>}
              {parsed.data.rows.map((row) => {
                const label = row.document + " · " + row.line;
                const needsReview = row.status === "unchecked" || row.status === "unclear";
                const approve = row.status === "discrepancy" && parsed.data.canApprove;
                return (
                  <article aria-label={label} key={row.id} className="grid gap-3 rounded-lg border p-4 text-sm">
                    <header>
                      <h2 className="break-words text-base font-semibold">{label}</h2>
                      <p>{row.item}</p>
                      <p role="status" className="font-medium">{labels[row.status]}</p>
                      {row.changed && <p>{labels.changed}</p>}
                    </header>
                    <p>{labels.ordered} {quantities.format(row.ordered)} {row.unit} · {labels.planned} {quantities.format(row.planned)} {row.unit} · {labels.delivered} {quantities.format(row.delivered)} {row.unit}</p>
                    {row.unitPrice === null ? <p>{labels.noAgreement}</p> :
                      <p>{labels.agreement} {row.agreement} · {labels.agreedPrice} {price.format(row.unitPrice)}</p>}
                    {row.proof && <a className="inline-flex min-h-11 items-center justify-self-start underline"
                      href={`/admin/my-deliveries/proof/${row.id}`}>{labels.download}</a>}
                    {uploads.get(row.id)?.onBehalf && <p className="break-words">
                      {uploadText.uploadedBehalf} {uploads.get(row.id)?.driver} {uploadText.by} {uploads.get(row.id)?.uploader}
                      {uploads.get(row.id)?.reason && <>: {uploads.get(row.id)?.reason}</>}</p>}
                    {row.status === "missing" && <ProofUploadForm result={row.id} behalf labels={uploadText} />}
                    {row.history.length > 0 && <details>
                      <summary className="min-h-11 cursor-pointer py-2">{labels.history}</summary>
                      <ol className="grid gap-2">
                        {row.history.map((entry) => <li key={entry.id} className="grid gap-1 border-l pl-3">
                          <p>{labels[entry.kind]} · {entry.actor} · <time dateTime={entry.at}>{time.format(new Date(entry.at))}</time></p>
                          {!entry.current && <p>{labels.previous}</p>}
                          {entry.quantity !== null && <p>{labels.quantity} {quantities.format(entry.quantity)}</p>}
                          {entry.price !== null && <p>{labels.price} {price.format(entry.price)}</p>}
                          {entry.quantityMismatch && <p>{labels.quantityMismatch}</p>}
                          {entry.priceMismatch && <p>{labels.priceMismatch}</p>}
                          {entry.note && <p className="break-words">{entry.note}</p>}
                        </li>)}
                      </ol>
                    </details>}
                    {(needsReview || approve) && <ProofReviewForm key={row.version + (row.lastEvent ?? "")}
                      row={{ id: row.id, version: row.version, lastEvent: row.lastEvent, unitPrice: row.unitPrice }}
                      labels={labels} approve={approve} />}
                  </article>
                );
              })}
            </div>
          )}
        </PageBody>}
    </Localized>
  );
}
