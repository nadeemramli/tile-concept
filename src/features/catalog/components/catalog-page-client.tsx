"use client";

import { parseAsBoolean, useQueryState } from "nuqs";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductFormDialog, type ProductFormRefs } from "@/features/catalog/components/product-form-dialog";

export function NewProductButton({ refs }: { refs: ProductFormRefs }) {
  const [open, setOpen] = useQueryState("new", parseAsBoolean.withDefault(false));
  return (
    <>
      <Button size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> New product
      </Button>
      <ProductFormDialog open={open} onOpenChange={(o) => setOpen(o ? true : null)} refs={refs} />
    </>
  );
}
