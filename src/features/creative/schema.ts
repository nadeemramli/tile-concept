import { z } from "zod";
import { uuid } from "@/lib/zod";
import { CREATIVE_CHANNELS, CREATIVE_FORMATS, CREATIVE_LINK_TYPES, CREATIVE_SOURCE_MODES, CREATIVE_STAGES, CREATIVE_TEMPLATES } from "./types";

const text = z.string().trim().max(10000).default("");
const id = uuid().nullable().optional();
const date = z.iso.date().nullable().optional();
export const durableUrlSchema = z.string().trim().max(2048).url().refine((value) => {
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && ![...u.searchParams.keys()].some((k) => /^(token|signature|sig|x-amz-signature|x-goog-signature|expires|se)$/i.test(k)); } catch { return false; }
}, "Use a durable HTTP(S) link without credentials or an expiring access token");
export const creativeBriefSchema = z.object({ objective: text, audience: text, key_message: text, cta: text, shot_plan: text, caption: text, mandatory_coverage: text, claims: text });
export const creativeDraftSchema = z.object({ title: z.string().trim().min(2).max(200), template: z.enum(CREATIVE_TEMPLATES), format: z.enum(CREATIVE_FORMATS).nullable().optional(), source_mode: z.enum(CREATIVE_SOURCE_MODES), owner_id: id, reviewer_id: id, production_due: date, review_due: date, channels: z.array(z.enum(CREATIVE_CHANNELS)).max(6).default([]), priority: z.enum(["low", "normal", "high"]).default("normal"), brief: creativeBriefSchema, next_action: text });
export const createCreativeSchema = creativeDraftSchema.extend({ request_id: uuid(), content_opportunity_id: id, shoot_booking_id: id, shoot_output_id: id });
const base = { id: uuid(), expected_revision: z.number().int().min(1), request_id: uuid() };
export const creativeCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("update"), data: creativeDraftSchema }),
  z.object({ ...base, action: z.literal("phase"), data: z.object({ phase: z.enum(["briefing", "preparing", "in_production"]) }) }),
  z.object({ ...base, action: z.literal("condition"), data: z.object({ condition: z.enum(["active", "blocked", "on_hold", "cancelled"]), reason: text, blocker_owner_id: id, next_action: text, blocker_review_date: date }) }),
  z.object({ ...base, action: z.literal("source_add"), data: z.object({ content_opportunity_id: id, shoot_booking_id: id, shoot_output_id: id }) }),
  z.object({ ...base, action: z.literal("source_remove"), data: z.object({ source_id: uuid(), reason: z.string().trim().min(2) }) }),
  z.object({ ...base, action: z.literal("link_add"), data: z.object({ kind: z.enum(CREATIVE_LINK_TYPES), label: z.string().trim().min(2).max(200), url: durableUrlSchema, access_state: z.enum(["not_checked", "confirmed", "problem"]) }) }),
  z.object({ ...base, action: z.literal("link_remove"), data: z.object({ link_id: uuid(), reason: z.string().trim().min(2) }) }),
  z.object({ ...base, action: z.literal("readiness"), data: z.object({ ready: z.boolean(), note: z.string().trim().min(2), rights_confirmed: z.boolean() }) }),
  z.object({ ...base, action: z.literal("submit"), data: z.object({ export_label: z.string().trim().min(2).max(200), review_url: durableUrlSchema, final_url: durableUrlSchema, notes: text, access_confirmed: z.literal(true), specific_export_confirmed: z.literal(true) }) }),
  z.object({ ...base, action: z.literal("review"), data: z.object({ version_id: uuid(), decision: z.enum(["approved", "changes_requested"]), notes: z.string().trim().min(2), restrictions_confirmed: z.boolean() }) }),
  z.object({ ...base, action: z.literal("reopen"), data: z.object({ reason: z.string().trim().min(2), external_cancellation_acknowledged: z.boolean() }) }),
  z.object({ ...base, action: z.literal("publication_plan"), data: z.object({ publication_id: id, channel: z.enum(CREATIVE_CHANNELS), account_label: z.string().trim().min(1).max(200), intended_use: z.enum(["organic_social", "paid_ads", "website", "showroom_display", "print"]), target_date: date }) }),
  z.object({ ...base, action: z.literal("publication_schedule"), data: z.object({ publication_id: uuid(), version_id: uuid(), scheduled_at: z.iso.datetime({ offset: true }), scheduling_method: z.string().trim().min(2), restrictions_confirmed: z.boolean() }) }),
  z.object({ ...base, action: z.literal("publication_publish"), data: z.object({ publication_id: uuid(), version_id: uuid(), published_at: z.iso.datetime({ offset: true }), live_url: durableUrlSchema, restrictions_confirmed: z.boolean() }) }),
  z.object({ ...base, action: z.literal("publication_cancel"), data: z.object({ publication_id: uuid(), reason: z.string().trim().min(2), external_cancellation_acknowledged: z.boolean() }) }),
  z.object({ ...base, action: z.literal("external_action"), data: z.object({ publication_id: uuid(), note: z.string().trim().min(2) }) }),
]);
export const creativeFiltersSchema = z.object({ content_opportunity_id: uuid().optional(), shoot_booking_id: uuid().optional(), search: z.string().trim().max(200).optional(), owner_id: uuid().optional(), reviewer_id: uuid().optional(), stage: z.enum(CREATIVE_STAGES).optional(), condition: z.enum(["active", "blocked", "on_hold", "cancelled", "all"]).optional(), mine: z.boolean().optional(), unscheduled: z.boolean().optional(), date_basis: z.enum(["production_due", "review_due"]).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), page: z.number().int().min(1).default(1), page_size: z.number().int().min(1).max(100).default(30) });
export const creativeCalendarSchema = z.object({ from: z.iso.date(), to: z.iso.date(), basis: z.enum(["target", "scheduled", "published"]).default("target"), owner_id: uuid().optional(), page: z.number().int().min(1).default(1), page_size: z.number().int().min(1).max(100).default(50) }).refine((v) => v.from < v.to && (Date.parse(v.to)-Date.parse(v.from)) / 86400000 <= 366, "Choose a range of at most one year, with an exclusive end date");
export type CreateCreativeInput = z.input<typeof createCreativeSchema>;
export type CreativeCommandInput = z.input<typeof creativeCommandSchema>;
