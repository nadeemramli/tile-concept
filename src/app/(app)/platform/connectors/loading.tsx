import { PageBody } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-6 w-36" />
      <Skeleton className="h-4 w-full max-w-3xl" />
      <Skeleton className="h-9 w-96" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-64 animate-skeleton rounded-xl" />
        <Skeleton className="h-64 animate-skeleton rounded-xl" />
      </div>
      <SkeletonTable rows={6} cols={5} />
    </PageBody>
  );
}
