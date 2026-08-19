import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied } from "@/components/patterns/states";
import { getCategoryAttributeRules, getProductDetail } from "@/server/queries/catalog";
import { ProductDetailView } from "@/features/catalog/components/product-detail";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/merchandise/catalog/[id]">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.read")) return <PermissionDenied permission="catalog.read" roleLabel={session.roleLabel} />;
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();
  const rulesEntries = await Promise.all(detail.reference.categories.map(async (c) => [c.id, await getCategoryAttributeRules(c.id)] as const));
  return (
    <ProductDetailView
      detail={detail}
      canWrite={hasPermission(session, "catalog.write")}
      canPublish={hasPermission(session, "price.publish")}
      canReadPrice={hasPermission(session, "price.read")}
      rulesByCategory={Object.fromEntries(rulesEntries)}
    />
  );
}
