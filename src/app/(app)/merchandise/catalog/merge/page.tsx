import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionDenied } from "@/components/patterns/states";
import { getMergePreview } from "@/server/queries/catalog-merge";
import { getBrands, getCategories } from "@/server/queries/reference";
import { ProductMergeReview } from "@/features/catalog/components/product-merge";
import { humanizeDbError } from "@/server/action-result";

export const metadata: Metadata = { title: "Review product merge" };

export default async function ProductMergePage({ searchParams }: PageProps<"/merchandise/catalog/merge">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.write")) return <PermissionDenied permission="catalog.write" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const survivor = typeof sp.survivor === "string" ? sp.survivor : "";
  const merged = typeof sp.merged === "string" ? sp.merged : "";
  const header = <PageHeader eyebrow={<Link href="/merchandise/catalog" className="hover:underline">Catalog</Link>} title="Review product merge" description="Compare the two products, choose which one survives, decide what happens to each variant, and confirm. Every reference moves in one transaction; nothing merges until you confirm." />;
  if (!survivor || !merged) return <PageBody>{header}<EmptyState title="Choose two products" description="Open a product with a possible duplicate and use Review merge." action={{ label: "Back to catalog", href: "/merchandise/catalog" }} /></PageBody>;

  const [{ impact, error }, brands, categories] = await Promise.all([getMergePreview(survivor, merged), getBrands(), getCategories()]);
  return (
    <PageBody>
      {header}
      {impact ? (
        <ProductMergeReview key={`${survivor}:${merged}`} initial={impact} brands={Object.fromEntries(brands.map((b) => [b.id, b.name]))} categories={Object.fromEntries(categories.map((c) => [c.id, c.label]))} />
      ) : (
        <EmptyState title="These products cannot be compared" description={humanizeDbError(error ?? "Product not found")} action={{ label: "Back to catalog", href: "/merchandise/catalog" }} />
      )}
    </PageBody>
  );
}
