import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";
import { getMediaCoverage, getMediaReviewQueue } from "@/server/queries/media-review";
import { MEDIA_REVIEW_VIEWS, type MediaReviewView } from "@/features/catalog/media-review-schema";
import { MediaReviewClient } from "@/features/catalog/components/media-review";

export const metadata: Metadata = { title: "Imported media review" };

export default async function MediaReviewPage({ searchParams }: PageProps<"/merchandise/catalog/media-review">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.write")) return <PermissionDenied permission="catalog.write" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const view = (MEDIA_REVIEW_VIEWS as readonly string[]).includes(String(sp.view)) ? (sp.view as MediaReviewView) : "open";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const [queue, coverage] = await Promise.all([getMediaReviewQueue(view, q), getMediaCoverage()]);

  return (
    <PageBody>
      <PageHeader
        eyebrow={<Link href="/merchandise/catalog" className="hover:underline">Catalog</Link>}
        title="Imported media review"
        description="Check each imported image against its source page, confirm or correct the variant it shows, record usage rights, then publish. Nothing imported is shown to sales until all three are done."
      >
        <Button asChild size="sm" variant="outline">
          <Link href="/sources/review">Commercial proposals</Link>
        </Button>
      </PageHeader>
      <MediaReviewClient key={`${view}:${q ?? ""}`} view={view} q={q ?? ""} queue={queue} coverage={coverage} />
    </PageBody>
  );
}
