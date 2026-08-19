"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/format";

/** Native-form-compatible select (emits a hidden input through shadcn Select's `name`). */
export function EnumSelect({ name, options, defaultValue, placeholder = "Select…", labels, allowEmpty = true, id }: { name: string; options: readonly string[]; defaultValue?: string | null; placeholder?: string; labels?: Record<string, string>; allowEmpty?: boolean; id?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? undefined}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value="__none__">—</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels?.[o] ?? titleCase(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface MemberOption {
  user_id: string;
  full_name: string;
}

export function MemberSelect({ name, members, defaultValue, placeholder = "Unassigned", id }: { name: string; members: MemberOption[]; defaultValue?: string | null; placeholder?: string; id?: string }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? undefined}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{placeholder}</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.user_id} value={m.user_id}>
            {m.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Strip the "__none__" sentinel used by selects so zod sees "" (→ undefined). */
export function clean(obj: Record<string, unknown>) {
  for (const k of Object.keys(obj)) if (obj[k] === "__none__") obj[k] = "";
  return obj;
}
