"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/features/catalog/use-action";
import { deleteFieldMappingAction, upsertFieldMappingAction } from "@/server/commands/connectors";
import type { FieldMappingRow } from "@/server/queries/connectors";

const TARGETS = ["name", "phone", "email", "company", "interest", "product_interest", "area", "notes", "ignore"] as const;
type Target = (typeof TARGETS)[number];
const PROVIDERS = ["meta", "tiktok", "website"];

type Draft = { id?: string; provider: string; form_ref: string; source_field: string; target_field: Target; version: number };

const EMPTY: Draft = { provider: "meta", form_ref: "", source_field: "", target_field: "name", version: 1 };

export function MappingsTab({ rows, canEdit }: { rows: FieldMappingRow[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const upsert = useAction(upsertFieldMappingAction, { onSuccess: () => setDraft(null) });
  const remove = useAction(deleteFieldMappingAction);

  const columns = useMemo<ColumnDef<FieldMappingRow, unknown>[]>(
    () => [
      { accessorKey: "provider", header: "Provider" },
      { accessorKey: "form_ref", header: "Form", cell: ({ row }) => row.original.form_ref ?? <span className="text-muted-foreground">Any form</span> },
      { accessorKey: "source_field", header: "Provider question", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.source_field}</span> },
      { accessorKey: "target_field", header: "Canonical field", cell: ({ row }) => <span className="font-mono text-[12px]">{row.original.target_field}</span> },
      { accessorKey: "version", header: "Version", cell: ({ row }) => <span className="tnum">v{row.original.version}</span> },
      ...(canEdit
        ? [
            {
              id: "actions",
              header: "",
              enableSorting: false,
              cell: ({ row }) => (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = row.original;
                      setDraft({ id: r.id, provider: r.provider, form_ref: r.form_ref ?? "", source_field: r.source_field, target_field: r.target_field as Target, version: r.version });
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={(e) => { e.stopPropagation(); remove.run(row.original.id); }}>
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                </div>
              ),
            } as ColumnDef<FieldMappingRow, unknown>,
          ]
        : []),
    ],
    [canEdit, remove],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Provider questions are mapped to canonical lead fields by version, so a form can change without rewriting history. A question with no
        mapping is <span className="font-medium text-foreground">kept in the raw payload and reported as unmapped</span> rather than dropped.
      </p>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        searchable
        searchPlaceholder="Filter mappings…"
        emptyTitle="No field mappings"
        emptyDescription="Without mappings the connectors fall back to name-matching heuristics."
        toolbar={canEdit ? <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft(EMPTY)}><Plus className="size-3.5" aria-hidden /> Add mapping</Button> : undefined}
      />

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit mapping" : "Add mapping"}</DialogTitle>
            <DialogDescription>Map one provider question onto a canonical lead field.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider" required>
                <SimpleSelect value={draft.provider} onChange={(v) => setDraft({ ...draft, provider: v })} options={PROVIDERS.map((p) => ({ value: p, label: p }))} allowNone={false} />
              </Field>
              <Field label="Form reference" hint="Leave empty to apply to every form">
                <Input value={draft.form_ref} onChange={(e) => setDraft({ ...draft, form_ref: e.target.value })} className="h-8 text-sm" />
              </Field>
              <Field label="Provider question" required>
                <Input value={draft.source_field} onChange={(e) => setDraft({ ...draft, source_field: e.target.value })} className="h-8 font-mono text-sm" placeholder="full_name" />
              </Field>
              <Field label="Canonical field" required>
                <SimpleSelect value={draft.target_field} onChange={(v) => setDraft({ ...draft, target_field: v as Target })} options={TARGETS.map((t) => ({ value: t, label: t }))} allowNone={false} />
              </Field>
              <Field label="Version">
                <Input type="number" min={1} value={draft.version} onChange={(e) => setDraft({ ...draft, version: Number(e.target.value) || 1 })} className="h-8 w-24 text-sm" />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={upsert.pending || !draft?.source_field.trim()} onClick={() => draft && upsert.run(draft)}>
              {upsert.pending ? "Saving…" : "Save mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
