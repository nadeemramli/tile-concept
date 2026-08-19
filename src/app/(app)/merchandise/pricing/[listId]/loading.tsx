import { PageBody } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-16" />
      <SkeletonTable rows={10} cols={8} />
    </PageBody>
  );
}
