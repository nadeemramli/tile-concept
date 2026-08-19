"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, Check, Copy, ImageIcon, Pencil, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { FactList } from "@/components/patterns/record-drawer";
import { Field } from "@/components/patterns/field";
import { EmptyState } from "@/components/patterns/states";
import { PRODUCT_STATUS, REVIEW_STATE } from "@/lib/domain/status-maps";
import { formatDateTime } from "@/lib/format";
import type { ProductDetail } from "@/server/queries/catalog";
import { addAliasAction, addPackagingAction, addVariantAction, markProductReviewedAction, setProductStatusAction, upsertAttributeValueAction } from "@/server/commands/catalog";
import { ProductFormDialog } from "@/features/catalog/components/product-form-dialog";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { PriceTable } from "@/features/pricing/components/price-table";
import { AddPriceDialog } from "@/features/pricing/components/add-price-dialog";
import type { PriceRow } from "@/server/queries/pricing";

interface Props {
  detail: ProductDetail;
  canWrite: boolean;
  canPublish: boolean;
  canReadPrice: boolean;
  rulesByCategory: Record<string, { attribute_definition_id: string; key: string; label: string; data_type: string; unit: string | null; is_required: boolean; options?: unknown }[]>;
}

export function ProductDetailView({ detail, canWrite, canPublish, canReadPrice, rulesByCategory }: Props) {
  const { product, specs, variants, prices, aliases, media, catalogEntries, audit, duplicates, reference } = detail;
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [tab, setTab] = useState("specs");
  const review = useAction(markProductReviewedAction);
  const status = useAction(setProductStatusAction, { onSuccess: () => setArchiveOpen(false) });

  const missingRequired = specs.filter((s) => s.is_required && (s.value === null || s.value === undefined || s.value === ""));
  const priceRows: PriceRow[] = prices.map((p) => ({
    id: p.id,
    price_list_id: p.price_list_id,
    price_list_name: p.price_list_name,
    price_type: p.price_type,
    variant_id: p.variant_id,
    product_id: product.id,
    product_name: product.name,
    product_code: product.code,
    sku: p.variant_sku,
    brand: product.brand,
    amount: p.amount,
    currency: p.currency,
    unit_id: null,
    unit_code: p.unit_code,
    min_quantity: p.min_quantity,
    valid_from: p.valid_from,
    valid_to: p.valid_to,
    state: p.state,
    review_state: p.review_state,
    source_ref: p.source_ref,
    approved_by_name: p.approved_by_name,
    approved_at: p.approved_at,
    imported_at: null,
    notes: p.notes,
    created_at: null,
  }));

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href="/merchandise/catalog" className="hover:underline">
            Catalog
          </Link>
        }
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px]">{product.code ?? "no code"}</span>
            <span>· {[product.brand, product.category, product.supplier ? `via ${product.supplier}` : null].filter(Boolean).join(" · ")}</span>
            <StatusPill map={PRODUCT_STATUS} value={product.status} />
            <StatusPill map={REVIEW_STATE} value={product.review_state} />
          </span>
        }
      >
        {canWrite && product.review_state !== "reviewed" && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => review.run(product.id)} disabled={review.pending}>
            <Check className="size-3.5" aria-hidden /> Mark reviewed
          </Button>
        )}
        {canWrite && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
        )}
        {canWrite && product.status !== "archived" && (
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={() => setArchiveOpen(true)}>
            <Archive className="size-3.5" aria-hidden /> Archive
          </Button>
        )}
      </PageHeader>

      {/* Provenance strip */}
      <Card className="px-4 py-3">
        <FactList
          items={[
            { label: "Source", value: product.source_ref ?? "Not recorded" },
            { label: "Confidence", value: product.confidence != null ? `${Math.round(Number(product.confidence) * 100)}%` : "—" },
            { label: "Reviewed", value: product.reviewed_by_name ? `${product.reviewed_by_name} · ${formatDateTime(product.reviewed_at)}` : "Not yet reviewed" },
            { label: "Created", value: `${product.created_by_name ?? "—"} · ${formatDateTime(product.created_at)}` },
            { label: "Colour / finish / material", value: [product.color, product.finish, product.material].filter(Boolean).join(" · ") || "—" },
            { label: "Style / use", value: [product.style, product.applicable_use].filter(Boolean).join(" · ") || "—" },
          ]}
          className="sm:grid-cols-3 lg:grid-cols-6"
        />
        {product.description && <p className="mt-3 text-sm text-muted-foreground">{product.description}</p>}
      </Card>

      {duplicates.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-warning">Possible duplicates</span>
            <ul className="mt-1 space-y-0.5">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Link href={`/merchandise/catalog/${d.id}`} className="font-mono hover:underline">
                    {d.code ?? "—"}
                  </Link>
                  <span>{d.name}</span>
                  <span className="text-muted-foreground">{d.brand}</span>
                  <TonePill tone="warning" label={d.reason} />
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground">Human confirmation required; product merge is not available in this release.</p>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="specs">Specifications{missingRequired.length > 0 && <span className="ml-1 rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">{missingRequired.length} missing</span>}</TabsTrigger>
          <TabsTrigger value="variants">Variants ({variants.length})</TabsTrigger>
          {canReadPrice && <TabsTrigger value="pricing">Pricing ({prices.length})</TabsTrigger>}
          <TabsTrigger value="aliases">Aliases ({aliases.length})</TabsTrigger>
          <TabsTrigger value="media">Media ({media.length})</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="refs">Catalog refs ({catalogEntries.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit ({audit.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="specs" className="mt-3">
          <SpecsSection productId={product.id} specs={specs} canWrite={canWrite} categoryLabel={product.category} />
        </TabsContent>

        <TabsContent value="variants" className="mt-3">
          <VariantsSection detail={detail} canWrite={canWrite} />
        </TabsContent>

        {canReadPrice && (
          <TabsContent value="pricing" className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Price is a versioned fact. Current, scheduled, superseded and conflicted states all stay visible; quotes keep their own snapshot.</p>
              {canPublish && <AddPriceDialog productId={product.id} variants={variants.map((v) => ({ id: v.id, label: `${v.sku ?? "—"} · ${v.name ?? "Variant"}` }))} priceLists={reference.priceLists} units={reference.units} />}
            </div>
            <PriceTable rows={priceRows} canPublish={canPublish} productId={product.id} showProduct={false} />
          </TabsContent>
        )}

        <TabsContent value="aliases" className="mt-3">
          <AliasesSection productId={product.id} aliases={aliases} canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="media" className="mt-3">
          {media.length === 0 ? (
            <EmptyState icon={ImageIcon} title="No media yet" description="Product images and PDF crops arrive with the Source Library (Phase 4), which stores originals privately with page/asset provenance." />
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {media.map((m) => (
                <li key={m.id} className="rounded-md border p-2 text-xs">
                  <div className="flex aspect-[4/3] items-center justify-center rounded bg-muted text-muted-foreground">
                    <ImageIcon className="size-5" />
                  </div>
                  <div className="mt-1 truncate font-mono">{m.storage_path}</div>
                  <div className="text-muted-foreground">{m.caption ?? m.kind}{m.is_primary ? " · primary" : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="stock" className="mt-3">
          <EmptyState
            title="No stock source connected — Phase 5"
            description="In-house stock will mirror SQL Account (read-only, with source timestamp and sync status). Supplier availability will appear as time-stamped snapshots with supplier, age, and evidence. Unknown, stale, low, out and ask-supplier states are never collapsed into zero."
            action={{ label: "About the Stock module", href: "/merchandise/stock" }}
          />
        </TabsContent>

        <TabsContent value="refs" className="mt-3">
          {catalogEntries.length === 0 ? (
            <EmptyState title="No catalog references" description="When a product is imported from a PDF or sheet, its page reference and snippet appear here so a reviewer can compare against the source region." />
          ) : (
            <ul className="space-y-2">
              {catalogEntries.map((e) => (
                <li key={e.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="font-mono text-xs text-muted-foreground">{e.page_ref ?? "—"}</div>
                  <div>{e.snippet}</div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          {audit.length === 0 ? (
            <EmptyState title="No audit events" description="Changes to this product, its variants and prices will be listed here." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">When</TableHead>
                    <TableHead className="h-9 text-xs">Actor</TableHead>
                    <TableHead className="h-9 text-xs">Action</TableHead>
                    <TableHead className="h-9 text-xs">Object</TableHead>
                    <TableHead className="h-9 text-xs">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="tnum py-1.5 text-[13px]">{formatDateTime(a.occurred_at)}</TableCell>
                      <TableCell className="py-1.5 text-[13px]">{a.actor_name ?? "system"}</TableCell>
                      <TableCell className="py-1.5 font-mono text-[12px]">{a.action}</TableCell>
                      <TableCell className="py-1.5 text-[13px]">{a.object_table}</TableCell>
                      <TableCell className="py-1.5 text-[13px] text-muted-foreground">{a.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        refs={{ brands: reference.brands, suppliers: reference.suppliers, categories: reference.categories, units: reference.units, rulesByCategory }}
        initial={{
          id: product.id,
          name: product.name,
          code: product.code ?? "",
          brand_id: product.brand_id ?? "",
          supplier_id: product.supplier_id ?? "",
          category_id: product.category_id ?? "",
          color: product.color ?? "",
          finish: product.finish ?? "",
          material: product.material ?? "",
          style: product.style ?? "",
          description: product.description ?? "",
          keywords: (product.search_keywords ?? []).join(", "),
          source_ref: product.source_ref ?? "",
        }}
      />

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {product.name}?</AlertDialogTitle>
            <AlertDialogDescription>Archived products disappear from active views but keep their price history, aliases, and audit trail. Quotes and purchases that reference this product keep their snapshots.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => status.run(product.id, "archived")} disabled={status.pending}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageBody>
  );
}

/* ---------------- specs ---------------- */

function SpecsSection({ productId, specs, canWrite, categoryLabel }: { productId: string; specs: ProductDetail["specs"]; canWrite: boolean; categoryLabel: string | null }) {
  const [editing, setEditing] = useState<ProductDetail["specs"][number] | null>(null);
  const [value, setValue] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const save = useAction(upsertAttributeValueAction, { onSuccess: () => setEditing(null) });
  if (specs.length === 0) return <EmptyState title="No category rules" description={categoryLabel ? `No attribute rules are configured for ${categoryLabel} yet.` : "Assign a category to see its validated attributes."} />;
  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 text-xs">Attribute</TableHead>
              <TableHead className="h-9 text-xs">Value</TableHead>
              <TableHead className="h-9 text-xs">Type</TableHead>
              <TableHead className="h-9 text-xs">Source</TableHead>
              <TableHead className="h-9 text-xs">Required</TableHead>
              {canWrite && <TableHead className="h-9 w-20 text-xs" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {specs.map((s) => {
              const missing = s.value === null || s.value === undefined || s.value === "";
              return (
                <TableRow key={s.rule_id}>
                  <TableCell className="py-1.5 text-[13px] font-medium">
                    {s.label}
                    {s.unit && <span className="ml-1 text-muted-foreground">({s.unit})</span>}
                  </TableCell>
                  <TableCell className="tnum py-1.5 text-[13px]">{missing ? <TonePill tone={s.is_required ? "warning" : "neutral"} label={s.is_required ? "Missing (required)" : "Not set"} /> : String(s.value)}</TableCell>
                  <TableCell className="py-1.5 text-[13px] text-muted-foreground">{s.data_type}</TableCell>
                  <TableCell className="py-1.5 text-[13px] text-muted-foreground">{s.source_ref ?? "—"}</TableCell>
                  <TableCell className="py-1.5 text-[13px]">{s.is_required ? "Yes" : "No"}</TableCell>
                  {canWrite && (
                    <TableCell className="py-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          setEditing(s);
                          setValue(missing ? "" : String(s.value));
                          setSourceRef(s.source_ref ?? "");
                        }}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
            <DialogDescription>Values are validated against the category rule. Record where the value came from.</DialogDescription>
          </DialogHeader>
          <Field label={`Value${editing?.unit ? ` (${editing.unit})` : ""}`}>
            {editing?.data_type === "boolean" ? (
              <SimpleSelect value={value} onChange={setValue} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} />
            ) : editing?.data_type === "enum" && Array.isArray(editing.options) ? (
              <SimpleSelect value={value} onChange={setValue} options={(editing.options as string[]).map((o) => ({ value: String(o), label: String(o) }))} />
            ) : (
              <Input type={editing?.data_type === "number" || editing?.data_type === "dimension" ? "number" : "text"} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            )}
          </Field>
          <Field label="Source reference">
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="e.g. Supplier catalog 2026 p.12" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={save.pending || !editing} onClick={() => editing && save.run({ product_id: productId, attribute_definition_id: editing.attribute_definition_id, value, value_id: editing.value_id, source_ref: sourceRef || null })}>
              {save.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- variants ---------------- */

function VariantsSection({ detail, canWrite }: { detail: ProductDetail; canWrite: boolean }) {
  const { product, variants, reference } = detail;
  const [addOpen, setAddOpen] = useState(false);
  const [packFor, setPackFor] = useState<string | null>(null);
  const [vf, setVf] = useState({ sku: "", name: "", selling_unit_id: "", width_mm: "", length_mm: "", thickness_mm: "", depth_mm: "", sheet_width_mm: "", sheet_height_mm: "" });
  const [pf, setPf] = useState({ pack_label: "Carton", pack_unit_id: "", quantity_per_pack: "", inner_unit_id: "", coverage_per_pack: "", coverage_unit_id: "", moq: "", order_increment: "" });
  const addVariant = useAction(addVariantAction, { onSuccess: () => setAddOpen(false) });
  const addPack = useAction(addPackagingAction, { onSuccess: () => setPackFor(null) });
  const unitOpts = reference.units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}` }));

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" aria-hidden /> Add variant
          </Button>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {variants.map((v) => (
          <Card key={v.id} className="gap-2 px-4 py-3">
            <CardHeader className="p-0">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[12px]">{v.sku ?? "—"}</span>
                  <span className="text-muted-foreground">{v.name}</span>
                  {v.is_default && <TonePill tone="info" label="Default" dot={false} />}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard?.writeText(v.id)} aria-label="Copy variant id">
                      <Copy className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy variant id</TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-0">
              <FactList items={[{ label: "Dimensions", value: v.dimensions_label }, { label: "Selling unit", value: v.selling_unit ?? "—" }, { label: "Purchase unit", value: v.purchase_unit ?? "—" }, { label: "Status", value: v.status }]} className="sm:grid-cols-4" />
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Packaging</span>
                  {canWrite && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setPackFor(v.id)}>
                      <Plus className="size-3" aria-hidden /> Add
                    </Button>
                  )}
                </div>
                {v.packaging.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No packaging configuration — carton/MOQ unknown.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {v.packaging.map((p) => (
                      <li key={p.id} className="tnum flex flex-wrap gap-x-3 rounded border px-2 py-1">
                        <span className="font-medium">{p.pack_label ?? "Pack"}</span>
                        {p.quantity_per_pack != null && <span>{Number(p.quantity_per_pack)} {p.inner_unit ?? ""} / pack</span>}
                        {p.coverage_per_pack != null && <span>{Number(p.coverage_per_pack)} {p.coverage_unit ?? ""} coverage</span>}
                        {p.moq != null && <span>MOQ {Number(p.moq)}</span>}
                        {p.order_increment != null && <span>increment {Number(p.order_increment)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add variant</DialogTitle>
            <DialogDescription>Dimensions use explicit millimetres; units are never converted silently.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU" error={fieldError(addVariant.fieldErrors, "sku")}>
              <Input value={vf.sku} onChange={(e) => setVf({ ...vf, sku: e.target.value })} className="font-mono" />
            </Field>
            <Field label="Name">
              <Input value={vf.name} onChange={(e) => setVf({ ...vf, name: e.target.value })} />
            </Field>
            <Field label="Selling unit" className="sm:col-span-2">
              <SimpleSelect value={vf.selling_unit_id} onChange={(v) => setVf({ ...vf, selling_unit_id: v })} options={unitOpts} />
            </Field>
            {(["width_mm", "length_mm", "thickness_mm", "depth_mm", "sheet_width_mm", "sheet_height_mm"] as const).map((k) => (
              <Field key={k} label={k.replace("_mm", " (mm)").replace("_", " ")}>
                <Input type="number" value={vf[k]} onChange={(e) => setVf({ ...vf, [k]: e.target.value })} className="tnum" />
              </Field>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button disabled={addVariant.pending} onClick={() => addVariant.run({ product_id: product.id, ...vf })}>
              {addVariant.pending ? "Saving…" : "Add variant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!packFor} onOpenChange={(o) => !o && setPackFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add packaging configuration</DialogTitle>
            <DialogDescription>Carton contents, coverage, MOQ and order increment for this variant.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pack label" required>
              <Input value={pf.pack_label} onChange={(e) => setPf({ ...pf, pack_label: e.target.value })} />
            </Field>
            <Field label="Pack unit">
              <SimpleSelect value={pf.pack_unit_id} onChange={(v) => setPf({ ...pf, pack_unit_id: v })} options={unitOpts} />
            </Field>
            <Field label="Quantity per pack">
              <Input type="number" value={pf.quantity_per_pack} onChange={(e) => setPf({ ...pf, quantity_per_pack: e.target.value })} className="tnum" />
            </Field>
            <Field label="Inner unit">
              <SimpleSelect value={pf.inner_unit_id} onChange={(v) => setPf({ ...pf, inner_unit_id: v })} options={unitOpts} />
            </Field>
            <Field label="Coverage per pack">
              <Input type="number" value={pf.coverage_per_pack} onChange={(e) => setPf({ ...pf, coverage_per_pack: e.target.value })} className="tnum" />
            </Field>
            <Field label="Coverage unit">
              <SimpleSelect value={pf.coverage_unit_id} onChange={(v) => setPf({ ...pf, coverage_unit_id: v })} options={unitOpts} />
            </Field>
            <Field label="MOQ">
              <Input type="number" value={pf.moq} onChange={(e) => setPf({ ...pf, moq: e.target.value })} className="tnum" />
            </Field>
            <Field label="Order increment">
              <Input type="number" value={pf.order_increment} onChange={(e) => setPf({ ...pf, order_increment: e.target.value })} className="tnum" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPackFor(null)}>
              Cancel
            </Button>
            <Button disabled={addPack.pending || !packFor} onClick={() => packFor && addPack.run({ product_id: product.id, variant_id: packFor, ...pf })}>
              {addPack.pending ? "Saving…" : "Add packaging"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- aliases ---------------- */

function AliasesSection({ productId, aliases, canWrite }: { productId: string; aliases: ProductDetail["aliases"]; canWrite: boolean }) {
  const [alias, setAlias] = useState("");
  const [source, setSource] = useState("");
  const add = useAction(addAliasAction, {
    onSuccess: () => {
      setAlias("");
      setSource("");
    },
  });
  return (
    <div className="space-y-3">
      {aliases.length === 0 ? <p className="text-sm text-muted-foreground">No aliases. Add supplier codes, old catalog names or colloquial names so search finds this product.</p> : (
        <ul className="flex flex-wrap gap-2">
          {aliases.map((a) => (
            <li key={a.id} className="rounded-md border px-2 py-1 text-sm">
              <span className="font-mono">{a.alias}</span>
              {a.source && <span className="ml-2 text-xs text-muted-foreground">{a.source}</span>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.run({ product_id: productId, alias, source });
          }}
        >
          <Field label="Alias">
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} className="h-8 w-56 font-mono" />
          </Field>
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-48" placeholder="supplier code, old catalog…" />
          </Field>
          <Button type="submit" size="sm" className="h-8" disabled={add.pending || alias.trim().length < 2}>
            Add alias
          </Button>
        </form>
      )}
    </div>
  );
}
