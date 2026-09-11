"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Loader2, RefreshCw, Archive, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecordDrawer, DrawerSection, FactList } from "@/components/patterns/record-drawer";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import { EmptyState } from "@/components/patterns/states";
import { DisabledHint, Gated, InfoTip } from "@/components/patterns/explain";

const NO_ORIGINAL = "The original file is not stored in this workspace, so there is nothing to open or re-read. Web and manual sources, and demo data, have no stored file.";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ASSET_KIND, ASSET_STATUS, JOB_STATUS, formatBytes } from "@/features/sources/status-maps";
import type { SourceAssetDetail } from "@/server/queries/sources";
import { useAction } from "@/features/catalog/use-action";
import { archiveSourceAssetAction, parseSourceAssetAction, signedSourceUrlAction } from "@/server/commands/sources";
import { toast } from "sonner";

export function AssetDrawer({ detail, onClose }: { detail: SourceAssetDetail | null; onClose: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const reparse = useAction(parseSourceAssetAction);
  const archive = useAction(archiveSourceAssetAction, { onSuccess: onClose });

  if (!detail) return null;
  const { asset, versions, jobs } = detail;

  async function download() {
    if (!asset.storage_path) return;
    setDownloading(true);
    const res = await signedSourceUrlAction({ bucket: asset.storage_bucket ?? "source-assets", path: asset.storage_path });
    setDownloading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (!res.data.url) {
      toast.error("The original is not available in this demo workspace.");
      return;
    }
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={asset.name}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill map={ASSET_KIND} value={asset.kind} />
          <StatusPill map={ASSET_STATUS} value={asset.status} />
          {asset.pending_reviews > 0 && <TonePill tone="warning" label={`${asset.pending_reviews} to review`} hint="Parsed rows waiting in Imports & OCR Review. Nothing reaches the catalog until they are approved." />}
        </span>
      }
      actions={
        <>
          {asset.storage_path ? (
            <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
              {downloading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
              Original
            </Button>
          ) : (
            <DisabledHint reason={NO_ORIGINAL}>
              <Button size="sm" variant="outline" disabled>
                <Download className="size-3.5" aria-hidden /> Original
              </Button>
            </DisabledHint>
          )}
          {asset.storage_path ? (
            <Gated permission="source.import">
              <Button size="sm" variant="outline" onClick={() => reparse.run({ asset_id: asset.id })} disabled={reparse.pending}>
                {reparse.pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                Re-parse
              </Button>
            </Gated>
          ) : (
            <DisabledHint reason={NO_ORIGINAL}>
              <Button size="sm" variant="outline" disabled>
                <RefreshCw className="size-3.5" aria-hidden /> Re-parse
              </Button>
            </DisabledHint>
          )}
        </>
      }
    >
      <DrawerSection title="Source">
        <FactList
          items={[
            { label: "Supplier", value: asset.supplier_name ?? "—" },
            { label: "Brand", value: asset.brand_name ?? "—" },
            { label: "Received", value: asset.received_at ? `${formatDateTime(asset.received_at)} · ${formatRelative(asset.received_at)}` : "—" },
            { label: "Uploaded by", value: asset.uploaded_by_name ?? "—" },
            { label: "Size", value: formatBytes(asset.size_bytes) },
            { label: "Pages", value: asset.page_count ?? "—" },
            { label: "MIME type", value: asset.mime_type ?? "—", mono: true },
            { label: "Version", value: asset.version_no ?? 1 },
          ]}
        />
      </DrawerSection>

      <DrawerSection title="Provenance" action={<InfoTip label="Provenance" content="Proof of exactly which file was read. The fingerprint is a hash of the file contents: the same bytes always give the same fingerprint, so a re-upload of identical content is recognised and ignored." />}>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[11px] text-muted-foreground">Content fingerprint (SHA-256)</dt>
            <dd className="break-all font-mono text-[11px] tnum">{asset.checksum ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Storage path</dt>
            <dd className="break-all font-mono text-[11px]">{asset.storage_path ?? asset.url ?? "—"}</dd>
          </div>
        </dl>
        <p className="text-[11px] text-muted-foreground">Re-importing identical content is ignored; a changed file with the same name becomes a new version.</p>
      </DrawerSection>

      <DrawerSection title={`Versions (${versions.length})`}>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No version history recorded.</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                <span className="tnum font-medium">v{v.version_no}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{v.checksum}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{v.created_at ? formatRelative(v.created_at) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <DrawerSection title={`Import jobs (${jobs.length})`} action={<InfoTip label="Import jobs" content="Each parse run, newest first, with the parser version, how many attempts it took and any error. A failed job is retried; a dead-letter job needs a person to look at it." />}>
        {jobs.length === 0 ? (
          <EmptyState title="Not parsed yet" description="Run a parse to stage rows for review." className="py-6" />
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="space-y-1 rounded-md border px-2.5 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <StatusPill map={JOB_STATUS} value={j.status} />
                    <span className="text-[11px] text-muted-foreground">{j.job_type}</span>
                  </span>
                  <span className="tnum text-[11px] text-muted-foreground">
                    {j.parser_version ?? "—"} · attempt {j.attempts} · {j.finished_at ? formatRelative(j.finished_at) : "running"}
                  </span>
                </div>
                {Object.keys(j.stats).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(j.stats).map(([k, v]) => (
                      <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {k.replace(/_/g, " ")}: <span className="tnum">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {j.error && (
                  <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {j.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {asset.pending_reviews > 0 && (
          <Button asChild size="sm">
            <Link href={`/sources/review?asset=${asset.id}`}>Review {asset.pending_reviews} row(s)</Link>
          </Button>
        )}
        {asset.status !== "archived" && (
          <Gated permission="source.import">
            <Button size="sm" variant="outline" onClick={() => archive.run({ asset_id: asset.id })} disabled={archive.pending}>
              <Archive className="size-3.5" aria-hidden /> Archive
            </Button>
          </Gated>
        )}
      </div>
    </RecordDrawer>
  );
}
