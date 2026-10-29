"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { InfoTip } from "@/components/patterns/explain";
import { EnumSelect } from "@/features/crm/components/selects";
import { FORECAST_BANDS } from "@/features/forecast/schema";
import { FORECAST_BAND } from "@/lib/domain/status-maps";
import { klToday } from "@/features/forecast/week";
import { formatDate } from "@/lib/format";

const BAND_LABELS = Object.fromEntries(FORECAST_BANDS.map((b) => [b, FORECAST_BAND[b].label]));

const CAPTURE_HINT =
  "Optional. Anything you fill in here is saved as a forecast review once the main action has been saved. Blank fields keep their current value, and nothing here is required: unforecast work is listed in Weekly forecast for review instead.";

/**
 * Optional forecast fields for the create, quote and stage dialogs. Posts
 * `forecast_close_date`, `forecast_band` and `forecast_evidence`.
 */
export function ForecastCaptureFields({ current, idPrefix }: { current?: { expected_close_date: string | null; probability_band: string | null }; idPrefix: string }) {
  const now = current ? `Now: ${current.expected_close_date ? formatDate(current.expected_close_date) : "no close date"} · ${current.probability_band ? FORECAST_BAND[current.probability_band]?.label : "likelihood unknown"}.` : undefined;
  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="flex items-center gap-1 px-1 text-xs font-medium">
        Forecast (optional)
        <InfoTip label="Forecast (optional)" content={CAPTURE_HINT} />
      </legend>
      {now && <p className="text-xs text-muted-foreground">{now}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Expected close" htmlFor={`${idPrefix}-forecast-date`} tip="The date you expect the customer to commit. Must be today or later.">
          <Input id={`${idPrefix}-forecast-date`} name="forecast_close_date" type="date" min={klToday()} />
        </Field>
        <Field label="Likelihood" htmlFor={`${idPrefix}-forecast-band`} tip="A band, not a percentage. Values are never weighted by it.">
          <EnumSelect id={`${idPrefix}-forecast-band`} name="forecast_band" options={FORECAST_BANDS} labels={BAND_LABELS} placeholder="Leave as is" />
        </Field>
      </div>
      <Field label="Evidence" htmlFor={`${idPrefix}-forecast-evidence`} tip="What supports this forecast: what the customer said or sent, and when.">
        <Textarea id={`${idPrefix}-forecast-evidence`} name="forecast_evidence" rows={2} maxLength={2000} />
      </Field>
    </fieldset>
  );
}
