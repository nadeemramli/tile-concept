import { PageBody } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-7 w-72" />
      <Skeleton className="h-20" />
      <Skeleton className="h-8 w-96" />
      <SkeletonTable rows={6} cols={5} />
    </PageBody>
  );
}
