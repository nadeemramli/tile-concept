"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { createPriceListAction, updatePriceListAction } from "@/server/commands/pricing";
import type { PriceListInput } from "@/features/pricing/schema";

interface Refs {
  suppliers: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  categories: { id: string; label: string }[];
}

const TYPES = ["retail", "member", "project", "contract", "cost", "other"].map((t) => ({ value: t, label: t }));

export function PriceListFormDialog({ refs, initial, listId, trigger }: { refs: Refs; initial?: Partial<PriceListInput>; listId?: string; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<PriceListInput>({ name: "", price_type: "retail", currency: "MYR", market: "MY", tax_inclusive: false, status: "active", supplier_id: "", brand_id: "", category_id: "", source_ref: "", notes: "", ...(initial ?? {}) });
  const create = useAction(createPriceListAction, {
    onSuccess: (d) => {
      setOpen(false);
      router.push(`/merchandise/pricing/${d.id}`);
    },
  });
  const update = useAction(updatePriceListAction, { onSuccess: () => setOpen(false) });
  const act = listId ? update : create;
  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm" className="h-8 gap-1.5">
            <Plus className="size-3.5" aria-hidden /> New price list
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{listId ? "Edit price list" : "New price list"}</DialogTitle>
            <DialogDescription>Scope by supplier, brand or category. Currency and tax treatment are fixed per list; conversions are never implicit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required error={fieldError(act.fieldErrors, "name")} className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Price type">
              <SimpleSelect value={f.price_type} onChange={(v) => setF({ ...f, price_type: v as PriceListInput["price_type"] })} options={TYPES} allowNone={false} />
            </Field>
            <Field label="Currency" error={fieldError(act.fieldErrors, "currency")}>
              <Input value={f.currency ?? "MYR"} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} className="font-mono uppercase" />
            </Field>
            <Field label="Supplier scope">
              <SimpleSelect value={f.supplier_id ?? ""} onChange={(v) => setF({ ...f, supplier_id: v })} options={refs.suppliers.map((s) => ({ value: s.id, label: s.name }))} noneLabel="Any supplier" />
            </Field>
            <Field label="Brand scope">
              <SimpleSelect value={f.brand_id ?? ""} onChange={(v) => setF({ ...f, brand_id: v })} options={refs.brands.map((b) => ({ value: b.id, label: b.name }))} noneLabel="Any brand" />
            </Field>
            <Field label="Category scope">
              <SimpleSelect value={f.category_id ?? ""} onChange={(v) => setF({ ...f, category_id: v })} options={refs.categories.map((c) => ({ value: c.id, label: c.label }))} noneLabel="Any category" />
            </Field>
            <Field label="Status">
              <SimpleSelect value={f.status ?? "active"} onChange={(v) => setF({ ...f, status: v as PriceListInput["status"] })} options={["draft", "active", "archived"].map((s) => ({ value: s, label: s }))} allowNone={false} />
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch checked={!!f.tax_inclusive} onCheckedChange={(v) => setF({ ...f, tax_inclusive: v })} id="tax" />
              <label htmlFor="tax" className="text-sm">
                Prices are tax-inclusive
              </label>
            </div>
            <Field label="Source reference" className="sm:col-span-2">
              <Input value={f.source_ref ?? ""} onChange={(e) => setF({ ...f, source_ref: e.target.value })} />
            </Field>
          </div>
          {act.error && <p className="text-sm text-destructive">{act.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={act.pending || !f.name.trim()} onClick={() => (listId ? update.run(listId, f) : create.run(f))}>
              {act.pending ? "Saving…" : listId ? "Save" : "Create list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
