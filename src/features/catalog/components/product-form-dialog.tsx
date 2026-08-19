"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { createProductAction, updateProductAction } from "@/server/commands/catalog";
import type { ProductInput } from "@/features/catalog/schema";

export interface ProductFormRefs {
  brands: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  categories: { id: string; key: string; label: string }[];
  units: { id: string; code: string; label: string }[];
  /** attribute rules by category id (required/optional definitions) */
  rulesByCategory?: Record<string, { attribute_definition_id: string; key: string; label: string; data_type: string; unit: string | null; is_required: boolean; options?: unknown }[]>;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  refs: ProductFormRefs;
  initial?: Partial<ProductInput> & { id?: string };
  mode?: "create" | "edit";
}

type DimKey = "width_mm" | "length_mm" | "thickness_mm" | "depth_mm" | "sheet_width_mm" | "sheet_height_mm";
const DIM_FIELDS: Record<string, DimKey[]> = {
  wall_panel: ["width_mm", "depth_mm", "length_mm"],
  tile: ["width_mm", "length_mm", "thickness_mm"],
  cut_tile: ["width_mm", "length_mm"],
  mosaic: ["sheet_width_mm", "sheet_height_mm", "thickness_mm"],
  finishing: [],
  accessory: ["width_mm", "length_mm"],
};
const DIM_LABEL: Record<string, string> = { width_mm: "Width (mm)", length_mm: "Length (mm)", thickness_mm: "Thickness (mm)", depth_mm: "Depth (mm)", sheet_width_mm: "Sheet width (mm)", sheet_height_mm: "Sheet height (mm)" };

export function ProductFormDialog({ open, onOpenChange, refs, initial, mode = "create" }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<ProductInput>({ name: "", attributes: {}, ...(initial ?? {}) });
  const [attrs, setAttrs] = useState<Record<string, string>>(initial?.attributes ?? {});
  // Reset the form when the dialog opens — adjusted during render rather than
  // in an effect, so no cascading render (react.dev/learn/you-might-not-need-an-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ name: "", attributes: {}, ...(initial ?? {}) });
      setAttrs(initial?.attributes ?? {});
    }
  }

  const create = useAction(createProductAction, {
    onSuccess: (d) => {
      onOpenChange(false);
      router.push(`/merchandise/catalog/${d.id}`);
    },
  });
  const update = useAction(updateProductAction, { onSuccess: () => onOpenChange(false) });
  const act = mode === "edit" ? update : create;

  const set = (k: keyof ProductInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const category = refs.categories.find((c) => c.id === form.category_id);
  const dims: DimKey[] = category ? (DIM_FIELDS[category.key] ?? ["width_mm", "length_mm", "thickness_mm"]) : ["width_mm", "length_mm", "thickness_mm"];
  const rules = useMemo(() => (form.category_id && refs.rulesByCategory ? (refs.rulesByCategory[form.category_id] ?? []) : []), [form.category_id, refs.rulesByCategory]);
  const extraRules = rules.filter((r) => !Object.keys(DIM_LABEL).includes(r.key));

  const submit = async () => {
    const payload: ProductInput = { ...form, attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== "")) };
    if (mode === "edit" && initial?.id) await update.run(initial.id, payload);
    else await create.run(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>Common semantics plus category-specific attributes. New products start unreviewed; a catalog operator marks them reviewed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={fieldError(act.fieldErrors, "name")} className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          </Field>
          <Field label="Code / SKU" error={fieldError(act.fieldErrors, "code")}>
            <Input value={form.code ?? ""} onChange={(e) => set("code", e.target.value)} className="font-mono" />
          </Field>
          <Field label="Category">
            <SimpleSelect value={form.category_id ?? ""} onChange={(v) => set("category_id", v)} options={refs.categories.map((c) => ({ value: c.id, label: c.label }))} />
          </Field>
          <Field label="Brand">
            <SimpleSelect value={form.brand_id ?? ""} onChange={(v) => set("brand_id", v)} options={refs.brands.map((b) => ({ value: b.id, label: b.name }))} />
          </Field>
          <Field label="Supplier">
            <SimpleSelect value={form.supplier_id ?? ""} onChange={(v) => set("supplier_id", v)} options={refs.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="Colour">
            <Input value={form.color ?? ""} onChange={(e) => set("color", e.target.value)} />
          </Field>
          <Field label="Finish">
            <Input value={form.finish ?? ""} onChange={(e) => set("finish", e.target.value)} />
          </Field>
          <Field label="Material">
            <Input value={form.material ?? ""} onChange={(e) => set("material", e.target.value)} />
          </Field>
          <Field label="Style">
            <Input value={form.style ?? ""} onChange={(e) => set("style", e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} />
          </Field>
          <Field label="Search keywords" hint="Comma-separated" className="sm:col-span-2">
            <Input value={form.keywords ?? ""} onChange={(e) => set("keywords", e.target.value)} />
          </Field>
          {mode === "create" && (
            <>
              <div className="sm:col-span-2 mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Default variant</div>
              <Field label="Variant SKU" hint="Defaults to the product code">
                <Input value={form.sku ?? ""} onChange={(e) => set("sku", e.target.value)} className="font-mono" />
              </Field>
              <Field label="Selling unit">
                <SimpleSelect value={form.selling_unit_id ?? ""} onChange={(v) => set("selling_unit_id", v)} options={refs.units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}` }))} />
              </Field>
              {dims.map((k) => (
                <Field key={k} label={DIM_LABEL[k] ?? k} error={fieldError(act.fieldErrors, k)}>
                  <Input type="number" inputMode="decimal" value={(form[k] as string | number | undefined) ?? ""} onChange={(e) => set(k, e.target.value)} className="tnum" />
                </Field>
              ))}
              {extraRules.length > 0 && <div className="sm:col-span-2 mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{category?.label} attributes</div>}
              {extraRules.map((r) => (
                <Field key={r.attribute_definition_id} label={`${r.label}${r.unit ? ` (${r.unit})` : ""}`} required={r.is_required}>
                  {r.data_type === "boolean" ? (
                    <SimpleSelect value={attrs[r.attribute_definition_id] ?? ""} onChange={(v) => setAttrs((a) => ({ ...a, [r.attribute_definition_id]: v }))} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} />
                  ) : r.data_type === "enum" && Array.isArray(r.options) ? (
                    <SimpleSelect value={attrs[r.attribute_definition_id] ?? ""} onChange={(v) => setAttrs((a) => ({ ...a, [r.attribute_definition_id]: v }))} options={(r.options as string[]).map((o) => ({ value: String(o), label: String(o) }))} />
                  ) : (
                    <Input type={r.data_type === "number" || r.data_type === "dimension" ? "number" : "text"} value={attrs[r.attribute_definition_id] ?? ""} onChange={(e) => setAttrs((a) => ({ ...a, [r.attribute_definition_id]: e.target.value }))} />
                  )}
                </Field>
              ))}
            </>
          )}
          <Field label="Source reference" hint="Document / page / URL the values came from" className="sm:col-span-2">
            <Input value={form.source_ref ?? ""} onChange={(e) => set("source_ref", e.target.value)} />
          </Field>
        </div>
        {act.error && <p className="text-sm text-destructive">{act.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={act.pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={act.pending || !form.name.trim()}>
            {act.pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
