"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/patterns/field";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { EmptyState } from "@/components/patterns/states";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { EvidenceViewer } from "@/features/sources/components/evidence-viewer";
import { CONFLICT_LABEL, ITEM_TYPE, REVIEW_ITEM_STATUS, confidenceLabel, confidenceTone } from "@/features/sources/status-maps";
import { CORRECTABLE_FIELDS } from "@/features/sources/schema";
import { approveReviewItemAction, rejectReviewItemAction } from "@/server/commands/sources";
import type { ExtractedFieldRow, ReviewItemRow } from "@/server/queries/sources";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  items: ReviewItemRow[];
  assets: { id: string; name: string }[];
  duplicates: Record<string, { id: string; name: string; code: string | null }>;
  canApprove: boolean;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ReviewClient({ items, assets, duplicates, canApprove }: Props) {
  const router = useRouter();
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("pending"));
  const [asset, setAsset] = useQueryState("asset", parseAsString.withDefault(""));
  const [itemType, setItemType] = useQueryState("type", parseAsString.withDefault(""));
  const [confidence, setConfidence] = useQueryState("confidence", parseAsString.withDefault(""));
  const [conflicts, setConflicts] = useQueryState("conflicts", parseAsString.withDefault(""));
  const [current, setCurrent] = useQueryState("item", parseAsString);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [published, setPublished] = useState<{ price: boolean; productId: string | null } | null>(null);

  const index = Math.max(0, items.findIndex((i) => i.id === current));
  const item: ReviewItemRow | undefined = items[index] ?? items[0];
  const itemId = item?.id;

  // Reset the working copy whenever the selected item changes — done during
  // render rather than in an effect so there is no cascading render.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (itemId && itemId !== loadedFor) {
    setLoadedFor(itemId);
    const base: Record<string, string> = {};
    for (const f of CORRECTABLE_FIELDS) base[f.key] = asText(item?.proposed?.[f.key]);
    setDraft(base);
    setNote("");
    setFocused(null);
  }

  const dirtyKeys = useMemo(() => {
    if (!item) return [] as string[];
    return CORRECTABLE_FIELDS.filter((f) => (draft[f.key] ?? "") !== asText(item.proposed?.[f.key])).map((f) => f.key);
  }, [draft, item]);

  const fieldByKey = useMemo(() => {
    const map = new Map<string, ExtractedFieldRow>();
    for (const f of item?.fields ?? []) map.set(f.key, f);
    return map;
  }, [item]);

  const go = useCallback(
    (delta: number) => {
      const next = items[index + delta];
      if (next) setCurrent(next.id);
    },
    [index, items, setCurrent],
  );

  const approve = useCallback(async () => {
    if (!item || !canApprove) return;
    setPending("approve");
    const corrections: Record<string, string> = {};
    for (const k of dirtyKeys) corrections[k] = draft[k];
    const res = await approveReviewItemAction({ review_item_id: item.id, corrections: Object.keys(corrections).length ? corrections : undefined, note: note || undefined });
    setPending(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Published");
    setPublished({ price: Boolean(res.data.price_id), productId: res.data.product_id });
    const next = items[index + 1];
    if (next) setCurrent(next.id);
    router.refresh();
  }, [canApprove, dirtyKeys, draft, index, item, items, note, router, setCurrent]);

  const reject = useCallback(async () => {
    if (!item) return;
    setPending("reject");
    const res = await rejectReviewItemAction({ review_item_id: item.id, reason });
    setPending(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Rejected");
    setRejecting(false);
    setReason("");
    const next = items[index + 1];
    if (next) setCurrent(next.id);
    router.refresh();
  }, [index, item, items, reason, router, setCurrent]);

  // Keyboard: a approve, r reject, j/k or arrows to move.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "a" && canApprove && item?.status === "pending") {
        e.preventDefault();
        void approve();
      } else if (e.key === "r" && canApprove && item?.status === "pending") {
        e.preventDefault();
        setRejecting(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [approve, canApprove, go, item?.status]);

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <SimpleSelect
        value={status}
        onChange={(v) => {
          setStatus(v || null);
          setCurrent(null);
        }}
        options={Object.entries(REVIEW_ITEM_STATUS).map(([value, meta]) => ({ value, label: meta.label }))}
        placeholder="Any status"
        noneLabel="Any status"
        className="h-8 w-44 text-sm"
      />
      <SimpleSelect value={asset} onChange={(v) => setAsset(v || null)} options={assets.map((a) => ({ value: a.id, label: a.name }))} placeholder="Any source" noneLabel="Any source" className="h-8 w-52 text-sm" />
      <SimpleSelect
        value={itemType}
        onChange={(v) => setItemType(v || null)}
        options={[
          { value: "price", label: "Price" },
          { value: "product", label: "Product" },
        ]}
        placeholder="Any type"
        noneLabel="Any type"
        className="h-8 w-32 text-sm"
      />
      <SimpleSelect
        value={confidence}
        onChange={(v) => setConfidence(v || null)}
        options={[
          { value: "low", label: "Below 80%" },
          { value: "medium", label: "80–95%" },
          { value: "high", label: "95%+" },
        ]}
        placeholder="Any confidence"
        noneLabel="Any confidence"
        className="h-8 w-40 text-sm"
      />
      <Button size="sm" variant={conflicts === "1" ? "default" : "outline"} className="h-8" onClick={() => setConflicts(conflicts === "1" ? null : "1")}>
        Conflicts only
      </Button>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        {filters}
        <EmptyState
          title="Nothing to review"
          description="Extraction stages every row here before it can reach the catalog or a price list. Import a source document to fill this queue."
          action={{ label: "Open the Source Library", href: "/sources/library" }}
        />
      </div>
    );
  }

  if (!item) return null;
  const isPending = item.status === "pending";
  const dupCode = item.conflicts.find((c) => c.code === "duplicate_product") ? asText(item.proposed?.code).toLowerCase() : null;
  const dupProduct = dupCode ? duplicates[dupCode] : undefined;

  return (
    <div className="space-y-3">
      {filters}

      {published && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-success/30 bg-success/10 px-3 py-2">
          <p className="text-sm">
            {published.price
              ? "Published as a draft price. Prices go live through the price list so the overlap rule and its override are enforced in one place."
              : "Published to the catalog."}
          </p>
          <div className="flex gap-2">
            {published.price && (
              <Button asChild size="sm" variant="outline">
                <Link href="/merchandise/pricing">
                  Publish on the price list <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            )}
            {!published.price && published.productId && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/merchandise/catalog/${published.productId}`}>Open the product</Link>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPublished(null)} aria-label="Dismiss">
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {/* Queue position + keyboard legend */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="size-7" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous item">
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="tnum text-sm">
            {index + 1} <span className="text-muted-foreground">of {items.length}</span>
          </span>
          <Button size="icon" variant="outline" className="size-7" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next item">
            <ChevronRight className="size-3.5" />
          </Button>
          <div className="ml-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full bg-brand" style={{ width: `${((index + 1) / items.length) * 100}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Kbd>a</Kbd> approve <Kbd>r</Kbd> reject <Kbd>j</Kbd>/<Kbd>k</Kbd> move
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="min-h-96 p-3">
          <EvidenceViewer item={item} focusedField={focused ? (fieldByKey.get(focused) ?? null) : null} />
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill map={ITEM_TYPE} value={item.item_type} />
              <StatusPill map={REVIEW_ITEM_STATUS} value={item.status} />
              <TonePill tone={confidenceTone(item.confidence)} label={`Confidence ${confidenceLabel(item.confidence)}`} />
            </div>
            <span className="text-[11px] text-muted-foreground">{item.parser_version ?? item.job_type ?? "parser"}</span>
          </div>

          {item.conflicts.length > 0 && (
            <ul className="space-y-1.5">
              {item.conflicts.map((c, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{CONFLICT_LABEL[c.code] ?? c.code}</span>
                    {c.detail && c.detail !== (CONFLICT_LABEL[c.code] ?? c.code) && <span className="block text-[11px] opacity-90">{c.detail}</span>}
                    {c.code === "duplicate_product" && dupProduct && (
                      <Link href={`/merchandise/catalog/${dupProduct.id}`} className="mt-0.5 inline-flex items-center gap-1 text-[11px] underline underline-offset-2">
                        Open {dupProduct.code ?? dupProduct.name} <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-3">
            {CORRECTABLE_FIELDS.map((f) => {
              const ext = fieldByKey.get(f.key);
              const changed = dirtyKeys.includes(f.key);
              const low = ext?.confidence != null && ext.confidence < 0.8;
              return (
                <div key={f.key} className={cn("rounded-md border px-2.5 py-2", low && "border-destructive/30 bg-destructive/5", changed && "border-brand/50 bg-brand/5")}>
                  <Field
                    label={f.label}
                    htmlFor={`f-${f.key}`}
                    hint={ext?.source_text ? `Read from: ${ext.source_text}` : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        id={`f-${f.key}`}
                        value={draft[f.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        onFocus={() => setFocused(f.key)}
                        disabled={!isPending || !canApprove}
                        className="h-8 text-sm"
                      />
                      {ext?.confidence != null && <TonePill tone={confidenceTone(ext.confidence)} label={confidenceLabel(ext.confidence)} />}
                      {changed && <TonePill tone="ai" label="Edited" />}
                    </div>
                  </Field>
                </div>
              );
            })}

            {Boolean(item.proposed?.dimensions) && (
              <p className="text-[11px] text-muted-foreground">
                Dimensions read: <span className="font-mono">{asText(item.proposed.dimensions)}</span>
              </p>
            )}
          </div>

          {isPending && canApprove && (
            <Field label="Decision note" htmlFor="review-note" hint="Optional. Kept with the audit event.">
              <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-sm" />
            </Field>
          )}

          {!isPending && (
            <p className="rounded-md border bg-muted/40 px-2.5 py-2 text-sm text-muted-foreground">
              {item.reviewed_by_name ?? "Someone"} {item.status === "rejected" ? "rejected" : "published"} this on {formatDateTime(item.reviewed_at)}.
              {item.decision_note ? ` “${item.decision_note}”` : ""}
            </p>
          )}

          {isPending && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button onClick={approve} disabled={!canApprove || pending !== null}>
                {pending === "approve" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                {dirtyKeys.length > 0 ? `Correct & approve (${dirtyKeys.length})` : "Approve"}
              </Button>
              <Button variant="outline" onClick={() => setRejecting(true)} disabled={!canApprove || pending !== null}>
                <X className="size-4" aria-hidden /> Reject
              </Button>
              {!canApprove && <span className="text-[11px] text-muted-foreground">Approving needs the review permission.</span>}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this row</DialogTitle>
            <DialogDescription>The row stays as evidence and the reason is kept as parser feedback. Nothing is deleted.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="reject-reason" required>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. the price column was misread; this is the carton price, not per sheet" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={reject} disabled={reason.trim().length < 3 || pending !== null}>
              {pending === "reject" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Reject row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
