"use client";

import { Field } from "@/components/patterns/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DIMENSION_HINT, DIMENSION_LABEL, REQUIRED_DIMENSIONS, optionsFor, type ClassificationDimension, type ClassificationValues } from "@/features/classification/taxonomy";

export const DIM_ID: Record<ClassificationDimension, string> = {
  buyer_role: "buyer-role",
  project_use: "project-use",
  work_type: "work-type",
  glc_involvement: "glc-involvement",
  glc_party_role: "glc-party-role",
};

/**
 * The four classification selects, plus the GLC party role when a GLC is
 * involved. Earlier-record values are offered only when the record already
 * holds one, so they are preserved but not chosen for new work.
 */
export function ClassificationFields({ value, onChange, idPrefix, current }: { value: ClassificationValues; onChange: (v: ClassificationValues) => void; idPrefix: string; current?: ClassificationValues }) {
  const set = (d: ClassificationDimension, key: string) => {
    const next = { ...value, [d]: key };
    if (d === "glc_involvement") next.glc_party_role = key === "yes" ? (value.glc_party_role ?? "unknown") : null;
    onChange(next);
  };
  const dims: ClassificationDimension[] = [...REQUIRED_DIMENSIONS, ...(value.glc_involvement === "yes" ? (["glc_party_role"] as const) : [])];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {dims.map((d) => {
        const options = optionsFor(d);
        const keep = new Set([value[d], current?.[d]].filter(Boolean) as string[]);
        const primary = options.filter((o) => o.primary);
        const legacy = options.filter((o) => o.legacy && keep.has(o.key));
        const id = `${idPrefix}-${DIM_ID[d]}`;
        return (
          <Field key={d} label={DIMENSION_LABEL[d]} htmlFor={id} tip={DIMENSION_HINT[d]}>
            <Select value={value[d] ?? "unknown"} onValueChange={(k) => set(d, k)}>
              <SelectTrigger id={id} className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {primary.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
                {legacy.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>From earlier records</SelectLabel>
                    {legacy.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Field>
        );
      })}
    </div>
  );
}
