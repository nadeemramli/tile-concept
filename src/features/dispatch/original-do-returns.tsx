import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { OriginalDoForm } from "./original-do-form";
import { originalDoLabels } from "./original-do-labels";

const originalReturns = z.array(z.object({
  document: z.string(),
  proofs: z.array(z.object({ id: z.uuid(), line: z.string() })),
  receivedAt: z.string().nullable(),
  receivedBy: z.string().nullable(),
}));

export async function OriginalDoReturns({ locale }: { locale: "en" | "ms" }) {
  const labels = originalDoLabels[locale];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("synthetic_original_do_returns");
  const parsed = originalReturns.safeParse(data);
  const timestamps = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur",
  });

  return (
    <section aria-labelledby="original-do-title" className="grid gap-3 rounded-lg border p-4">
      <header>
        <h2 id="original-do-title" className="font-semibold">{labels.title}</h2>
        <p className="text-sm text-muted-foreground">{labels.description}</p>
      </header>
      {error || !parsed.success ? <p role="alert">{labels.loadFailed}</p> : parsed.data.length === 0
        ? <p className="text-sm">{labels.empty}</p>
        : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {parsed.data.map((record) => (
            <li key={record.document}>
              <article aria-label={record.document} className="grid gap-2 rounded-md border p-3 text-sm">
                <h3 className="break-words font-medium">{record.document}</h3>
                <p role="status">{record.receivedAt ? labels.received : labels.outstanding}</p>
                {record.receivedAt && <p>{record.receivedBy} · <time dateTime={record.receivedAt}>
                  {timestamps.format(new Date(record.receivedAt))}</time></p>}
                <div>
                  <p>{record.proofs.length ? labels.uploaded : labels.noProof}</p>
                  {record.proofs.map((proof) => (
                    <a key={proof.id} className="flex min-h-11 items-center underline"
                      href={`/admin/my-deliveries/proof/${proof.id}`}>{labels.proofFor} {proof.line}</a>
                  ))}
                </div>
                {!record.receivedAt && <OriginalDoForm document={record.document} labels={labels} />}
              </article>
            </li>
          ))}
        </ul>}
    </section>
  );
}
