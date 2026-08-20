"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { Field } from "@/components/patterns/field";
import { CASE_STATUS } from "@/features/stock/status";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { VariantCombobox, type VariantOption } from "@/features/stock/components/variant-combobox";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { openReconciliationCaseAction, resolveReconciliationCaseAction } from "@/server/commands/stock";
import { useSession } from "@/components/shell/session-context";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ReconciliationRow } from "@/server/queries/stock";

interface Props {
  cases: ReconciliationRow[];
  sources: { id: string; name: string }[];
  variants: VariantOption[];
}

export function ReconciliationTab({ cases, sources, variants }: Props) {
  const { can } = useSession();
  const canWrite = can("stock.write");
  const [opening, setOpening] = useState(false);
  const [resolving, setResolving] = useState<ReconciliationRow | null>(null);
  const [newCase, setNewCase] = useState({ variant_id: "", source_id: sources[0]?.id ?? "", expected: "", observed: "", notes: "" });
  const [resolution, setResolution] = useState({ status: "resolved", notes: "" });

  const open = useAction(openReconciliationCaseAction, { onSuccess: () => setOpening(false) });
  const resolve = useAction(resolveReconciliationCaseAction, { onSuccess: () => setResolving(null) });

  const columns = useMemo<ColumnDef<ReconciliationRow, unknown>[]>(
    () => [
      { accessorKey: "variant_label", header: "Product", cell: ({ row }) => row.original.variant_label ?? "—" },
      { accessorKey: "source_name", header: "Source", cell: ({ row }) => row.original.source_name ?? "—" },
      { accessorKey: "expected", header: "Expected", cell: ({ row }) => <span className="tnum">{formatNumber(row.original.expected, 2)}</span> },
      { accessorKey: "observed", header: "Observed", cell: ({ row }) => <span className="tnum">{formatNumber(row.original.observed, 2)}</span> },
      {
        accessorKey: "variance",
        header: "Variance",
        cell: ({ row }) => {
          const v = row.original.variance;
          if (v === null) return <span className="text-muted-foreground">—</span>;
          return <span className={`tnum font-medium ${v === 0 ? "" : v < 0 ? "text-destructive" : "text-warning"}`}>{v > 0 ? `+${formatNumber(v, 2)}` : formatNumber(v, 2)}</span>;
        },
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill map={CASE_STATUS} value={row.original.status} /> },
      { accessorKey: "notes", header: "Notes", cell: ({ row }) => <span className="text-muted-foreground">{row.original.notes ?? "—"}</span> },
      { accessorKey: "opened_at", header: "Opened", cell: ({ row }) => <span className="tnum">{formatDateTime(row.original.opened_at)}</span> },
      { accessorKey: "resolved_at", header: "Resolved", cell: ({ row }) => <span className="tnum">{row.original.resolved_at ? formatDateTime(row.original.resolved_at) : "—"}</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) =>
          canWrite && row.original.status !== "resolved" && row.original.status !== "accepted" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setResolution({ status: "resolved", notes: "" });
                setResolving(row.original);
              }}
            >
              Update
            </Button>
          ) : null,
      },
    ],
    [canWrite],
  );

  return (
    <div className="space-y-4">
      <Card className="flex-row items-start gap-2 p-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <p className="text-xs text-muted-foreground">
          A case records that two sources disagree — the app never edits SQL Account to make the difference go away. Resolving one is a note about what was found, not a correction to the authority.
        </p>
      </Card>

      {canWrite && (
        <div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpening(true)}>
            <Plus className="size-3.5" aria-hidden /> Open a case
          </Button>
        </div>
      )}

      <DataTable columns={columns} data={cases} rowKey={(r) => r.id} emptyTitle="No discrepancies recorded" emptyDescription="Open a case when a physical count or an app-linked figure disagrees with the source." pageSize={25} />

      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Open a reconciliation case</DialogTitle>
            <DialogDescription>Record the disagreement and what each side says. Nothing is written back to the source system.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product" required error={fieldError(open.fieldErrors, "variant_id")} className="sm:col-span-2">
              <VariantCombobox variants={variants} value={newCase.variant_id} onChange={(v) => setNewCase({ ...newCase, variant_id: v })} />
            </Field>
            <Field label="Source" required error={fieldError(open.fieldErrors, "source_id")}>
              <SimpleSelect value={newCase.source_id} onChange={(v) => setNewCase({ ...newCase, source_id: v })} options={sources.map((s) => ({ value: s.id, label: s.name }))} allowNone={false} />
            </Field>
            <div />
            <Field label="Expected (source says)" required error={fieldError(open.fieldErrors, "expected")}>
              <Input type="number" step="0.01" inputMode="decimal" value={newCase.expected} onChange={(e) => setNewCase({ ...newCase, expected: e.target.value })} className="tnum" />
            </Field>
            <Field label="Observed (we counted)" required error={fieldError(open.fieldErrors, "observed")}>
              <Input type="number" step="0.01" inputMode="decimal" value={newCase.observed} onChange={(e) => setNewCase({ ...newCase, observed: e.target.value })} className="tnum" />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea rows={3} value={newCase.notes} onChange={(e) => setNewCase({ ...newCase, notes: e.target.value })} placeholder="Who counted, where, and anything that might explain the gap." />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpening(false)}>
              Cancel
            </Button>
            <Button disabled={open.pending || !newCase.variant_id || !newCase.expected || !newCase.observed} onClick={() => open.run(newCase)}>
              {open.pending ? "Recording…" : "Record discrepancy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolving} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update case</DialogTitle>
            <DialogDescription>{resolving?.variant_label ?? "This case"} — record what was found. A note is required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Status" required>
              <SimpleSelect
                value={resolution.status}
                onChange={(v) => setResolution({ ...resolution, status: v })}
                options={[
                  { value: "investigating", label: "Investigating" },
                  { value: "resolved", label: "Resolved" },
                  { value: "accepted", label: "Accepted as-is" },
                ]}
                allowNone={false}
              />
            </Field>
            <Field label="What was found" required error={fieldError(resolve.fieldErrors, "notes")}>
              <Textarea rows={3} value={resolution.notes} onChange={(e) => setResolution({ ...resolution, notes: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button disabled={resolve.pending || resolution.notes.trim().length < 3} onClick={() => resolving && resolve.run({ case_id: resolving.id, status: resolution.status as "investigating" | "resolved" | "accepted", notes: resolution.notes })}>
              {resolve.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
