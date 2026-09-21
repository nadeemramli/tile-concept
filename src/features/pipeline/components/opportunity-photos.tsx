"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/patterns/field";
import { FormDialog } from "@/features/crm/components/form-dialog";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { opportunityPhotoAction } from "@/server/commands/opportunities";
import { fail } from "@/server/action-result";
import type { OpportunityDetail } from "@/server/queries/opportunities";
import { formatDateTime } from "@/lib/format";

export function OpportunityPhotos({ opp, canWrite }: { opp: OpportunityDetail; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const upload = useRef<{ id: string; key: string } | null>(null);
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Internal opportunity evidence. Photos stay private to staff who can access this opportunity. Marketing publication requires a separate customer media permission workflow.</p>
    {canWrite && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Camera className="size-3.5" /> Add photo and remark</Button>}
    {!opp.photos.length && <p className="text-sm text-muted-foreground">No photos yet.</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {opp.photos.map((p) => <figure key={p.id} className="rounded-md border p-2">
        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" aria-label={`Open photo: ${p.remark}`}><Image unoptimized src={p.url} width={400} height={280} alt={p.remark} className="h-40 w-full rounded object-contain" /></a> : <p className="text-xs">Photo unavailable. Refresh to retry.</p>}
        <figcaption className="mt-2 whitespace-pre-wrap text-sm">{p.remark}</figcaption>
        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(p.created_at)}</p>
        {canWrite && <Button variant="ghost" size="sm" onClick={() => setRemoveId(p.id)}><Trash2 className="size-3.5" /> Remove photo</Button>}
      </figure>)}
    </div>
    <FormDialog open={open} onOpenChange={setOpen} title="Add opportunity photo" description="JPG, PNG or WebP, up to 5 MB. Include a remark explaining what the team should notice." submitLabel="Upload and save"
      action={async (fd) => {
        const file = fd.get("photo");
        const remark = String(fd.get("remark") ?? "").trim();
        if (!(file instanceof File) || file.size === 0 || file.size > 5242880 || !["image/jpeg","image/png","image/webp"].includes(file.type) || !remark) return fail("Choose a JPG, PNG or WebP up to 5 MB and enter a remark");
        const key = `${file.name}:${file.size}:${file.lastModified}:${remark}`;
        if (upload.current?.key !== key) upload.current = { id: crypto.randomUUID(), key };
        const photo_id = upload.current.id;
        const prepared = await opportunityPhotoAction({ action:"prepare", opportunity_id:opp.id, photo_id, file_name:file.name, content_type:file.type, file_size:file.size, remark });
        if (!prepared.ok) return prepared;
        const storage = getBrowserSupabase().storage.from("opportunity-photos");
        const { error } = await storage.upload(prepared.data.path, file, { contentType:file.type, upsert:false });
        if (error) {
          const { data: existing } = await storage.info(prepared.data.path);
          if (!existing || existing.size !== file.size || existing.contentType !== file.type) return fail(error);
        }
        return opportunityPhotoAction({ action:"finish", opportunity_id:opp.id, photo_id });
      }} onSuccess={() => { upload.current = null; router.refresh(); }}>
      <Field label="Photo" htmlFor="opportunity-photo" required><Input id="opportunity-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></Field>
      <Field label="Remark" htmlFor="photo-remark" required><Textarea id="photo-remark" name="remark" rows={3} maxLength={2000} required /></Field>
    </FormDialog>
    <FormDialog open={!!removeId} onOpenChange={() => setRemoveId(null)} title="Remove photo" description="The photo will no longer be shown. The reason remains in the opportunity timeline." submitLabel="Remove" destructive
      action={(fd) => opportunityPhotoAction({ action:"remove", opportunity_id:opp.id, photo_id:removeId, reason:String(fd.get("reason") ?? "") })} onSuccess={() => router.refresh()}>
      <Field label="Reason" htmlFor="photo-remove-reason" required><Textarea id="photo-remove-reason" name="reason" required /></Field>
    </FormDialog>
  </div>;
}
