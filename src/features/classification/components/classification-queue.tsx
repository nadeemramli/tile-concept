"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/patterns/data-table";
import { StatusPill } from "@/components/patterns/status-pill";
import { CLASSIFICATION_BASIS, CLASSIFICATION_STATE } from "@/lib/domain/status-maps";
import { formatDate } from "@/lib/format";
import { DIMENSION_LABEL, missingDimensions, optionLabel, type ClassificationDimension } from "@/features/classification/taxonomy";
import type { ClassificationQueueRow } from "@/server/queries/classification";

const columns: ColumnDef<ClassificationQueueRow, unknown>[] = [
  {
    accessorKey: "title",
    header: "Pursuit",
    meta: { hint: "Opens the inquiry or opportunity where the classification is corrected." },
    cell: ({ row }) => (
      <Link href={row.original.href} className="font-medium hover:underline" data-testid="classification-queue-link">
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "subject_type",
    header: "Record",
    meta: { hint: "An inquiry that has not become an opportunity, or an opportunity (with its inquiry, if any). Each pursuit is listed once." },
    cell: ({ getValue }) => (getValue<string>() === "opportunity" ? "Opportunity" : "Inquiry"),
  },
  { accessorKey: "state", header: "State", meta: { hint: "Why the pursuit is listed." }, cell: ({ getValue }) => <StatusPill map={CLASSIFICATION_STATE} value={getValue<string>()} /> },
  {
    id: "needs",
    header: "Needs",
    meta: { hint: "The values still Unknown, or the conflicting source and what it said." },
    cell: ({ row }) => {
      const r = row.original;
      if (r.conflict)
        return Object.entries(r.conflict)
          .map(([d, c]) => `${DIMENSION_LABEL[d as ClassificationDimension] ?? d}: ${optionLabel(d as ClassificationDimension, c.recorded)} vs ${optionLabel(d as ClassificationDimension, c.proposed)}`)
          .join("; ");
      const missing = missingDimensions(r.values);
      return missing.length ? missing.map((d) => DIMENSION_LABEL[d]).join(", ") : "—";
    },
  },
  { accessorKey: "basis", header: "Basis", meta: { hint: "How the current classification was last set." }, cell: ({ getValue }) => <StatusPill map={CLASSIFICATION_BASIS} value={getValue<string>()} /> },
  { accessorKey: "owner_name", header: "Owner", cell: ({ getValue }) => getValue<string | null>() ?? "Unassigned" },
  { accessorKey: "arrived_at", header: "Arrived", meta: { hint: "When the inquiry arrived, or when the opportunity was opened if it had no inquiry." }, cell: ({ getValue }) => formatDate(getValue<string>()) },
];

export function ClassificationQueue({ rows }: { rows: ClassificationQueueRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => `${r.subject_type}:${r.subject_id}`}
      searchable
      searchPlaceholder="Filter pursuits…"
      emptyTitle="Nothing to review"
      emptyDescription="Every pursuit in your view past qualification is classified, and no source conflicts are waiting."
    />
  );
}
