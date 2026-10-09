import { z } from "zod";
import { uuid } from "@/lib/zod";

export const MAX_CATALOG_MEDIA_BYTES = 20 * 1024 * 1024;
export const CATALOG_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/webm"] as const;
export const catalogMediaSchema = z.object({
  product_id: uuid(),
  variant_id: uuid().nullable().optional(),
  media_id: uuid(),
  /** Active attachment this upload replaces (archived once the new file is attached). */
  replaces_id: uuid().nullable().optional(),
  filename: z.string().trim().min(1).max(255),
  mime_type: z.enum(CATALOG_MEDIA_TYPES),
  size_bytes: z.number().int().positive().max(MAX_CATALOG_MEDIA_BYTES),
  caption: z.string().trim().max(1000).optional(),
  alt_text: z.string().trim().max(500).optional(),
  source_ref: z.string().trim().max(1000).optional(),
  rights_confirmed: z.literal(true),
});
export type CatalogMediaInput = z.input<typeof catalogMediaSchema>;

export const catalogMediaEditSchema = z.object({ id: uuid(), product_id: uuid(), caption: z.string().trim().max(1000), alt_text: z.string().trim().max(500), source_ref: z.string().trim().max(1000) });
export const catalogMediaRefSchema = z.object({ id: uuid(), product_id: uuid() });

export function catalogMediaPath(workspaceId: string, userId: string, input: Pick<CatalogMediaInput, "product_id" | "media_id" | "mime_type">) {
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm" };
  return `${workspaceId}/products/${input.product_id}/${userId}/${input.media_id}.${extensions[input.mime_type]}`;
}

/** Reject disguised HTML/SVG/executables; never trust the filename or browser MIME alone. */
export function matchesCatalogMediaType(bytes: Uint8Array, mime: string) {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === "image/jpeg") return bytes.length >= 3 && starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return bytes.length >= 8 && starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === "image/webp") return bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (mime === "application/pdf") return bytes.length >= 5 && text(0, 5) === "%PDF-";
  if (mime === "video/mp4") return bytes.length >= 12 && text(4, 8) === "ftyp";
  if (mime === "video/webm") return bytes.length >= 4 && starts(0x1a, 0x45, 0xdf, 0xa3);
  return false;
}
