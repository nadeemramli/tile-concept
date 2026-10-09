import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { SkeletonTable } from "@/components/patterns/states";
export default function LoadingCreative() {
  return <PageBody><PageHeader title="Creative" description="Loading production work and release plans…" /><SkeletonTable rows={7} cols={4} /></PageBody>;
}
