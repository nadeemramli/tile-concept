"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/patterns/record-drawer";
import { Gated } from "@/components/patterns/explain";
import { getRelatedCreativesAction } from "@/server/commands/creative";
import type { CreativeList } from "../types";
import { CREATIVE_STAGE_META } from "../presentation";

/** Load the small related list only while the source drawer is open. */
export function RelatedCreatives({ sourceId, shootId }: { sourceId?: string | null; shootId?: string | null }) {
  const router = useRouter();
  const [result, setResult] = useState<CreativeList | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams();
  if (sourceId) params.set("source", sourceId);
  if (shootId) params.set("shoot", shootId);
  useEffect(() => {
    let active = true;
    getRelatedCreativesAction({ content_opportunity_id: sourceId ?? undefined, shoot_booking_id: shootId ?? undefined })
      .then((response) => { if (active) { setError(!response.ok); setResult(response.ok ? response.data : null); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [sourceId, shootId, attempt]);
  return <DrawerSection title="Creative deliverables" action={<Gated permission="marketing.write"><Button size="sm" variant="outline" onClick={() => router.push(`/marketing/creative?${params}&new=1`)}>Create creative</Button></Gated>}>
    {error ? <p className="text-xs text-destructive">Linked creatives could not load. <Button variant="link" size="sm" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>Retry</Button></p> : !result ? <p className="text-xs text-muted-foreground">Loading linked creatives…</p> : <>
      {result.total === 0 ? <p className="text-sm text-muted-foreground">Turn this source into a deliverable with its own brief, reviewer and channel releases.</p> : <ul className="divide-y rounded-md border">{result.items.map((item) => <li key={item.id} className="px-3 py-2"><Link className="flex flex-wrap items-center justify-between gap-2 text-sm text-info hover:underline" href={`/marketing/creative?${params}&creative=${item.id}`}><span className="min-w-0 break-words">{item.title}</span><span className="text-xs text-muted-foreground">{CREATIVE_STAGE_META[item.stage].label}</span></Link></li>)}</ul>}
      {result.total > 0 && <Link href={`/marketing/creative?${params}&view=all`} className="mt-2 inline-block text-xs text-info hover:underline">View all {result.total} linked creatives →</Link>}
    </>}
  </DrawerSection>;
}
