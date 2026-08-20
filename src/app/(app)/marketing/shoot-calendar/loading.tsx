import { PageBody } from "@/components/patterns/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-64 animate-skeleton" />
        <Skeleton className="h-8 w-40 animate-skeleton" />
      </div>
      <Skeleton className="h-[560px] animate-skeleton rounded-lg" />
    </PageBody>
  );
}
