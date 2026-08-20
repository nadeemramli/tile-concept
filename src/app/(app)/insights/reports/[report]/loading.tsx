import { PageBody } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-40 animate-skeleton rounded-xl" />
      <Skeleton className="h-8 w-96" />
      <Skeleton className="h-64 animate-skeleton rounded-xl" />
      <SkeletonTable rows={8} cols={6} />
    </PageBody>
  );
}
