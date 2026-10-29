"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { EnumSelect, clean } from "@/features/crm/components/selects";
import { FORECAST_BANDS } from "@/features/forecast/schema";
import { FORECAST_BAND } from "@/lib/domain/status-maps";
import { klToday } from "@/features/forecast/week";
import { formatDate, formatDateTime } from "@/lib/format";
import { reviewForecastAction } from "@/server/commands/forecast";

export interface ReviewTarget {
  id: string;
  name: string;
  version: number;
  expected_close_date: string | null;
  probability_band: string | null;
  estimated_value: number | null;
  currency: string;
  evidence: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}

const BAND_LABELS = Object.fromEntries(FORECAST_BANDS.map((b) => [b, FORECAST_BAND[b].label]));

/** ISO instant → `datetime-local` value in Kuala Lumpur time. */
function toLocalInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

export function ForecastReviewDialog({ open, onOpenChange, target }: { open: boolean; onOpenChange: (o: boolean) => void; target: ReviewTarget }) {
  const router = useRouter();
  const request = useRef<string | null>(null);
  const today = klToday();
  const passed = !!target.expected_close_date && target.expected_close_date < today;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Review forecast: ${target.name}`}
      description={
        target.reviewed_at
          ? `Last reviewed ${formatDateTime(target.reviewed_at)}${target.reviewed_by_name ? ` by ${target.reviewed_by_name}` : ""}. Saving records a new review; the earlier one stays in history.`
          : "Not reviewed yet. Leave a field blank when it is genuinely unknown; it will stay unknown and remain in the review queue."
      }
      submitLabel="Save review"
      className="sm:max-w-xl"
      action={async (fd) => {
        request.current ??= crypto.randomUUID();
        return reviewForecastAction({ ...clean(formToObject(fd)), opportunity_id: target.id, version: target.version, request_id: request.current });
      }}
      onSuccess={() => {
        request.current = null;
        router.refresh();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Expected close"
          htmlFor="review-close"
          tip="When you expect the customer to commit. Blank means unknown. A passed date is never moved forward for you."
          hint={passed ? `${formatDate(target.expected_close_date)} has passed. Choose a new date or clear it.` : undefined}
        >
          <Input id="review-close" name="expected_close_date" type="date" autoFocus min={today} defaultValue={passed ? "" : (target.expected_close_date ?? "")} />
        </Field>
        <Field label="Likelihood" htmlFor="review-band" tip="A band, not a percentage. Forecast values are never weighted by it.">
          <EnumSelect id="review-band" name="probability_band" options={FORECAST_BANDS} labels={BAND_LABELS} defaultValue={target.probability_band} placeholder="Unknown" />
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Estimated value" htmlFor="review-value" tip="Your estimate of the order value, before any weighting. Blank means unknown, not zero.">
          <Input id="review-value" name="estimated_value" type="number" min="0" step="0.01" className="tnum" defaultValue={target.estimated_value ?? ""} />
        </Field>
        <Field label="Currency" htmlFor="review-currency" required>
          <Input id="review-currency" name="currency" required maxLength={3} className="font-mono uppercase" defaultValue={target.currency} />
        </Field>
      </div>
      <Field label="Evidence" htmlFor="review-evidence" tip="What supports this forecast: what the customer said or sent, and when. Kept with the review in history.">
        <Textarea id="review-evidence" name="evidence" rows={3} maxLength={2000} defaultValue={target.evidence ?? ""} placeholder="e.g. Customer confirmed budget on site visit; waiting for main contractor's PO" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Next step" htmlFor="review-next" required>
          <Input id="review-next" name="next_action" required defaultValue={target.next_action ?? ""} />
        </Field>
        <Field label="Due (Malaysia time)" htmlFor="review-due" required>
          <Input id="review-due" name="next_action_due_at" type="datetime-local" required defaultValue={target.next_action_due_at ? toLocalInput(target.next_action_due_at) : ""} />
        </Field>
      </div>
    </FormDialog>
  );
}
