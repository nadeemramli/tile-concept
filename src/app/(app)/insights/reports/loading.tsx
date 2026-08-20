import { PageBody } from "@/components/patterns/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageBody>
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 animate-skeleton rounded-xl" />
        ))}
      </div>
    </PageBody>
  );
}
