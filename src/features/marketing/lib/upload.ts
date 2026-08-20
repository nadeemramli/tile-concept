"use client";

import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Uploads to a private bucket. Storage policies key access off the first path
 * segment, so every object lives under the workspace id.
 */
export interface UploadResult {
  path: string;
  mimeType: string;
  size: number;
}

const MB = 1024 * 1024;

export const BUCKET_RULES = {
  "permission-evidence": {
    maxBytes: 20 * MB,
    accept: "image/png,image/jpeg,image/webp,application/pdf",
    allowed: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
    label: "PNG, JPEG, WebP or PDF up to 20 MB",
  },
  "shoot-outputs": {
    maxBytes: 200 * MB,
    accept: "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,application/pdf",
    allowed: ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "application/pdf"],
    label: "Image, MP4/MOV video or PDF up to 200 MB",
  },
} as const;

export type BucketName = keyof typeof BUCKET_RULES;

/** Keep object names predictable and safe, and never collide on re-upload. */
function safeName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80);
  return `${Date.now().toString(36)}-${cleaned || "file"}`;
}

export async function uploadPrivateFile(bucket: BucketName, workspaceId: string, folder: string, file: File): Promise<UploadResult> {
  const rules = BUCKET_RULES[bucket];
  if (file.size > rules.maxBytes) throw new Error(`That file is too large. ${rules.label}.`);
  if (file.type && !(rules.allowed as readonly string[]).includes(file.type)) throw new Error(`That file type is not accepted. ${rules.label}.`);

  const path = `${workspaceId}/${folder}/${safeName(file.name)}`;
  const supabase = getBrowserSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return { path, mimeType: file.type || "application/octet-stream", size: file.size };
}

/** Map a MIME type onto the output kinds the database accepts. */
export function outputKindFor(mime: string): "photo" | "video" | "interview_notes" | "other" {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "interview_notes";
  return "other";
}
