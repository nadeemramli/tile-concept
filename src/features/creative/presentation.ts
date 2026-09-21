import type { StatusMap } from "@/lib/domain/status-maps";
import { addDays, addMonths, startOfMonth, startOfWeek } from "@/features/marketing/lib/time";

export const CREATIVE_STAGE_META: StatusMap = {
  briefing: { label: "Briefing", tone: "neutral", hint: "Define the story, owner, audience, format and review handoff." },
  preparing: { label: "Preparing", tone: "warning", hint: "Gather footage, copy and source links. Confirm coverage and rights before production." },
  in_production: { label: "In production", tone: "info", hint: "Editing, writing or designing. Submit a specific export for review when ready." },
  review: { label: "Review", tone: "ai", hint: "The designated reviewer is checking the submitted version. Changes return it to production." },
  approved: { label: "Approved", tone: "success", hint: "An exact version is approved. Add and arrange its channel release plans." },
  scheduled: { label: "Scheduled", tone: "info", hint: "Every remaining active channel release has been arranged for the approved version. Staff must still confirm publication." },
  published: { label: "Published", tone: "success", hint: "Every active release plan has a recorded publication time and live URL. This is recorded evidence, not automatic platform verification." },
};
export const CREATIVE_CONDITION_META: StatusMap = {
  active: { label: "Active", tone: "info", hint: "Work may progress through the production gates." },
  blocked: { label: "Blocked", tone: "destructive", hint: "A named blocker needs action. The creative retains its production stage." },
  on_hold: { label: "On hold", tone: "warning", hint: "Deliberately paused, with a reason and a next action." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "No longer planned. Its versions, decisions and publication history remain accessible." },
};
export const PUBLICATION_META: StatusMap = {
  planned: { label: "Planned", tone: "neutral", hint: "A release intention. Its date does not mean the post has been scheduled externally." },
  scheduled: { label: "Scheduled", tone: "info", hint: "A publisher recorded when and how this approved version was scheduled." },
  published: { label: "Published", tone: "success", hint: "A publisher recorded the actual time and live link." },
  cancelled: { label: "Cancelled", tone: "neutral", hint: "Withdrawn with a reason. External scheduling must be cancelled separately." },
};
export const TEMPLATE_META: Record<string, { label: string; prompt: string }> = {
  project_showcase: { label: "Project showcase / before & after", prompt: "Show the transformation. Identify the project, before/after coverage and customer media permission." },
  testimonial: { label: "Customer testimonial", prompt: "Capture the customer's own experience. List neutral interview questions and check the agreed uses." },
  installation: { label: "Installation / process", prompt: "Explain one process clearly. Identify the product, key steps and must-have detail shots." },
  product_education: { label: "Product education / comparison", prompt: "Answer one audience question. Link the product references and facts that need checking." },
  promotion: { label: "Promotion / campaign", prompt: "State the offer, validity window and call to action. Verify price and offer approval before release." },
  graphic: { label: "Graphic / carousel / repurposed clip", prompt: "Define the key message, source material and layout. Confirm reuse rights, even when no new filming is needed." },
};
export const SOURCE_MODE_META: Record<string, { label: string; prompt: string }> = {
  new_footage: { label: "New footage needed", prompt: "Link an accepted content opportunity, prepare a shot plan and book the shoot. Then add raw footage links and confirm coverage." },
  existing_footage: { label: "Use existing footage", prompt: "Add accessible raw/source links and retain the original customer/project relationship. Confirm coverage and allowed uses." },
  mixed: { label: "Existing footage + pickup shoot", prompt: "Link existing material, list missing coverage and book only the additional footage needed." },
  no_filming: { label: "No filming needed", prompt: "Prepare copy/design and references. Link any customer material being reused so its media permission is still checked." },
};
export const CHANNEL_LABELS: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", website: "Website", other: "Other" };
export const FORMAT_LABELS: Record<string, string> = { vertical_video: "Vertical video", landscape_video: "Landscape video", carousel: "Carousel", photo: "Photo", graphic: "Graphic", copy: "Copy / text" };
export const LINK_LABELS: Record<string, string> = { reference: "Reference", brief_script: "Brief / script", storyboard: "Storyboard", shot_list: "Shot list", raw_footage: "Raw footage / source", working_project: "Working project", draft_review: "Draft review", final_export: "Final export" };
export const USE_LABELS: Record<string, string> = { organic_social: "Organic social", paid_ads: "Paid advertising", website: "Website", showroom_display: "Showroom display", print: "Print" };
export const CREATIVE_SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type CalendarMode = "month" | "week" | "agenda";
export function creativeCalendarRange(anchor: string, mode: CalendarMode) {
  if (mode === "week") { const from = startOfWeek(anchor); return { from, to: addDays(from, 7) }; }
  const from = startOfMonth(anchor);
  return { from, to: addMonths(from, 1) };
}
export function creativeWeekPreset(today: string, offset: number) {
  const from = addDays(startOfWeek(today), offset * 7);
  return { from, to: addDays(from, 7) };
}
export function creativeHref(current: string, patch: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return `/marketing/creative${query ? `?${query}` : ""}`;
}

/** Keep database record identifiers out of the human action hint. */
export function creativeRiskLabel(risk: string) { return risk.replace(/:\s*[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, " — check Sources"); }
