"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Option {
  value: string;
  label: string;
}

const NONE = "__none__";

/** Select with an optional "None" entry; value "" means none. */
export function SimpleSelect({ value, onChange, options, placeholder = "Select…", allowNone = true, noneLabel = "None", className, id, disabled }: { value: string | null | undefined; onChange: (v: string) => void; options: Option[]; placeholder?: string; allowNone?: boolean; noneLabel?: string; className?: string; id?: string; disabled?: boolean }) {
  return (
    <Select value={value ? value : allowNone ? NONE : undefined} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? "h-8 w-full text-sm"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
