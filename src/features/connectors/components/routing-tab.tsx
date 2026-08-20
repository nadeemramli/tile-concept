"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2 } from "lucide-react";
import { DataTable } from "@/components/patterns/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/patterns/field";
import { TonePill } from "@/components/patterns/status-pill";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/features/catalog/use-action";
import { deleteRoutingRuleAction, upsertRoutingRuleAction } from "@/server/commands/connectors";
import type { RoutingRuleRow } from "@/server/queries/connectors";

const CHANNELS = ["tiktok", "meta", "website", "whatsapp", "dm", "call", "email", "referral", "walk_in", "other"];
const INTERESTS = ["wall_panel", "tile", "cut_tile", "mosaic", "finishing", "accessory"];

type Draft = { id?: string; position: number; match_source_channel: string; match_product_interest: string; assign_to: string; is_active: boolean };

const EMPTY: Draft = { position: 100, match_source_channel: "", match_product_interest: "", assign_to: "", is_active: true };

export function RoutingTab({ rows, members, canEdit }: { rows: RoutingRuleRow[]; members: { user_id: string; full_name: string }[]; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const upsert = useAction(upsertRoutingRuleAction, { onSuccess: () => setDraft(null) });
  const remove = useAction(deleteRoutingRuleAction);

  const columns = useMemo<ColumnDef<RoutingRuleRow, unknown>[]>(
    () => [
      { accessorKey: "position", header: "Order", cell: ({ row }) => <span className="tnum">{row.original.position}</span> },
      {
        id: "match",
        header: "Matches",
        accessorFn: (r) => `${r.match_source_channel ?? ""} ${r.match_product_interest ?? ""}`,
        cell: ({ row }) => {
          const r = row.original;
          if (!r.match_source_channel && !r.match_product_interest) return <span className="text-muted-foreground">Everything</span>;
          return (
            <span className="flex flex-wrap gap-1">
              {r.match_source_channel && <span className="rounded border bg-muted/50 px-1.5 py-0.5 text-[11px]">source: {r.match_source_channel}</span>}
              {r.match_product_interest && <span className="rounded border bg-muted/50 px-1.5 py-0.5 text-[11px]">interest: {r.match_product_interest}</span>}
            </span>
          );
        },
      },
      { accessorKey: "assign_to_name", header: "Assigns to", cell: ({ row }) => row.original.assign_to_name ?? <span className="text-muted-foreground">Leaves unassigned</span> },
      { id: "active", header: "Active", accessorFn: (r) => r.is_active, cell: ({ row }) => <TonePill tone={row.original.is_active ? "success" : "neutral"} label={row.original.is_active ? "Active" : "Off"} /> },
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
                      setDraft({
                        id: r.id,
                        position: r.position,
                        match_source_channel: r.match_source_channel ?? "",
                        match_product_interest: r.match_product_interest ?? "",
                        assign_to: r.assign_to ?? "",
                        is_active: r.is_active,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={(e) => { e.stopPropagation(); remove.run(row.original.id); }}>
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                </div>
              ),
            } as ColumnDef<RoutingRuleRow, unknown>,
          ]
        : []),
    ],
    [canEdit, remove],
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Rules are evaluated in order and <span className="font-medium text-foreground">the first match wins</span>. A submission matching no rule stays
        unassigned and appears in the inbox&rsquo;s Unassigned view — which is a queue, not a failure.
      </p>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        initialSorting={[{ id: "position", desc: false }]}
        emptyTitle="No routing rules"
        emptyDescription="Every inbound submission will arrive unassigned until a rule exists."
        toolbar={canEdit ? <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft(EMPTY)}><Plus className="size-3.5" aria-hidden /> Add rule</Button> : undefined}
      />

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit rule" : "Add rule"}</DialogTitle>
            <DialogDescription>Leave a match field empty to match anything.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Order" hint="Lower runs first">
                <Input type="number" min={1} value={draft.position} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) || 100 })} className="h-8 w-24 text-sm" />
              </Field>
              <Field label="Assign to">
                <SimpleSelect value={draft.assign_to} onChange={(v) => setDraft({ ...draft, assign_to: v })} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} noneLabel="Leave unassigned" />
              </Field>
              <Field label="Source channel">
                <SimpleSelect value={draft.match_source_channel} onChange={(v) => setDraft({ ...draft, match_source_channel: v })} options={CHANNELS.map((c) => ({ value: c, label: c }))} noneLabel="Any channel" />
              </Field>
              <Field label="Product interest">
                <SimpleSelect value={draft.match_product_interest} onChange={(v) => setDraft({ ...draft, match_product_interest: v })} options={INTERESTS.map((c) => ({ value: c, label: c.replace("_", " ") }))} noneLabel="Any interest" />
              </Field>
              <Field label="Active" className="sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
                  <span className="text-sm text-muted-foreground">{draft.is_active ? "Rule is evaluated" : "Rule is skipped"}</span>
                </div>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={upsert.pending} onClick={() => draft && upsert.run(draft)}>{upsert.pending ? "Saving…" : "Save rule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
