import type { StatusMap } from "@/lib/domain/status-maps";

/** Project lifecycle, shared by the projects table and the project page. */
export const PROJECT_STATUS: StatusMap = {
  planning: { label: "Planning", tone: "neutral", hint: "Scoped but no work on site yet. Opportunities and quotes can still be attached." },
  active: { label: "Active", tone: "info", hint: "Work is under way on site." },
  completed: { label: "Completed", tone: "success", hint: "Finished and handed over. A completed project can be nominated for marketing content." },
  on_hold: { label: "On hold", tone: "warning", hint: "Paused by the customer or the site. Nothing is lost; resume when it restarts." },
  cancelled: { label: "Cancelled", tone: "destructive", hint: "Will not go ahead. Kept for history and any purchases already recorded." },
};
