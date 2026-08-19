import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission, requireSession } from "@/server/session";
import { PermissionDenied, EmptyState } from "@/components/patterns/states";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { getCompareProducts } from "@/server/queries/catalog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Compare products" };

export default async function ComparePage({ searchParams }: PageProps<"/merchandise/catalog/compare">) {
  const session = await requireSession();
  if (!hasPermission(session, "catalog.read")) return <PermissionDenied permission="catalog.read" roleLabel={session.roleLabel} />;
  const sp = await searchParams;
  const ids = (typeof sp.ids === "string" ? sp.ids : "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const products = await getCompareProducts(ids);

  const attrKeys = [...new Set(products.flatMap((p) => Object.keys(p.attrs)))];
  const rows: { label: string; cells: React.ReactNode[] }[] = [
    { label: "Code", cells: products.map((p) => <span key={p.id} className="font-mono text-xs">{p.code ?? "—"}</span>) },
    { label: "Brand", cells: products.map((p) => p.brand ?? "—") },
    { label: "Category", cells: products.map((p) => p.category ?? "—") },
    { label: "Dimensions", cells: products.map((p) => <span key={p.id} className="tnum">{p.dimensions_label}</span>) },
    { label: "Colour", cells: products.map((p) => p.color ?? "—") },
    { label: "Finish", cells: products.map((p) => p.finish ?? "—") },
    { label: "Material", cells: products.map((p) => p.material ?? "—") },
    { label: "Style", cells: products.map((p) => p.style ?? "—") },
    ...attrKeys.map((k) => ({ label: products.find((p) => p.attrs[k])?.attrs[k].label ?? k, cells: products.map((p) => (p.attrs[k] ? `${String(p.attrs[k].value)}${p.attrs[k].unit ? ` ${p.attrs[k].unit}` : ""}` : "—")) })),
    { label: "Current price", cells: products.map((p) => (p.price ? <span key={p.id} className="tnum">{formatMoney(p.price.amount, p.price.currency)}{p.price.unit_code ? ` / ${p.price.unit_code}` : ""} <span className="text-xs text-muted-foreground">({p.price.price_list_name})</span></span> : <span key={p.id} className="text-warning">No approved price</span>)) },
  ];

  return (
    <PageBody>
      <PageHeader eyebrow={<Link href="/merchandise/catalog" className="hover:underline">Catalog</Link>} title="Compare products" description="Side-by-side on shared semantic attributes and current approved prices. Units and currencies are shown as recorded." />
      {products.length < 2 ? (
        <EmptyState title="Select 2–4 products to compare" description="Use the checkboxes in the catalog table and click Compare." action={{ label: "Back to catalog", href: "/merchandise/catalog" }} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 w-40 text-xs">Attribute</TableHead>
                {products.map((p) => (
                  <TableHead key={p.id} className="h-9 text-xs">
                    <Link href={`/merchandise/catalog/${p.id}`} className="font-medium text-foreground hover:underline">
                      {p.name}
                    </Link>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="py-1.5 text-[13px] text-muted-foreground">{r.label}</TableCell>
                  {r.cells.map((c, i) => (
                    <TableCell key={i} className="py-1.5 text-[13px]">
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageBody>
  );
}
