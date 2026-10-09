"use client";

import { useId, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/patterns/field";
import { EmptyState } from "@/components/patterns/states";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { CATALOG_MEDIA_TYPES, MAX_CATALOG_MEDIA_BYTES, type CatalogMediaInput } from "@/features/catalog/media-schema";
import { archiveCatalogMediaAction, completeCatalogMediaAction, prepareCatalogMediaAction, setPrimaryCatalogMediaAction, updateCatalogMediaAction } from "@/server/commands/catalog-media";
import type { ProductDetail } from "@/server/queries/catalog";

const TYPE_ERROR = "Use JPEG, PNG, WebP, PDF, MP4 or WebM, up to 20 MB per file.";

function acceptable(file: File) {
  return CATALOG_MEDIA_TYPES.includes(file.type as typeof CATALOG_MEDIA_TYPES[number]) && file.size > 0 && file.size <= MAX_CATALOG_MEDIA_BYTES;
}

/** Signed upload straight to private storage, then server-side validation and attachment. */
async function sendFile(input: CatalogMediaInput, file: File) {
  const prepared = await prepareCatalogMediaAction(input);
  if (!prepared.ok) throw new Error(prepared.error);
  const bucket = getBrowserSupabase().storage.from("product-media");
  const { error } = await bucket.uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type, upsert: false });
  if (error) {
    // A lost success response may leave the object present; finalize validates its bytes.
    const { data, error: infoError } = await bucket.info(prepared.data.path);
    if (infoError || Number(data?.size) !== file.size) throw new Error(error.message);
  }
  const completed = await completeCatalogMediaAction(input);
  if (!completed.ok) throw new Error(completed.error);
  return completed.message;
}

function mediaInput(productId: string, variantId: string | null, mediaId: string, file: File, replacesId?: string): CatalogMediaInput {
  return { product_id: productId, variant_id: variantId, media_id: mediaId, replaces_id: replacesId ?? null, filename: file.name, mime_type: file.type as CatalogMediaInput["mime_type"], size_bytes: file.size, rights_confirmed: true };
}

