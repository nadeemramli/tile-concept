import { z } from "zod";
import { uuid } from "@/lib/zod";

export const QUOTATION_BUCKET = "visit-quotations";
export const QUOTATION_MAX_BYTES = 10 * 1024 * 1024;
export const QUOTATION_ACCEPT = ".xlsx,.xls,.pdf";
const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pdf: "application/pdf",
};
export function quotationContentType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return Object.hasOwn(MIME, ext) ? MIME[ext] : undefined;
}
export function quotationFileError(file: { name: string; size: number }) {
  if (!quotationContentType(file.name)) return "Choose an Excel (.xlsx or .xls) or PDF file.";
  if (!file.name.trim() || file.name.length > 255 || /[\x00-\x1f\x7f/\\]/.test(file.name)) return "Use a filename without slashes or control characters, up to 255 characters.";
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > QUOTATION_MAX_BYTES) return "Choose a non-empty file up to 10 MB.";
  return null;
}
export const quotationUploadSchema = z.object({
  visit_id: uuid(), file_id: uuid(),
  file_name: z.string(), file_size: z.number().int(),
}).superRefine((v, ctx) => {
  const message = quotationFileError({ name: v.file_name, size: v.file_size });
  if (message) ctx.addIssue({ code: "custom", message });
});
export interface QuotationFile {
  id: string;
  visit_id: string;
  file_name: string;
  file_size: number;
  uploaded_at: string | null;
  created_at: string;
}
export interface QueuedQuotation {
  id: string;
  file: File;
}
