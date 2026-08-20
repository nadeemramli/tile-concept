import { PageBody } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-6 w-56" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 animate-skeleton rounded-xl" />
        ))}
      </div>
      <SkeletonTable rows={10} cols={9} />
    </PageBody>
  );
}