export function CatalogMediaPreview({ url, kind, mimeType, alt }: { url: string | null; kind: string; mimeType?: string | null; alt: string }) {
  if (!url) return <div className="flex aspect-[4/3] items-center justify-center rounded bg-muted px-3 text-xs text-muted-foreground">Preview unavailable. Refresh to retry.</div>;
  if (kind === "image") return <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${alt}`}><Image src={url} alt={alt} width={640} height={480} unoptimized className="aspect-[4/3] w-full rounded bg-muted object-contain" /></a>;
  if (mimeType?.startsWith("video/")) return <video src={url} controls preload="metadata" className="aspect-[4/3] w-full rounded bg-muted" aria-label={alt} />;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="flex aspect-[4/3] items-center justify-center rounded bg-muted p-3 text-sm underline">Open {kind === "pdf" ? "PDF" : "attachment"}</a>;
}

export function ProductMedia({ productId, variants, media, canWrite }: { productId: string; variants: { id: string; sku: string | null; name: string | null }[]; media: ProductDetail["media"]; canWrite: boolean }) {
  const router = useRouter();
  const fieldId = useId();
  const [variantId, setVariantId] = useState("");
  const [rights, setRights] = useState(false);
  const [queue, setQueue] = useState<{ id: string; file: File; done: boolean; error?: string }[]>([]);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; file: File | null; rights: boolean; mediaId: string; error?: string } | null>(null);

  function choose(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.every(acceptable)) { toast.error(TYPE_ERROR); return; }
    setQueue(previous => [...previous, ...incoming.map(file => ({ id: crypto.randomUUID(), file, done: false }))]);
  }

  function upload() {
    start(async () => {
      for (const [index, item] of queue.entries()) {
        if (item.done) continue;
        setProgress(`Uploading ${index + 1} of ${queue.length}: ${item.file.name}`);
        try {
          await sendFile(mediaInput(productId, variantId || null, item.id, item.file), item.file);
          setQueue(previous => previous.map(row => row.id === item.id ? { ...row, done: true, error: undefined } : row));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed";
          setQueue(previous => previous.map(row => row.id === item.id ? { ...row, error: message } : row));
          toast.error(message); setProgress(""); router.refresh(); return;
        }
      }
      setProgress(""); toast.success("Media attached to the product"); router.refresh();
    });
  }

  function replace(item: ProductDetail["media"][number]) {
    if (!replacing?.file) return;
    const { file, mediaId } = replacing;
    start(async () => {
      setProgress(`Replacing with ${file.name}…`);
      try {
        // The same media id is reused on retry, so a retried replacement never duplicates.
        const message = await sendFile(mediaInput(productId, item.variant_id ?? null, mediaId, file, item.id), file);
        setReplacing(null); toast.success(message ?? "Media replaced");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Replacement failed";
        setReplacing(previous => previous ? { ...previous, error: message } : previous); toast.error(message);
      }
      setProgress(""); router.refresh();
    });
  }

  function mutate(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const result = await action();
      if (!result.ok) { toast.error(result.error ?? "Could not save media"); return; }
      setEditing(null); setArchiveId(null); toast.success(result.message ?? "Saved"); router.refresh();
    });
  }

  const variantLabel = (id: string | null) => id ? variants.find(variant => variant.id === id)?.sku ?? "Variant" : "Whole product";

  return <div className="space-y-4">
    {canWrite ? <div className="space-y-3 rounded-lg border p-4" onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!pending) choose(event.dataTransfer.files); }}>
      <Field label="Upload media" htmlFor={`${fieldId}-upload`} hint="Choose or drop JPEG, PNG, WebP, PDF, MP4 or WebM files. Up to 20 MB each; originals remain private.">
        <Input id={`${fieldId}-upload`} type="file" multiple accept={CATALOG_MEDIA_TYPES.join(",")} disabled={pending} onChange={event => { if (event.target.files) choose(event.target.files); event.target.value = ""; }} />
      </Field>
      <Field label="Attach to" htmlFor={`${fieldId}-variant`}><SimpleSelect id={`${fieldId}-variant`} value={variantId} onChange={setVariantId} options={variants.map(variant => ({ value: variant.id, label: variant.sku ?? variant.name ?? "Variant" }))} noneLabel="Whole product" disabled={pending || queue.some(item => item.done)} /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={rights} disabled={pending} onChange={event => setRights(event.target.checked)} className="mt-1" /><span>I checked that these files show this product/variant and that we have permission to use them in the internal catalogue.</span></label>
      {queue.length ? <ul className="space-y-2 text-sm">{queue.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2"><span className="break-all">{item.file.name} · {item.done ? "Attached" : item.error ?? "Ready"}</span>{!item.done && !pending ? <Button variant="ghost" size="sm" onClick={() => setQueue(previous => previous.filter(row => row.id !== item.id))}>Remove</Button> : null}</li>)}</ul> : null}
      {queue.length > 0 && queue.every(item => item.done) ? <Button variant="outline" disabled={pending} onClick={() => { setQueue([]); setRights(false); }}>Upload more media</Button> : null}
      <p role="status" className="text-sm text-muted-foreground">{progress}</p>
      <Button disabled={pending || !rights || !queue.some(item => !item.done)} onClick={upload}>{pending && !replacing ? "Uploading…" : queue.some(item => item.error) ? "Retry upload" : "Upload media"}</Button>
    </div> : null}
    {media.length === 0 ? <EmptyState title="No media yet" description={canWrite ? "Upload product photos, videos or PDF attachments above." : "No approved media for this product yet. A catalogue operator can attach it."} /> : <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {media.map(item => <li key={item.id} className="space-y-3 rounded-lg border p-3">
        <CatalogMediaPreview url={item.url} kind={item.kind} mimeType={item.mime_type} alt={item.alt_text ?? item.caption ?? item.original_filename ?? "Product media"} />
        <p className="break-all text-sm">{item.caption ?? item.original_filename ?? item.kind}{item.is_primary ? " · Primary image" : ""}</p>
        <p className="text-xs text-muted-foreground">{canWrite ? `${item.review_state} · rights ${item.usage_rights_state} · ` : ""}{variantLabel(item.variant_id)}</p>
        {item.source_ref ? <p className="break-all text-xs text-muted-foreground">Source: {item.source_ref}</p> : null}
        {canWrite ? <div className="flex flex-wrap gap-2">
          {item.kind === "image" && !item.is_primary && item.review_state === "reviewed" && item.usage_rights_state === "accepted" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => mutate(() => setPrimaryCatalogMediaAction({ id: item.id, product_id: productId }))}>Set primary</Button> : null}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(item.id); setCaption(item.caption ?? ""); setAltText(item.alt_text ?? ""); setSourceRef(item.source_ref ?? ""); }}>Edit details</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setReplacing({ id: item.id, file: null, rights: false, mediaId: crypto.randomUUID() })}>Replace</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArchiveId(item.id)}>Archive</Button>
        </div> : null}
        {editing === item.id ? <div className="space-y-2"><Field label="Caption" htmlFor={`${fieldId}-caption`}><Input id={`${fieldId}-caption`} value={caption} onChange={event => setCaption(event.target.value)} maxLength={1000} /></Field><Field label="Alt text" htmlFor={`${fieldId}-alt`}><Input id={`${fieldId}-alt`} value={altText} onChange={event => setAltText(event.target.value)} maxLength={500} /></Field><Field label="Source reference" htmlFor={`${fieldId}-source`}><Input id={`${fieldId}-source`} value={sourceRef} onChange={event => setSourceRef(event.target.value)} maxLength={1000} /></Field><Button size="sm" disabled={pending} onClick={() => mutate(() => updateCatalogMediaAction({ id: item.id, product_id: productId, caption, alt_text: altText, source_ref: sourceRef }))}>Save details</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button></div> : null}
        {replacing?.id === item.id ? <div className="space-y-2 text-sm">
          <Field label="Replacement file" htmlFor={`${fieldId}-replace`} hint="The new file keeps this attachment's caption, alt text, source and primary role; the old file is archived with its original retained.">
            <Input id={`${fieldId}-replace`} type="file" accept={CATALOG_MEDIA_TYPES.join(",")} disabled={pending} onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ""; if (file && !acceptable(file)) { toast.error(TYPE_ERROR); return; } setReplacing(previous => previous ? { ...previous, file, error: undefined, mediaId: crypto.randomUUID() } : previous); }} />
          </Field>
          {replacing.file ? <p className="break-all">{replacing.file.name}{replacing.error ? ` · ${replacing.error}` : ""}</p> : null}
          <label className="flex items-start gap-2"><input type="checkbox" checked={replacing.rights} disabled={pending} onChange={event => setReplacing(previous => previous ? { ...previous, rights: event.target.checked } : previous)} className="mt-1" /><span>I checked that this file shows this product/variant and that we have permission to use it in the internal catalogue.</span></label>
          <Button size="sm" disabled={pending || !replacing.file || !replacing.rights} onClick={() => replace(item)}>{pending ? "Replacing…" : replacing.error ? "Retry replacement" : "Replace file"}</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setReplacing(null)}>Cancel</Button>
        </div> : null}
        {archiveId === item.id ? <div className="space-y-2 text-sm"><p>Archive this attachment? The original and audit history are retained. Use Replace to swap in a new file instead.</p><Button size="sm" disabled={pending} onClick={() => mutate(() => archiveCatalogMediaAction({ id: item.id, product_id: productId }))}>Confirm archive</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => setArchiveId(null)}>Cancel</Button></div> : null}
      </li>)}
    </ul>}
  </div>;
}
