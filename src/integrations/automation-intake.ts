export const AUTOMATION_SOURCES = ["tiktok", "facebook", "instagram", "threads", "meta", "website"] as const;
export type AutomationSource = (typeof AUTOMATION_SOURCES)[number];

export function sourceChannelFor(source: AutomationSource): "tiktok" | "meta" | "website" {
  if (source === "tiktok") return "tiktok";
  if (source === "website") return "website";
  return "meta";
}

export function sourceLabel(source: AutomationSource): string {
  const labels: Record<AutomationSource, string> = {
    tiktok: "TikTok",
    facebook: "Facebook",
    instagram: "Instagram",
    threads: "Threads",
    meta: "Meta",
    website: "Website",
  };
  return labels[source];
}

interface SourceDetailInput {
  source: AutomationSource;
  source_detail?: string | null;
  campaign_name?: string | null;
  campaign_id?: string | null;
  form_name?: string | null;
  form_id?: string | null;
}

/** Keeps reporting stable at channel level while retaining the exact platform and form. */
export function buildAutomationSourceDetail(input: SourceDetailInput): string {
  const campaign = input.campaign_name || input.campaign_id;
  const form = input.form_name || input.form_id;
  return [sourceLabel(input.source), campaign && `Campaign: ${campaign}`, form && `Form: ${form}`, input.source_detail]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
}

export function buildLeadInboxUrl(appUrl: string, leadId: string): string {
  const url = new URL("/sales/inbox", appUrl);
  url.searchParams.set("view", "all");
  url.searchParams.set("lead", leadId);
  return url.toString();
}

export function buildLeadAlertText(input: { source: AutomationSource; name?: string | null; interest?: string | null; leadUrl: string; whatsappUrl?: string | null }): string {
  const identity = input.name?.trim() || "New prospect";
  const interest = input.interest?.trim() ? ` — ${input.interest.trim()}` : "";
  const lines = [`New ${sourceLabel(input.source)} lead: ${identity}${interest}`, `Open lead: ${input.leadUrl}`];
  if (input.whatsappUrl) lines.push(`Message on WhatsApp: ${input.whatsappUrl}`);
  return lines.join("\n");
}
