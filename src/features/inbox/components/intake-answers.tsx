import { StatusPill } from "@/components/patterns/status-pill";
import { SOURCE_CHANNEL } from "@/lib/domain/status-maps";
import { formatDateTime, maskValue } from "@/lib/format";
import { classifyIntakePayload, type PayloadEntry } from "@/features/inbox/lib/payload";
import type { IntakeEventRow } from "@/features/inbox/types";

const PHONE_KEY = /phone|mobile|whatsapp|telefon/;
const EMAIL_KEY = /e[_-]?mail/;

/** Payloads carry raw contact points; mask them for users without contact.reveal. */
function displayValue(entry: PayloadEntry, maskContacts: boolean): string {
  if (!maskContacts) return entry.value;
  if (PHONE_KEY.test(entry.key)) return maskValue(entry.value, "phone");
  if (EMAIL_KEY.test(entry.key)) return maskValue(entry.value, "email");
  return entry.value;
}

/**
 * The sales-readable view of a lead's intake events: the questionnaire answers
 * up front, ad/tracking metadata collapsed behind a "Technical details"
 * disclosure anyone can expand.
 */
export function IntakeAnswers({ intake, maskContacts }: { intake: IntakeEventRow[]; maskContacts: boolean }) {
  if (intake.length === 0) return <p className="text-sm text-muted-foreground">No intake events recorded.</p>;
  return (
    <ul className="space-y-2">
      {intake.map((e) => {
        const { answers, technical } = classifyIntakePayload(e.payload);
        return (
          <li key={e.id} className="rounded-md border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill map={SOURCE_CHANNEL} value={e.source_channel} />
              <span className="text-muted-foreground">
                {e.provider ?? "manual"}
                {e.external_id ? ` · ${e.external_id}` : ""}
              </span>
              <span className="ml-auto tnum text-muted-foreground">{formatDateTime(e.received_at)}</span>
            </div>
            {answers.length > 0 && (
              <dl className="mt-2 space-y-1.5">
                {answers.map((a) => (
                  <div key={a.key} className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{a.label}</dt>
                    <dd className="whitespace-pre-wrap text-sm">{displayValue(a, maskContacts)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {answers.length === 0 && technical.length === 0 && !e.raw_text && (
              <p className="mt-1.5 text-muted-foreground">No form payload recorded.</p>
            )}
            {e.raw_text && <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{e.raw_text}</p>}
            {technical.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">Technical details ({technical.length})</summary>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                  {technical.map((t) => (
                    <div key={t.key} className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.key}</dt>
                      <dd className="truncate" title={t.value}>
                        {t.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
