"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { TonePill } from "@/components/patterns/status-pill";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import { AVAILABILITY_STATUS, CHANNEL_LABEL } from "@/features/stock/status";
import { AVAILABILITY_STATES, NUMERIC_STATES, SOURCE_CHANNELS, type AvailabilityStateInput } from "@/features/stock/schema";
import { recordSupplierAvailabilityAction } from "@/server/commands/stock";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useSession } from "@/components/shell/session-context";
import { VariantCombobox } from "@/features/stock/components/variant-combobox";
import type { VariantOption } from "@/features/stock/components/variant-combobox";

interface Props {
  suppliers: { id: string; name: string }[];
  variants: VariantOption[];
  units: { id: string; code: string; label: string }[];
  defaultSupplierId?: string;
}

interface RecordedLine {
  id: string;
  label: string;
  state: AvailabilityStateInput;
  quantity: string;
}

/**
 * Quick entry is the way most supplier stock actually arrives: someone calls,
 * someone answers. The form stays open, clears itself, and keeps a running
 * list so a whole call can be logged without leaving the keyboard.
 */
export function QuickEntry({ suppliers, variants, units, defaultSupplierId }: Props) {
  const { session } = useSession();
  const empty = {
    supplier_id: defaultSupplierId ?? suppliers[0]?.id ?? "",
    variant_id: "",
    availability: "available" as AvailabilityStateInput,
    quantity: "",
    unit_id: "",
    expected_replenishment: "",
    source_channel: "call" as (typeof SOURCE_CHANNELS)[number],
    notes: "",
  };
  const [f, setF] = useState(empty);
  const [evidence, setEvidence] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<RecordedLine[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const variantRef = useRef<HTMLButtonElement>(null);

  const numeric = NUMERIC_STATES.includes(f.availability);

  const record = useAction(recordSupplierAvailabilityAction, {
    onSuccess: (data) => {
      const v = variants.find((x) => x.id === f.variant_id);
      setRecorded((prev) => [{ id: data.id, label: v?.label ?? "Product", state: f.availability, quantity: numeric ? f.quantity : "" }, ...prev].slice(0, 12));
      // Keep the supplier and channel — the next line is usually the same call.
      setF((prev) => ({ ...empty, supplier_id: prev.supplier_id, source_channel: prev.source_channel }));
      setEvidence(null);
      if (fileRef.current) fileRef.current.value = "";
      variantRef.current?.focus();
    },
    silent: true,
  });

  async function uploadEvidence(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = getBrowserSupabase();
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = `${session.workspaceId}/supplier-evidence/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("source-assets").upload(path, file, { upsert: false });
      if (error) setUploadError(error.message);
      else setEvidence({ path, name: file.name });
    } finally {
      setUploading(false);
    }
  }

  const submit = () =>
    record.run({
      supplier_id: f.supplier_id,
      availability: f.availability,
      variant_id: f.variant_id,
      quantity: numeric ? f.quantity : "",
      unit_id: f.unit_id,
      expected_replenishment: f.expected_replenishment,
      source_channel: f.source_channel,
      evidence_storage_path: evidence?.path ?? "",
      notes: f.notes,
    });

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Record a supplier update</h3>
        <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to save</span>
      </div>

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !record.pending) submit();
        }}
      >
        <Field label="Supplier" required error={fieldError(record.fieldErrors, "supplier_id")}>
          <SimpleSelect value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} allowNone={false} />
        </Field>

        <Field label="Product" required error={fieldError(record.fieldErrors, "variant_id")} className="lg:col-span-2">
          <VariantCombobox ref={variantRef} variants={variants} value={f.variant_id} onChange={(v) => setF({ ...f, variant_id: v })} />
        </Field>

        <Field label="Availability" required>
          <div className="flex flex-wrap gap-1">
            {AVAILABILITY_STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setF({ ...f, availability: s, quantity: NUMERIC_STATES.includes(s) ? f.quantity : "" })}
                aria-pressed={f.availability === s}
                className={`rounded-md border px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${f.availability === s ? "border-primary bg-accent font-medium" : "border-border text-muted-foreground hover:bg-accent/50"}`}
              >
                {AVAILABILITY_STATUS[s]?.label ?? s}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Quantity" hint={numeric ? "Optional" : "Only available or low carries a quantity"} error={fieldError(record.fieldErrors, "quantity")}>
          <Input type="number" inputMode="decimal" step="0.01" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} disabled={!numeric} className="tnum" />
        </Field>

        <Field label="Unit">
          <SimpleSelect value={f.unit_id} onChange={(v) => setF({ ...f, unit_id: v })} options={units.map((u) => ({ value: u.id, label: `${u.code} · ${u.label}` }))} disabled={!numeric} />
        </Field>

        <Field label="Expected replenishment">
          <Input type="date" value={f.expected_replenishment} onChange={(e) => setF({ ...f, expected_replenishment: e.target.value })} />
        </Field>

        <Field label="How did you hear this?" required>
          <SimpleSelect value={f.source_channel} onChange={(v) => setF({ ...f, source_channel: v as (typeof SOURCE_CHANNELS)[number] })} options={SOURCE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] ?? c }))} allowNone={false} />
        </Field>

        <Field label="Evidence" hint="A screenshot is evidence of a conversation — never trusted as structured stock.">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadEvidence(file);
              }}
            />
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Paperclip className="size-3.5" aria-hidden />}
              {evidence ? "Replace" : "Attach"}
            </Button>
            {evidence && (
              <span className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
                {evidence.name}
                <button type="button" onClick={() => setEvidence(null)} aria-label="Remove evidence" className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            )}
          </div>
        </Field>

        <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Lead time, who confirmed it, anything the next person needs." />
        </Field>
      </div>

      {uploadError && <p className="text-xs text-destructive">Evidence upload failed: {uploadError}</p>}
      {record.error && <p className="text-sm text-destructive">{record.error}</p>}

      <div className="flex items-center justify-between gap-2">
        <Button size="sm" onClick={submit} disabled={record.pending || !f.supplier_id || !f.variant_id}>
          {record.pending ? "Saving…" : "Record update"}
        </Button>
        {recorded.length > 0 && <span className="text-xs text-muted-foreground">{recorded.length} recorded this session</span>}
      </div>

      {recorded.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {recorded.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <Check className="size-3 shrink-0 text-success" aria-hidden />
              <span className="truncate">{r.label}</span>
              <TonePill tone={AVAILABILITY_STATUS[r.state]?.tone ?? "neutral"} label={AVAILABILITY_STATUS[r.state]?.label ?? r.state} />
              {r.quantity && <span className="tnum text-muted-foreground">{r.quantity}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
