/** Datetime inputs always represent Kuala Lumpur, regardless of browser timezone. */
export function enquiryDateInput(iso: string): string {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3_600_000).toISOString().slice(0, 23) : "";
}

export function enquiryDateIso(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(input)) return null;
  const local = input.length === 16 ? `${input}:00` : input;
  const time = new Date(`${local}+08:00`).getTime();
  if (!Number.isFinite(time)) return null;
  // Date normalizes impossible calendar dates; do not silently accept them.
  if (new Date(time + 8 * 3_600_000).toISOString().slice(0, 19) !== local.slice(0, 19)) return null;
  return new Date(time).toISOString();
}
