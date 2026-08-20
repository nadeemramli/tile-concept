import { z } from "zod";
import { optionalUuid, uuid } from "@/lib/zod";

export const SOURCE_KINDS = ["pdf", "image", "excel", "csv", "url", "manual"] as const;

export const registerAssetSchema = z.object({
  name: z.string().trim().min(1, "A file name is required").max(300),
  kind: z.enum(SOURCE_KINDS),
  checksum: z.string().trim().min(8, "A checksum is required so re-imports can be detected").max(128),
  storage_path: z.string().trim().max(500).optional().or(z.literal("")),
  mime_type: z.string().trim().max(200).optional().or(z.literal("")),
  size_bytes: z.number().int().nonnegative().optional(),
  page_count: z.number().int().nonnegative().optional(),
  supplier_id: optionalUuid(),
  brand_id: optionalUuid(),
  url: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type RegisterAssetInput = z.input<typeof registerAssetSchema>;

export const parseAssetSchema = z.object({ asset_id: uuid() });

export const signedUrlSchema = z.object({
  bucket: z.string().trim().min(1).max(64),
  path: z.string().trim().min(1).max(500),
});

export const approveSchema = z.object({
  review_item_id: uuid(),
  corrections: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type ApproveInput = z.input<typeof approveSchema>;

export const rejectSchema = z.object({
  review_item_id: uuid(),
  reason: z.string().trim().min(3, "Say why this row is being rejected").max(1000),
});
export type RejectInput = z.input<typeof rejectSchema>;

export const archiveSchema = z.object({ asset_id: uuid() });

/** Fields the reviewer may correct before approving. */
export const CORRECTABLE_FIELDS = [
  { key: "code", label: "Product code" },
  { key: "name", label: "Name" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "unit", label: "Price basis" },
  { key: "color", label: "Colour" },
  { key: "finish", label: "Finish" },
  { key: "material", label: "Material" },
  { key: "min_quantity", label: "Minimum quantity" },
  { key: "valid_from", label: "Valid from" },
  { key: "source_ref", label: "Source reference" },
] as const;
