"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { TonePill } from "@/components/patterns/status-pill";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { AVAILABILITY_STATUS, CHANNEL_LABEL } from "@/features/stock/status";
import { AVAILABILITY_STATES, NUMERIC_STATES, SOURCE_CHANNELS, type AvailabilityStateInput } from "@/features/stock/schema";
import { recordSupplierAvailabilityAction } from "@/server/commands/stock";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { VariantOption } from "@/features/stock/components/variant-combobox";

interface Props {
  suppliers: { id: string; name: string }[];
  variants: VariantOption[];
  units: { id: string; code: string; label: string }[];
}

interface ParsedLine {
  line: number;
  code: string;
  state: string;
  quantity: string;
  unit: string;
  variant_id: string | null;
  variant_label: string | null;
  unit_id: string | null;
  problem: string | null;
}

const STATE_ALIASES: Record<string, AvailabilityStateInput> = {
  available: "available",
  yes: "available",
  in: "available",
  instock: "available",
  low: "low",
  limited: "low",
  out: "out",
  no: "out",
  none: "out",
  oos: "out",
  mto: "made_to_order",
  madetoorder: "made_to_order",
  order: "made_to_order",
  ask: "ask_supplier",
  asksupplier: "ask_supplier",
  check: "ask_supplier",
  unknown: "unknown",
};

function normaliseState(raw: string): AvailabilityStateInput | null {
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  return STATE_ALIASES[k] ?? (AVAILABILITY_STATES.includes(k as AvailabilityStateInput) ? (k as AvailabilityStateInput) : null);
}

/** Bulk entry for a supplier who sends a list rather than answering line by line. */
export function BulkEntry({ suppliers, variants, units }: Props) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [channel, setChannel] = useState<(typeof SOURCE_CHANNELS)[number]>("whatsapp");
  const [text, setText] = useState("");
  const [committing, startCommit] = useTransition();
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const byCode = useMemo(() => {
    const m = new Map<string, VariantOption>();
    for (const v of variants) {
      const key = v.code.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (key) m.set(key, v);
    }
    return m;
  }, [variants]);
  const unitByCode = useMemo(() => new Map(units.map((u) => [u.code.toLowerCase(), u])), [units]);

  const parsed: ParsedLine[] = useMemo(() => {
    if (!text.trim()) return [];
    const rows = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true }).data;
    return rows.map((cells, i) => {
      const [code = "", state = "", quantity = "", unit = ""] = cells.map((c) => (c ?? "").trim());
      const key = code.toLowerCase().replace(/[^a-z0-9]/g, "");
      const variant = key ? byCode.get(key) : undefined;
      const normalised = normaliseState(state);
      const u = unit ? unitByCode.get(unit.toLowerCase()) : undefined;
      let problem: string | null = null;
      if (!code) problem = "No product code";
      else if (!variant) problem = "No product matches this code";
      else if (!normalised) problem = `“${state}” is not an availability state`;
      else if (quantity && !NUMERIC_STATES.includes(normalised)) problem = `A quantity does not apply to ${AVAILABILITY_STATUS[normalised]?.label ?? normalised}`;
      else if (quantity && Number.isNaN(Number(quantity))) problem = "Quantity is not a number";
      else if (unit && !u) problem = `Unknown unit “${unit}”`;
      return {
        line: i + 1,
        code,
        state: normalised ?? state,
        quantity,
        unit,
        variant_id: variant?.id ?? null,
        variant_label: variant?.label ?? null,
        unit_id: u?.id ?? null,
        problem,
      };
    });
  }, [text, byCode, unitByCode]);

  const valid = parsed.filter((p) => !p.problem);
  const invalid = parsed.filter((p) => p.problem);

  function readFile(file: File) {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => setText(res.data.map((r) => r.join(", ")).join("\n")),
    });
  }

  function commit() {
    if (!supplierId || valid.length === 0) return;
    startCommit(async () => {
      let okCount = 0;
      let failed = 0;
      for (const row of valid) {
        const res = await recordSupplierAvailabilityAction({
          supplier_id: supplierId,
          availability: row.state as AvailabilityStateInput,
          variant_id: row.variant_id ?? "",
          quantity: row.quantity,
          unit_id: row.unit_id ?? "",
          source_channel: channel,
          notes: "Bulk entry",
        });
        if (res.ok) okCount += 1;
        else failed += 1;
      }
      setResult({ ok: okCount, failed });
      if (okCount) toast.success(`${okCount} supplier update${okCount === 1 ? "" : "s"} recorded`);
      if (failed) toast.error(`${failed} line${failed === 1 ? "" : "s"} could not be recorded`);
      setText("");
      router.refresh();
    });
  }

  return (
    <Card className="gap-3 p-4">
      <div>
        <h3 className="text-sm font-medium">Bulk entry</h3>
        <p className="text-xs text-muted-foreground">
          One line per product: <code className="font-mono">code, state, quantity, unit</code>. Quantity and unit are optional and only apply to available or low.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" required>
          <SimpleSelect value={supplierId} onChange={setSupplierId} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} allowNone={false} />
        </Field>
        <Field label="How did this arrive?" required>
          <SimpleSelect value={channel} onChange={(v) => setChannel(v as (typeof SOURCE_CHANNELS)[number])} options={SOURCE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] ?? c }))} allowNone={false} />
        </Field>
      </div>

      <Field label="Lines">
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"MW-HEX-WHT, available, 400, sheet\nSL-6060-GRY, out\nWP-OAK-160, ask"} className="font-mono text-[13px]" />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
          }}
        />
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" aria-hidden /> Load a CSV
        </Button>
        {parsed.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {valid.length} ready · {invalid.length} need attention
          </span>
        )}
      </div>

      {parsed.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Line</th>
                <th className="px-2 py-1.5 font-medium">Code</th>
                <th className="px-2 py-1.5 font-medium">Matched product</th>
                <th className="px-2 py-1.5 font-medium">State</th>
                <th className="px-2 py-1.5 font-medium">Qty</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((p) => (
                <tr key={p.line} className="border-t">
                  <td className="tnum px-2 py-1.5 text-muted-foreground">{p.line}</td>
                  <td className="px-2 py-1.5 font-mono text-[12px]">{p.code || "—"}</td>
                  <td className="px-2 py-1.5">{p.variant_label ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-2 py-1.5">{AVAILABILITY_STATUS[p.state] ? <TonePill tone={AVAILABILITY_STATUS[p.state].tone} label={AVAILABILITY_STATUS[p.state].label} /> : p.state || "—"}</td>
                  <td className="tnum px-2 py-1.5">{p.quantity || "—"}</td>
                  <td className="px-2 py-1.5">{p.problem ? <span className="text-destructive">{p.problem}</span> : <TonePill tone="success" label="Ready" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <p className="text-xs text-muted-foreground">
          Committed {result.ok} line{result.ok === 1 ? "" : "s"}
          {result.failed > 0 && `, ${result.failed} failed`}. Lines that needed attention were skipped, not guessed.
        </p>
      )}

      <div>
        <Button size="sm" onClick={commit} disabled={committing || valid.length === 0 || !supplierId}>
          {committing ? "Recording…" : `Record ${valid.length} line${valid.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Card>
  );
}
