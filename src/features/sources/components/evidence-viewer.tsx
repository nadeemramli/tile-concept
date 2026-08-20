"use client";

import { useEffect, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/states";
import { signedSourceUrlAction } from "@/server/commands/sources";
import type { ExtractedFieldRow, ReviewItemRow } from "@/server/queries/sources";
import { cn } from "@/lib/utils";

/**
 * The left half of the review screen: the document as it actually is.
 * A reviewer compares the proposal against this, so a missing original is
 * stated plainly rather than shown as a broken frame.
 */
export function EvidenceViewer({ item, focusedField }: { item: ReviewItemRow; focusedField: ExtractedFieldRow | null }) {
  const path = item.storage_path;
  const bucket = item.storage_bucket ?? "source-assets";
  const isViewable = item.source_kind === "pdf" || item.source_kind === "image";

  const [signed, setSigned] = useState<{ state: "idle" | "loading" | "ready" | "missing"; url: string | null }>(() => ({
    state: isViewable && path ? "loading" : "idle",
    url: null,
  }));
  // Reset when the selected item changes — adjusted during render, so the
  // fetch below is the only thing the effect does.
  const [loadedPath, setLoadedPath] = useState<string | null>(path);
  if (path !== loadedPath) {
    setLoadedPath(path);
    setSigned({ state: isViewable && path ? "loading" : "idle", url: null });
  }

  useEffect(() => {
    if (!isViewable || !path) return;
    let cancelled = false;
    signedSourceUrlAction({ bucket, path }).then((res) => {
      if (cancelled) return;
      setSigned(res.ok && res.data.url ? { state: "ready", url: res.data.url } : { state: "missing", url: null });
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path, isViewable]);

  const state = signed.state;
  const url = signed.url;

  const region = focusedField?.region as { x?: number; y?: number; w?: number; h?: number; page?: number; line?: number; ref?: string; sheet?: string } | null;
  const hasBox = Boolean(region && region.x !== undefined && region.y !== undefined);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{item.source_name ?? "Source"}</h2>
        <span className="text-[11px] text-muted-foreground">
          {item.supplier_name ? `${item.supplier_name} · ` : ""}
          {item.page_no ? `page ${item.page_no}` : ""}
          {item.row_no ? `${item.page_no ? " · " : ""}row ${item.row_no}` : ""}
        </span>
      </div>

      {/* Raw row — always available, and the only evidence for spreadsheets. */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">As read from the document</div>
        {Object.keys(item.raw).length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No raw row was captured for this item.</p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 text-xs">Column</TableHead>
                  <TableHead className="h-8 text-xs">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(item.raw).map(([k, v]) => {
                  const highlighted = focusedField?.source_text != null && String(v).trim() === String(focusedField.source_text).trim();
                  return (
                    <TableRow key={k} className={cn(highlighted && "bg-brand/10")}>
                      <TableCell className="py-1.5 align-top text-[12px] text-muted-foreground">{k}</TableCell>
                      <TableCell className="py-1.5 font-mono text-[12px]">{String(v)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {focusedField?.source_text && (
        <div className="rounded-lg border border-brand/40 bg-brand/5 px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Source text for {focusedField.key}
            {region?.ref ? ` · ${region.sheet ? `${region.sheet}!` : ""}${region.ref}` : region?.line !== undefined ? ` · line ${region.line + 1}` : ""}
          </div>
          <p className="mt-0.5 break-words font-mono text-[12px]">{focusedField.source_text}</p>
        </div>
      )}

      {isViewable && (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/30">
          {state === "loading" && (
            <div className="flex h-full items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Fetching the original…
            </div>
          )}
          {state === "missing" && (
            <EmptyState
              icon={FileWarning}
              title="The original is not available in this demo workspace"
              description="The record points at a stored file that was never uploaded here. The raw row above is still the evidence for this proposal."
              className="border-0"
            />
          )}
          {state === "ready" && url && (
            <div className="relative h-full min-h-80">
              {item.source_kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={`Source page for ${item.source_name ?? "document"}`} className="h-full w-full object-contain" />
              ) : (
                <embed src={`${url}#page=${item.page_no ?? 1}&toolbar=0`} type="application/pdf" className="h-full min-h-80 w-full" />
              )}
              {hasBox && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute rounded border-2 border-brand bg-brand/20"
                  style={{ left: region!.x, top: region!.y, width: region!.w ?? 80, height: region!.h ?? 18 }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {!isViewable && (
        <p className="text-[11px] text-muted-foreground">
          Spreadsheet sources have no page image; the row above is the evidence, with the exact cell reference on each field.
        </p>
      )}
    </div>
  );
}
