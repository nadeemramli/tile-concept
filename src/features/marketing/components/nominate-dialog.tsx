"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/patterns/field";
import { FormDialog, formToObject } from "@/features/crm/components/form-dialog";
import { nominateContentOpportunityAction, searchProjectsAction, type ProjectOption } from "@/server/commands/marketing";
import { CONTENT_TYPES, PRODUCT_INTEREST_OPTIONS, READINESS_OPTIONS, meta, READINESS_STATE } from "@/features/marketing/lib/status";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Nominating links an existing customer project — it never creates a second
 * customer, project or opportunity record (PRD §7.11).
 */
export function NominateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selected, setSelected] = useState<ProjectOption | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<string>("in_progress");
  const [priority, setPriority] = useState<string>("normal");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchProjectsAction(query);
        if (res.ok) setProjects(res.data);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  const reset = () => {
    setQuery("");
    setSelected(null);
    setTypes([]);
    setProducts([]);
    setReadiness("in_progress");
    setPriority("normal");
  };

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Nominate a customer project"
      description="Pick a project that is finished or nearly finished. Marketing reviews readiness, permission and the story angle before anything is scheduled."
      submitLabel="Nominate"
      className="sm:max-w-2xl"
      action={async (fd) => {
        if (!selected) return { ok: false as const, error: "Choose a project first" };
        return nominateContentOpportunityAction({
          ...formToObject(fd),
          project_id: selected.id,
          content_types: types,
          products_used: products,
          readiness_state: readiness,
          priority,
        });
      }}
      onSuccess={reset}
    >
      <Field label="Project" required hint={selected ? "Selected. Search again to change it." : "Search by project name."}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Condo renovation, café fit-out…" className="pl-7" />
        </div>
        <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {projects.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{pending ? "Searching…" : "No projects match."}</li>}
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  selected?.id === p.id && "bg-accent",
                )}
              >
                {selected?.id === p.id ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <span className="size-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  <span className="ml-2 text-xs text-muted-foreground">{p.contact_name ?? p.account_name ?? ""}</span>
                </span>
                {p.already_nominated && <span className="shrink-0 text-[10px] text-warning">already nominated</span>}
                {p.area && <span className="shrink-0 text-[11px] text-muted-foreground">{p.area}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Field>

      <Field label="Content types" required error={types.length === 0 ? "Choose at least one" : undefined}>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {CONTENT_TYPES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <Checkbox checked={types.includes(c.value)} onCheckedChange={() => toggle(types, setTypes, c.value)} />
              {c.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Story angle" htmlFor="story_angle" hint="One line on what makes this project worth featuring.">
        <Input id="story_angle" name="story_angle" placeholder="Before and after of the feature wall" />
      </Field>

      <Field label="Why this project" htmlFor="nomination_reason">
        <Textarea id="nomination_reason" name="nomination_reason" rows={2} placeholder="Customer is happy with the result and open to being featured." />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project readiness" hint={meta(READINESS_STATE, readiness).label}>
          <Select value={readiness} onValueChange={setReadiness}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {READINESS_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {meta(READINESS_STATE, r).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["low", "normal", "high"].map((p) => (
                <SelectItem key={p} value={p}>
                  {titleCase(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Target window from" htmlFor="target_window_start">
          <Input id="target_window_start" name="target_window_start" type="date" />
        </Field>
        <Field label="Target window to" htmlFor="target_window_end">
          <Input id="target_window_end" name="target_window_end" type="date" />
        </Field>
      </div>

      <Field label="Products used">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PRODUCT_INTEREST_OPTIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <Checkbox checked={products.includes(p)} onCheckedChange={() => toggle(products, setProducts, p)} />
              {titleCase(p)}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Site notes" htmlFor="site_notes" hint="Access, parking, who to ask for on arrival.">
        <Textarea id="site_notes" name="site_notes" rows={2} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interview subjects" htmlFor="interview_subjects">
          <Input id="interview_subjects" name="interview_subjects" placeholder="Owner, installer" />
        </Field>
        <Field label="Special requirements" htmlFor="special_requirements">
          <Input id="special_requirements" name="special_requirements" placeholder="Weekday mornings only" />
        </Field>
      </div>
    </FormDialog>
  );
}
