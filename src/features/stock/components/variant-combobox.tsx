"use client";

import { forwardRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface VariantOption {
  id: string;
  label: string;
  code: string;
  name: string;
}

/** Type-ahead product picker used by quick entry, mapping and reconciliation. */
export const VariantCombobox = forwardRef<HTMLButtonElement, { variants: VariantOption[]; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }>(function VariantCombobox(
  { variants, value, onChange, placeholder = "Search a product code or name…", className },
  ref,
) {
  const [open, setOpen] = useState(false);
  const selected = variants.find((v) => v.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={ref} type="button" variant="outline" role="combobox" aria-expanded={open} className={cn("h-8 w-full justify-between text-sm font-normal", !selected && "text-muted-foreground", className)}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No product matches.</CommandEmpty>
            <CommandGroup>
              {variants.slice(0, 400).map((v) => (
                <CommandItem
                  key={v.id}
                  value={`${v.code} ${v.name}`}
                  onSelect={() => {
                    onChange(v.id === value ? "" : v.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-3.5", v.id === value ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="font-mono text-[11px] text-muted-foreground">{v.code}</span>
                  <span className="truncate">{v.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
