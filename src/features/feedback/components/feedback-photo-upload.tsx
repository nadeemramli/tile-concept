"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { prepareFeedbackPhotoAction } from "@/server/commands/feedback";
import { ALLOWED_PHOTO_TYPES, MAX_FEEDBACK_PHOTO_BYTES } from "../schema";

export function FeedbackPhotoUpload({ requestId, existingCount }: { requestId: string; existingCount: number }) {
  const [photos, setPhotos] = useState<{ id: string; file: File; done: boolean }[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  function add(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    if (incoming.some(f => !ALLOWED_PHOTO_TYPES.has(f.type) || f.size > MAX_FEEDBACK_PHOTO_BYTES)) { toast.error("Use JPEG, PNG or WebP images up to 5 MB each."); return; }
    if (existingCount + photos.filter(p => !p.done).length + incoming.length > 6) { toast.error("Up to six photos per request."); return; }
    setPhotos(prev => [...prev, ...incoming.map(file => ({ id: crypto.randomUUID(), file, done: false }))]);
  }
  function upload() {
    start(async () => {
      for (const photo of photos.filter(p => !p.done)) {
        const r = await prepareFeedbackPhotoAction({ request_id: requestId, media_id: photo.id, mime_type: photo.file.type, size_bytes: photo.file.size });
        if (!r.ok) { toast.error(r.error); return; }
        const bucket = getBrowserSupabase().storage.from("feedback-media");
        const { error } = await bucket.upload(r.data, photo.file, { contentType: photo.file.type, upsert: false });
        if (error) {
          const retry = await bucket.info(r.data);
          if (retry.error || Number(retry.data?.size) !== photo.file.size) { toast.error(`Could not upload ${photo.file.name}. Retry keeps the same photo path.`); return; }
        }
        setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, done: true } : p));
      }
      toast.success("Photos uploaded. They are available through the private link."); router.refresh();
    });
  }
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">{existingCount} uploaded · up to six photos, 5 MB each. Customer and showroom photos can both be included.</p><label className="block text-sm">Choose photos<Input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={e => { add(e.target.files); e.target.value = ""; }} /></label><label className="block text-sm">Take a photo on your phone<Input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={pending} onChange={e => { add(e.target.files); e.target.value = ""; }} /></label>{photos.length ? <ul className="space-y-1 text-sm">{photos.map(p => <li key={p.id} className="break-all">{p.file.name} · {p.done ? "Uploaded" : "Ready to upload"}</li>)}</ul> : null}<Button variant="outline" onClick={upload} disabled={pending || !photos.some(p => !p.done)}>{pending ? "Uploading…" : "Upload photos"}</Button></div>;
}
