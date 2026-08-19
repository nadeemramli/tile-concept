"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { addPriceAction } from "@/server/commands/pricing";

interface Props {
  productId?: string | null;
  variants: { id: string; label: string }[];
  priceLists: { id: string; name: string; price_type: string; currency: string }[];
  units: { id: string; code: string; label: string }[];
  defaultListId?: string;
  triggerLabel?: string;
}

export function AddPriceDialog({ productId, variants, priceLists, units, defaultListId, triggerLabel = "Add price" }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ price_list_id: defaultListId ?? "", variant_id: variants.length === 1 ? variants[0].id : "", amount: "", currency: "MYR", unit_id: "", min_quantity: "1", valid_from: today, valid_to: "", source_ref: "", notes: "" });
  const add = useAction(addPriceAction, { onSuccess: () => setOpen(false) });
  const list = priceLists.find((l) => l.id === f.price_list_id);

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add price (draft)</DialogTitle>
            <DialogDescription>Creates a draft on the chosen list. Publish after review; overlapping current prices are blocked unless overridden with a reason.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Price list" required error={fieldError(add.fieldErrors, "price_list_id")}>
              <SimpleSelect value={f.price_list_id} onChange={(v) => setF({ ...f, price_list_id: v, currency: priceLists.find((l) => l.id === v)?.currency ?? f.currency })} options={priceLists.map((l) => ({ value: l.id, label: `${l.name} · ${l.price_type}` }))} allowNone={false} />
            </Field>
            <Field label="Variant" required error={fieldError(add.fieldErrors, "variant_id")}>
              <SimpleSelect value={f.variant_id} onChange={(v) => setF({ ...f, variant_id: v })} options={variants.map((v) => ({ value: v.id, label: v.label }))} allowNone={false} />
            </Field>
            <Field label={`Amount (${list?.currency ?? f.currency})`} required error={fieldError(add.fieldErrors, "amount")}>
              <Input type="number" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="tnum" />
            </Field>
            <Field label="Price basis (unit)" hint="piece, sheet, carton, m, sqm">
              <SimpleSelect value={f.unit_id} onChange={(v) => setF({ ...f, unit_id: v })} options={units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}` }))} />
            </Field>
            <Field label="Minimum quantity">
              <Input type="number" value={f.min_quantity} onChange={(e) => setF({ ...f, min_quantity: e.target.value })} className="tnum" />
            </Field>
            <Field label="Valid from" required error={fieldError(add.fieldErrors, "valid_from")}>
              <Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} />
            </Field>
            <Field label="Valid to" hint="Leave empty for open-ended">
              <Input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} />
            </Field>
            <Field label="Source reference" hint="Document / page / row / URL" className="sm:col-span-2">
              <Input value={f.source_ref} onChange={(e) => setF({ ...f, source_ref: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
            </Field>
          </div>
          {add.error && <p className="text-sm text-destructive">{add.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={add.pending || !f.price_list_id || !f.variant_id || !f.amount} onClick={() => add.run({ ...f, currency: list?.currency ?? f.currency }, productId)}>
              {add.pending ? "Saving…" : "Add draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
