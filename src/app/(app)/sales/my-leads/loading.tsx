import { PageBody } from "@/components/patterns/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocale } from "@/server/locale";
import { messages } from "@/lib/i18n/messages";

export default async function Loading() {
  const t = messages(await getLocale());
  return (
    <PageBody className="max-w-6xl">
      <p role="status" className="sr-only">{t.myLeads.loading}</p>
      <Skeleton className="h-6 w-40 animate-skeleton" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-11 w-28 rounded-full animate-skeleton" />)}
      </div>
      <Skeleton className="h-11 w-full max-w-xl animate-skeleton" />
      <div className="max-w-xl space-y-2">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28 w-full animate-skeleton" />)}
      </div>
    </PageBody>
  );
}
