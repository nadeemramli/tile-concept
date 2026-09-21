export const CREATIVE_PHASES = ["briefing", "preparing", "in_production", "review", "approved"] as const;
export const CREATIVE_STAGES = [...CREATIVE_PHASES, "scheduled", "published"] as const;
export const CREATIVE_TEMPLATES = ["project_showcase", "testimonial", "installation", "product_education", "promotion", "graphic"] as const;
export const CREATIVE_FORMATS = ["vertical_video", "landscape_video", "photo", "carousel", "graphic", "copy"] as const;
export const CREATIVE_SOURCE_MODES = ["new_footage", "existing_footage", "mixed", "no_filming"] as const;
export const CREATIVE_CHANNELS = ["tiktok", "instagram", "facebook", "youtube", "website", "other"] as const;
export const CREATIVE_LINK_TYPES = ["reference", "brief_script", "storyboard", "shot_list", "raw_footage", "working_project", "draft_review", "final_export"] as const;
export type CreativePhase = typeof CREATIVE_PHASES[number];
export type CreativeStage = typeof CREATIVE_STAGES[number];
export type CreativeCondition = "active" | "blocked" | "on_hold" | "cancelled";
export type CreativeBrief = { objective: string; audience: string; key_message: string; cta: string; shot_plan: string; caption: string; mandatory_coverage: string; claims: string };
export interface CreativeCard {
  id: string; title: string; template: typeof CREATIVE_TEMPLATES[number]; format: typeof CREATIVE_FORMATS[number] | null;
  source_mode: typeof CREATIVE_SOURCE_MODES[number]; phase: CreativePhase; stage: CreativeStage; condition: CreativeCondition;
  owner_id: string | null; owner_name: string | null; reviewer_id: string | null; reviewer_name: string | null;
  production_due: string | null; review_due: string | null; channels: string[]; priority: "low" | "normal" | "high";
  blocker_reason: string | null; blocker_owner_id: string | null; next_action: string | null; blocker_review_date: string | null;
  source_ready: boolean; source_readiness_note: string | null; revision: number; approved_version_id: string | null;
  publication_count: number; scheduled_count: number; published_count: number; next_target_date: string | null;
  risks: string[]; created_at: string; updated_at: string;
}
export interface CreativeSource { id: string; content_opportunity_id: string; shoot_booking_id: string | null; shoot_output_id: string | null; title: string; booking_title: string | null; booking_status: string | null; starts_at: string | null; ends_at: string | null; permission_status: string | null; permission_expires_at: string | null; permitted_uses: string[]; restrictions: string | null; added_at: string }
export interface CreativeLink { id: string; kind: typeof CREATIVE_LINK_TYPES[number]; label: string; url: string; access_state: "not_checked" | "confirmed" | "problem"; created_by: string; created_at: string }
export interface CreativeVersion { id: string; version_no: number; export_label: string; review_url: string; final_url: string; notes: string; submitted_by: string; submitted_at: string; brief_snapshot: CreativeBrief }
export interface CreativeReview { id: string; version_id: string; decision: "approved" | "changes_requested"; notes: string; reviewer_id: string; reviewed_at: string }
export interface CreativePublication { id: string; creative_id: string; version_id: string | null; channel: string; account_label: string; intended_use: "organic_social" | "paid_ads" | "website" | "showroom_display" | "print"; target_date: string | null; status: "planned" | "scheduled" | "published" | "cancelled"; scheduled_at: string | null; scheduling_method: string | null; published_at: string | null; live_url: string | null; cancellation_reason: string | null; external_action_required: boolean; external_action_note: string | null }
export interface CreativeEvent { id: string; action: string; actor_id: string; occurred_at: string; data: Record<string, unknown> }
export interface CreativeDetail extends CreativeCard { brief: CreativeBrief; sources: CreativeSource[]; links: CreativeLink[]; versions: CreativeVersion[]; reviews: CreativeReview[]; publications: CreativePublication[]; events: CreativeEvent[] }
export interface CreativeFilters { content_opportunity_id?: string; shoot_booking_id?: string; search?: string; owner_id?: string; reviewer_id?: string; stage?: CreativeStage; condition?: CreativeCondition | "all"; mine?: boolean; unscheduled?: boolean; date_basis?: "production_due" | "review_due"; from?: string; to?: string; page?: number; page_size?: number }
export interface CreativeList { items: CreativeCard[]; total: number; stage_counts: Record<CreativeStage, number>; page: number; page_size: number }
export interface CreativeCalendarFilters { from: string; to: string; basis?: "target" | "scheduled" | "published"; page?: number; page_size?: number; owner_id?: string }
export interface PublicationCard extends CreativePublication { title: string; stage: CreativeStage; condition: CreativeCondition; owner_name: string | null; risks: string[] }
export interface CreativeCalendar { items: PublicationCard[]; total: number; unique_creatives: number; page: number; page_size: number }
export interface CreativeOptions { lookup_limit: number; opportunities_total: number; bookings_total: number; members: { id: string; name: string; can_write: boolean; can_review: boolean; can_publish: boolean }[]; opportunities: { id: string; title: string }[]; bookings: { id: string; title: string; content_opportunity_id: string; starts_at: string; ends_at: string }[] }
export type CreativeCommandResult = { id: string; revision: number };
