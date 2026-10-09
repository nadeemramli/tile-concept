"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Field } from "@/components/patterns/field";
import { cn } from "@/lib/utils";
import { EMPTY_MALAYSIA_AREA, MALAYSIA_STATES, formatMalaysiaArea, malaysiaCities, malaysiaPostcodes, type MalaysiaArea } from "@/lib/location/malaysia";

function AreaSelect({ label, value, options, placeholder, disabled, onChange }: {
  label: string; value: string; options: readonly string[]; placeholder: string;
  disabled?: boolean; onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <Field label={label} htmlFor={id}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open}
            aria-controls={open ? `${id}-options` : undefined} aria-haspopup="listbox"
            disabled={disabled} className={cn("h-9 w-full justify-between font-normal", !value && "text-muted-foreground")}>
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-48 max-w-[calc(100vw-2rem)] p-0" align="start">
          <Command label={`Search ${label}`}>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} />
            <CommandList id={`${id}-options`}>
              <CommandEmpty>No match. You can enter the area manually below.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => { onChange(option === value ? "" : option); setOpen(false); }}>
                    <Check className={cn("size-3.5 shrink-0", option === value ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span>{option}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}

export function MalaysiaAreaFields({ value, onChange }: { value: MalaysiaArea; onChange: (value: MalaysiaArea) => void }) {
  const id = useId();
  const cities = malaysiaCities(value.state);
  const codes = malaysiaPostcodes(value.state, value.city);
  const baseLength = formatMalaysiaArea({ ...value, locality: "" }).length;
  return (
    <fieldset className="space-y-3 rounded-md border p-3 sm:col-span-2">
      <legend className="px-1 text-xs font-medium">From (customer&apos;s area)</legend>
      {value.manual ? (
        <Field label="Customer's area" htmlFor={`${id}-manual`} hint="Enter the location as given by the customer.">
          <Input id={`${id}-manual`} aria-describedby={`${id}-manual-hint`} value={value.manualArea}
            onChange={(e) => onChange({ ...value, manualArea: e.target.value })} maxLength={120} className="h-9"
            placeholder="Town, postcode or state, if known" />
        </Field>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <AreaSelect label="Negeri / Wilayah Persekutuan" value={value.state} options={MALAYSIA_STATES} placeholder="Select state"
              onChange={(state) => onChange({ ...EMPTY_MALAYSIA_AREA, state })} />
            <AreaSelect label="Bandar / Pekan" value={value.city} options={cities} disabled={!value.state}
              placeholder={value.state ? "Select town" : "Choose state first"}
              onChange={(city) => onChange({ ...value, city, postcode: "", locality: "" })} />
            <AreaSelect label="Poskod" value={value.postcode} options={codes} disabled={!value.city}
              placeholder={value.city ? "Select postcode" : "Choose town first"}
              onChange={(postcode) => onChange({ ...value, postcode })} />
          </div>
          <Field label="Taman / neighbourhood (optional)" htmlFor={`${id}-locality`} hint="Select only what the customer knows; postcode is optional.">
            <Input id={`${id}-locality`} aria-describedby={`${id}-locality-hint`} value={value.locality}
              onChange={(e) => onChange({ ...value, locality: e.target.value })} disabled={!value.city} className="h-9"
              maxLength={Math.max(0, 120 - baseLength - 2)} placeholder={value.city ? "e.g. Taman Sri Gombak" : "Choose town first"} />
          </Field>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={value.manual} onCheckedChange={(checked) => onChange({ ...EMPTY_MALAYSIA_AREA, manual: checked === true })} />
          Area not listed? Enter manually
        </label>
        <span className="text-[11px] text-muted-foreground">
          Postcodes: <a className="underline underline-offset-2" href="https://data.gov.my/data-catalogue/poskod" target="_blank" rel="noreferrer">MCMC / data.gov.my</a>
          {" · "}<a className="underline underline-offset-2" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
        </span>
      </div>
    </fieldset>
  );
}
