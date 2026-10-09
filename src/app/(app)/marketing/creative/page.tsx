import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireSession, hasPermission } from "@/server/session";
import { getCreativeCalendar, getCreativeDetail, getCreativeList, getCreativeOptions } from "@/server/queries/creative";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { uuid } from "@/lib/zod";
import { addDays, todayKey } from "@/features/marketing/lib/time";
import { CREATIVE_STAGES, type CreativeFilters } from "@/features/creative/types";
import { creativeCalendarRange } from "@/features/creative/presentation";
import { CreativeWorkspace } from "@/features/creative/components/creative-workspace";

import { getContentOpportunityDetail } from "@/server/queries/marketing";

export const metadata: Metadata = { title: "Creative Production" };
const optionalId = z.preprocess((v) => v || undefined, uuid().optional());
const optionalDate = z.preprocess((v) => v || undefined, z.iso.date().optional());
const paramsSchema = z.object({
  view: z.enum(["board", "calendar", "my-work", "all"]).default("board"),
  q: z.string().max(200).optional(), owner: optionalId, source: optionalId, shoot: optionalId, output: optionalId, creative: optionalId,
  stage: z.preprocess((v) => v || undefined, z.enum(CREATIVE_STAGES).optional()),
  condition: z.preprocess((v) => v || undefined, z.enum(["active", "blocked", "on_hold", "cancelled", "all"]).optional()),
  from: optionalDate, to: optionalDate,
  date_basis: z.enum(["production_due", "review_due"]).default("production_due"),
  anchor: optionalDate, calendar: z.enum(["month", "week", "agenda"]).default("month"),
  basis: z.enum(["target", "scheduled", "published"]).default("target"),
  page: z.coerce.number().int().min(1).max(100000).default(1), unscheduled: z.enum(["0", "1"]).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, "The end date must not be before the start date.");

export default async function CreativePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!hasPermission(session, "marketing.read")) return <PermissionDenied permission="marketing.read" roleLabel={session.roleLabel} />;
  const raw = await searchParams;
  const parsed = paramsSchema.safeParse(raw);
  if (!parsed.success) return <PageBody><PageHeader title="Check the creative filters" description="One of the selected dates, pages or filters is invalid." /><Link href="/marketing/creative" className="text-info underline">Reset filters</Link></PageBody>;
  const p = parsed.data;
  const today = todayKey();
  const anchor = p.anchor ?? today;
  const range = creativeCalendarRange(anchor, p.calendar);
  const filters: CreativeFilters = {
    search: p.view === "calendar" ? undefined : p.q,
    owner_id: p.owner, content_opportunity_id: p.view === "calendar" ? undefined : p.source, shoot_booking_id: p.view === "calendar" ? undefined : p.shoot,
    condition: p.view === "calendar" ? undefined : p.condition ?? (p.view === "all" ? "all" : undefined), mine: p.view === "my-work", unscheduled: p.view !== "calendar" && p.unscheduled === "1",
    date_basis: p.date_basis, from: p.view === "calendar" ? undefined : p.from, to: p.view === "calendar" || !p.to ? undefined : addDays(p.to, 1),
  };
  const boardStages = p.stage ? [p.stage] : [...CREATIVE_STAGES];
  const [list, columns, calendar, options, detail, source] = await Promise.all([
    getCreativeList({ ...filters, stage: p.stage, page: p.view === "board" || p.view === "calendar" ? 1 : p.page, page_size: 30 }),
    p.view === "board" ? Promise.all(boardStages.map(async (stage) => {
      const pageInput = Number(raw[`page_${stage}`] ?? 1);
      const page = Number.isSafeInteger(pageInput) && pageInput > 0 && pageInput <= 100000 ? pageInput : 1;
      return { stage, data: await getCreativeList({ ...filters, stage, page, page_size: 8 }) };
    })) : Promise.resolve([]),
    p.view === "calendar" ? getCreativeCalendar({ ...range, basis: p.basis, owner_id: p.owner, page: p.page, page_size: 100 }) : Promise.resolve(null),
    getCreativeOptions(),
    p.creative ? getCreativeDetail(p.creative) : Promise.resolve(null),
    raw.new === "1" && p.source ? getContentOpportunityDetail(p.source) : Promise.resolve(null),
  ]);
  return <CreativeWorkspace initialBrief={source ? { title: `${source.project_name ?? "Project"} · creative`, key_message: source.story_angle ?? "", mandatory_coverage: source.special_requirements ?? "" } : undefined} view={p.view} list={list} columns={columns} calendar={calendar} options={options} detail={detail} selectedMissing={Boolean(p.creative && !detail)} today={today} calendarMode={p.calendar} anchor={anchor} range={range} basis={p.basis} />;
}
