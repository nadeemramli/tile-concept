import type { PayloadEntry } from "@/features/inbox/lib/payload";

/**
 * Questionnaire answers as plain question → answer pairs. Contact fields,
 * ad/campaign ids and other plumbing never reach this component — see
 * mergeFormAnswers. Marketing can still read the raw payload in the
 * Integrations intake log.
 */
export function FormAnswers({ answers }: { answers: PayloadEntry[] }) {
  if (answers.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {answers.map((a) => (
        <div key={a.key} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{a.label}</dt>
          <dd className="whitespace-pre-wrap text-sm">{a.value}</dd>
        </div>
      ))}
    </dl>
  );
}
