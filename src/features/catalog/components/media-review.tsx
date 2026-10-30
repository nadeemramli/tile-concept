"use client";

import { useId, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/patterns/data-table";
import { DrawerSection, FactList, RecordDrawer } from "@/components/patterns/record-drawer";
import { MetricCard } from "@/components/patterns/metric-card";
import { StatusPill } from "@/components/patterns/status-pill";
import { DisabledHint, InfoTip } from "@/components/patterns/explain";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { MEDIA_EVIDENCE_STATE, MEDIA_LINK_BASIS, MEDIA_LINK_STATE, USAGE_RIGHTS_STATE } from "@/lib/domain/status-maps";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { MediaCoverage, MediaReviewRow } from "@/server/queries/media-review";
import type { MediaReviewView } from "@/features/catalog/media-review-schema";
import type { ActionResult } from "@/server/action-result";
import {
  confirmMediaAssociationAction,
  publishMediaAction,
  rejectMediaAssociationAction,
  reviewMediaEvidenceAction,
  reviewMediaRightsAction,
  searchMediaVariantsAction,
} from "@/server/commands/media-review";

const VIEW_LABELS: Record<MediaReviewView, string> = { open: "In progress", approved: "Confirmed, not published", published: "Published", rejected: "Rejected", all: "All" };

const sum = (o: Record<string, number> | undefined, keys?: string[]) => Object.entries(o ?? {}).reduce((n, [k, v]) => (!keys || keys.includes(k) ? n + Number(v) : n), 0);

function Coverage({ c }: { c: MediaCoverage }) {
  const asOf = formatDateTime(c.generated_at);
  const info = (definition: string, grain: string, caveat?: string) => ({ definition, grain, source: c.source, freshness: `Live, computed ${asOf}`, caveat });
  const openLinks = sum(c.associations.by_state, ["pending_review", "needs_correction"]);
  const rightsUnknown = c.media_assets.by_rights_state.unreviewed ?? 0;
  const commercialPending = sum(c.commercial_proposals.price_candidates_by_state, ["pending_review"]);
  return (
    <section aria-label="Catalogue media coverage" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard compact label="Products with a published image" value={`${formatNumber(c.products.with_published_image)} / ${formatNumber(c.products.total)}`} info={info("Non-archived products with at least one active, reviewed, rights-accepted image.", "Product")} />
        <MetricCard compact label="Products with a primary image" value={formatNumber(c.products.with_primary_image)} info={info("Non-archived products whose catalogue card has a primary image.", "Product")} />
        <MetricCard compact label="Evidence awaiting review" value={formatNumber(c.products.evidence_pending_only)} tone={c.products.evidence_pending_only ? "warning" : "neutral"} info={info("Products with no published image yet, but with an imported image proposed or confirmed for one of their variants.", "Product")} />
        <MetricCard compact label="No known image evidence" value={formatNumber(c.products.no_known_evidence)} info={info("Products with no published image and no imported image linked to any variant. Unknown, not confirmed missing: the source may simply not have been imported.", "Product", "Not the same as 'has no images'.")} />
        <MetricCard compact label="Associations to review" value={formatNumber(openLinks)} tone={openLinks ? "warning" : "neutral"} href="/merchandise/catalog/media-review?view=open" info={info("Imported image → variant matches still waiting for a person.", "Association", c.associations.pending_without_variant ? `${formatNumber(c.associations.pending_without_variant)} have no proposed variant at all.` : undefined)} />
        <MetricCard compact label="Images with unknown rights" value={`${formatNumber(rightsUnknown)} / ${formatNumber(c.media_assets.total)}`} tone={rightsUnknown ? "warning" : "neutral"} info={info("Imported images whose usage rights nobody has recorded. Unknown is not permission; these cannot be published.", "Imported image")} />
        <MetricCard compact label="Variants with an image" value={`${formatNumber(c.variants.with_published_image)} / ${formatNumber(c.variants.total)}`} info={info("Variants with an active, reviewed, rights-accepted image attached to that variant specifically.", "Variant")} />
        <MetricCard compact label="Commercial proposals pending" value={formatNumber(commercialPending)} href="/sources/review" info={info("Imported price candidates still waiting in Imports & OCR Review. Approve or reject them there; nothing is defaulted into a price.", "Price candidate", `${formatNumber(c.commercial_proposals.review_items_pending)} review items pending in total.`)} />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="coverage-asof">
        Live counts as of {asOf} · last image import {c.media_assets.last_imported_at ? formatDateTime(c.media_assets.last_imported_at) : "never"} · last media decision {c.last_media_decision_at ? formatDateTime(c.last_media_decision_at) : "none yet"}
        {c.catalogue_media.primary_failing_gate ? ` · ${formatNumber(c.catalogue_media.primary_failing_gate)} existing primary image(s) fail the review/rights gate` : ""}
        {` · ${formatNumber(c.catalogue_media.archived)} archived or withdrawn`}
        <InfoTip label="Coverage source" content={{ title: "Where these numbers come from", body: c.source }} />
      </p>
      {c.sources.length ? (
        <details className="rounded-lg border p-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium">By source document ({c.sources.length})</summary>
          <table className="mt-2 w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Source</th><th>Images</th><th>Rights unknown</th><th>To review</th><th>Confirmed</th><th>Rejected</th><th>Published</th></tr></thead>
            <tbody>{c.sources.map((s) => <tr key={s.source_asset_id} className="border-t"><td className="py-1 pr-2">{s.name}</td><td className="tnum">{s.assets}</td><td className="tnum">{s.rights_unknown}</td><td className="tnum">{s.pending}</td><td className="tnum">{s.approved}</td><td className="tnum">{s.rejected}</td><td className="tnum">{s.published}</td></tr>)}</tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}

function Preview({ url, alt, mime }: { url: string | null; alt: string; mime: string | null }) {
  if (!url) return <div className="flex aspect-[4/3] items-center justify-center rounded bg-muted px-2 text-center text-[11px] text-muted-foreground">No stored file</div>;
  if (mime === "application/pdf") return <a href={url} target="_blank" rel="noopener noreferrer" className="flex aspect-[4/3] items-center justify-center rounded bg-muted text-xs underline">Open PDF</a>;
  return <Image src={url} alt={alt} width={480} height={360} unoptimized className="aspect-[4/3] w-full rounded bg-muted object-contain" />;
}

function ReviewDrawer({ row, onClose, onRelinked }: { row: MediaReviewRow; onClose: () => void; onRelinked: (linkId: string) => void }) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [variantId, setVariantId] = useState("");
  const [note, setNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rights, setRights] = useState(row.usage_rights_state === "unreviewed" ? "" : row.usage_rights_state);
  const [rightsReason, setRightsReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [alt, setAlt] = useState(row.product_name ? `${row.product_name}${row.variant_sku ? ` ${row.variant_sku}` : ""}` : "");
  const [primary, setPrimary] = useState(false);

  const closed = row.link_state === "rejected" || row.link_state === "superseded";
  const published = !!row.published_media_id;
  const isImage = row.mime_type !== "application/pdf";
  const publishBlockers = [
    row.link_state !== "approved" && "the variant is not confirmed",
    row.asset_state !== "approved" && "the evidence is not reviewed",
    row.usage_rights_state !== "accepted" && "usage rights are not accepted",
    published && "it is already published",
  ].filter(Boolean) as string[];

  function run<T>(action: () => Promise<ActionResult<T>>, after?: (data: T) => void) {
    start(async () => {
      const result = await action();
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(result.message ?? "Saved");
      after?.(result.data);
      router.refresh();
    });
  }

  function search() {
    start(async () => {
      const result = await searchMediaVariantsAction(term);
      if (!result.ok) { toast.error(result.error); return; }
      setOptions(result.data);
      if (!result.data.length) toast.message("No variant matches that search");
    });
  }

  return (
    <RecordDrawer open onOpenChange={(o) => !o && onClose()} width="xl" title={row.source_name ?? "Imported image"} description={`${row.page_number ? `Page ${row.page_number} · ` : ""}${row.asset_kind.replace(/_/g, " ")}`}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Preview url={row.image_url} alt={`Imported image from ${row.source_name ?? "source"}`} mime={row.mime_type} />
          {row.image_url ? <a className="text-xs underline" href={row.image_url} target="_blank" rel="noopener noreferrer">Open image</a> : null}
          {row.page_url ? <a className="ml-3 text-xs underline" href={row.page_url} target="_blank" rel="noopener noreferrer">Open source page</a> : null}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <StatusPill map={MEDIA_LINK_STATE} value={row.link_state} />
            <StatusPill map={MEDIA_EVIDENCE_STATE} value={row.asset_state} />
            <StatusPill map={USAGE_RIGHTS_STATE} value={row.usage_rights_state} />
            <StatusPill map={MEDIA_LINK_BASIS} value={row.link_basis} />
          </div>
          <FactList items={[
            { label: "Proposed / confirmed", value: row.product_name ? `${row.product_name}${row.variant_sku ? ` · ${row.variant_sku}` : ""}` : "No variant proposed" },
            { label: "Code read", value: row.source_code_raw ?? "—", mono: true },
            { label: "Candidate", value: row.variant_candidate_key ?? "—", mono: true },
            { label: "Confidence", value: row.confidence === null ? "—" : `${Math.round(row.confidence * 100)}%` },
            { label: "Source path", value: row.source_path ?? "—" },
            { label: "Imported", value: formatDateTime(row.created_at) },
            { label: "Rights basis", value: row.rights_basis ?? "Not recorded" },
            ...(row.source_web_url ? [{ label: "Source link", value: <a className="underline" href={row.source_web_url} target="_blank" rel="noopener noreferrer">Open original</a> }] : []),
          ]} />
        </div>
      </div>

      <DrawerSection title="1 · Which variant does this image show?">
        {closed ? <p className="text-sm text-muted-foreground">This association was {row.link_state}. It stays as evidence and cannot be published.</p> : published ? (
          <p className="text-sm">Published on <Link className="underline" href={`/merchandise/catalog/${row.product_id}`}>{row.product_name}</Link>{row.published_is_primary ? " as the primary image" : ""}. Archive it on the product before changing the association.</p>
        ) : (
          <div className="space-y-2">
            {row.product_variant_id && row.link_basis !== "same_source_document" && row.link_state !== "approved" ? (
              <Button size="sm" disabled={pending} onClick={() => run(() => confirmMediaAssociationAction({ link_id: row.link_id, variant_id: row.product_variant_id!, note }), (d) => onRelinked(d.link_id))}>Confirm proposed variant</Button>
            ) : null}
            <div className="flex gap-2">
              <Field label="Find another variant" htmlFor={`${id}-q`} className="flex-1" hint="Search by product name, SKU or supplier code.">
                <Input id={`${id}-q`} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
              </Field>
              <Button size="sm" variant="outline" className="mt-6" disabled={pending || term.trim().length < 2} onClick={search}>Search</Button>
            </div>
            {options.length ? <Field label="Variant" htmlFor={`${id}-variant`}><SimpleSelect id={`${id}-variant`} value={variantId} onChange={setVariantId} options={options.map((o) => ({ value: o.id, label: o.label }))} allowNone={false} placeholder="Choose the variant shown" /></Field> : null}
            <Field label="Note (optional)" htmlFor={`${id}-note`}><Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
            <DisabledHint reason={!variantId ? "Search for and choose a variant first." : null}>
              <Button size="sm" variant="outline" disabled={pending || !variantId} onClick={() => run(() => confirmMediaAssociationAction({ link_id: row.link_id, variant_id: variantId, note }), (d) => onRelinked(d.link_id))}>Confirm chosen variant</Button>
            </DisabledHint>
            <div className="space-y-1 border-t pt-2">
              <Field label="Reason to reject" htmlFor={`${id}-reject`} hint="Rejecting keeps the image as evidence; it is never published from this association."><Textarea id={`${id}-reject`} rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={1000} /></Field>
              <Button size="sm" variant="ghost" disabled={pending || !rejectReason.trim()} onClick={() => run(() => rejectMediaAssociationAction({ link_id: row.link_id, reason: rejectReason }), onClose)}>Reject association</Button>
            </div>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="2 · Is the image itself usable evidence?">
        <div className="space-y-2">
          <Field label="Evidence note" htmlFor={`${id}-ev`} hint="Required when flagging or rejecting: say what is wrong (crop, legibility, wrong page)."><Input id={`${id}-ev`} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} maxLength={1000} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending || row.asset_state === "approved"} onClick={() => run(() => reviewMediaEvidenceAction({ media_asset_id: row.media_asset_id, decision: "approved", note: evidenceNote }))}>Approve evidence</Button>
            <Button size="sm" variant="ghost" disabled={pending || !evidenceNote.trim()} onClick={() => run(() => reviewMediaEvidenceAction({ media_asset_id: row.media_asset_id, decision: "needs_correction", note: evidenceNote }))}>Needs correction</Button>
            <Button size="sm" variant="ghost" disabled={pending || !evidenceNote.trim()} onClick={() => run(() => reviewMediaEvidenceAction({ media_asset_id: row.media_asset_id, decision: "rejected", note: evidenceNote }))}>Reject evidence</Button>
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title="3 · Usage rights">
        <div className="space-y-2">
          <Field label="Rights decision" htmlFor={`${id}-rights`}>
            <SimpleSelect id={`${id}-rights`} value={rights} onChange={setRights} allowNone={false} placeholder="Choose" options={[{ value: "accepted", label: "Accepted — we may use it in the catalogue" }, { value: "restricted", label: "Restricted — reference only" }, { value: "denied", label: "Denied — we may not use it" }]} />
          </Field>
          <Field label="Basis for this decision" htmlFor={`${id}-basis`} required hint="For example the supplier agreement, email or brochure licence. Restricting or denying withdraws anything already published."><Textarea id={`${id}-basis`} rows={2} value={rightsReason} onChange={(e) => setRightsReason(e.target.value)} maxLength={1000} /></Field>
          <Button size="sm" variant="outline" disabled={pending || !rights || !rightsReason.trim()} onClick={() => run(() => reviewMediaRightsAction({ media_asset_id: row.media_asset_id, rights_state: rights as "accepted", reason: rightsReason }), () => setRightsReason(""))}>Record rights</Button>
        </div>
      </DrawerSection>

      <DrawerSection title="4 · Publish to the catalogue">
        <div className="space-y-2">
          <Field label="Alt text" htmlFor={`${id}-alt`}><Input id={`${id}-alt`} value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={500} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={primary} disabled={!isImage || pending} onChange={(e) => setPrimary(e.target.checked)} />Make it the product&apos;s primary image</label>
          <DisabledHint reason={publishBlockers.length ? `Not yet: ${publishBlockers.join(", ")}.` : null}>
            <Button size="sm" disabled={pending || publishBlockers.length > 0} onClick={() => run(() => publishMediaAction({ link_id: row.link_id, alt_text: alt, is_primary: primary }))}>Publish</Button>
          </DisabledHint>
        </div>
      </DrawerSection>
    </RecordDrawer>
  );
}

export function MediaReviewClient({ view, q, queue, coverage }: { view: MediaReviewView; q: string; queue: { rows: MediaReviewRow[]; total: number; truncated: boolean }; coverage: MediaCoverage }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = queue.rows.find((r) => r.link_id === openId) ?? null;
  const columns: ColumnDef<MediaReviewRow, unknown>[] = [
    { id: "preview", header: "Image", cell: ({ row }) => <div className="w-20"><Preview url={row.original.image_url} alt={`Imported image ${row.original.source_name ?? ""}`} mime={row.original.mime_type} /></div> },
    { id: "source", header: "Source", meta: { hint: "The imported document and page this image came from." }, cell: ({ row }) => <div className="max-w-56"><div className="truncate text-[13px]">{row.original.source_name ?? row.original.source_path ?? "—"}</div><div className="text-[11px] text-muted-foreground">{row.original.page_number ? `Page ${row.original.page_number}` : row.original.asset_kind.replace(/_/g, " ")}{row.original.source_code_raw ? ` · ${row.original.source_code_raw}` : ""}</div></div> },
    { id: "variant", header: "Variant", meta: { hint: "Proposed by the importer, or confirmed by a reviewer." }, cell: ({ row }) => row.original.product_name ? <span className="text-[13px]">{row.original.product_name}{row.original.variant_sku ? ` · ${row.original.variant_sku}` : ""}</span> : <span className="text-[13px] text-muted-foreground">None proposed</span> },
    { id: "basis", header: "Basis", cell: ({ row }) => <StatusPill map={MEDIA_LINK_BASIS} value={row.original.link_basis} /> },
    { id: "association", header: "Association", cell: ({ row }) => <StatusPill map={MEDIA_LINK_STATE} value={row.original.link_state} /> },
    { id: "evidence", header: "Evidence", cell: ({ row }) => <StatusPill map={MEDIA_EVIDENCE_STATE} value={row.original.asset_state} /> },
    { id: "rights", header: "Rights", cell: ({ row }) => <StatusPill map={USAGE_RIGHTS_STATE} value={row.original.usage_rights_state} /> },
    { id: "published", header: "Catalogue", cell: ({ row }) => row.original.published_media_id ? <span className="text-[13px]">Published{row.original.published_is_primary ? " · primary" : ""}</span> : <span className="text-[13px] text-muted-foreground">—</span> },
  ];
  return (
    <div className="space-y-4">
      <Coverage c={coverage} />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Queue views" className="flex flex-wrap gap-1">
          {(Object.keys(VIEW_LABELS) as MediaReviewView[]).map((v) => (
            <Button key={v} asChild size="sm" variant={v === view ? "default" : "ghost"}>
              <Link href={`/merchandise/catalog/media-review?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={v === view ? "page" : undefined}>{VIEW_LABELS[v]}</Link>
            </Button>
          ))}
        </nav>
        <form className="ml-auto flex gap-2" action="/merchandise/catalog/media-review">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={q} placeholder="Source, code, product or SKU" aria-label="Search the review queue" className="h-8 w-64" />
          <Button size="sm" variant="outline" type="submit">Search</Button>
        </form>
      </div>
      {queue.truncated ? <p className="text-xs text-muted-foreground">Showing the oldest {queue.rows.length} of {formatNumber(queue.total)}. Narrow with search to reach the rest.</p> : null}
      <DataTable columns={columns} data={queue.rows} rowKey={(r) => r.link_id} onRowClick={(r) => setOpenId(r.link_id)} isRowActive={(r) => r.link_id === openId} emptyTitle="Nothing in this view" emptyDescription={view === "open" ? "Every imported image association has a decision." : "No associations match."} />
      {open ? <ReviewDrawer key={open.link_id} row={open} onClose={() => setOpenId(null)} onRelinked={setOpenId} /> : null}
    </div>
  );
}
