import { uploadLargeQuotation } from "./upload-large-quotation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { finishVisitQuotationAction, prepareVisitQuotationAction } from "@/server/commands/visit-quotations";
import { QUOTATION_BUCKET, quotationContentType, type QueuedQuotation } from "./quotation-files";

/** The stable attachment ID makes retries safe after either network response is lost. */
export async function uploadQuotation(visitId: string, queued: QueuedQuotation) {
  const { file, id } = queued;
  const prepared = await prepareVisitQuotationAction({ visit_id: visitId, file_id: id, file_name: file.name, file_size: file.size });
  if (!prepared.ok) throw new Error(prepared.error);
  const storage = getBrowserSupabase().storage.from(QUOTATION_BUCKET);
  const contentType = quotationContentType(file.name)!;
  try {
    if (file.size > 6 * 1024 * 1024) await uploadLargeQuotation(prepared.data, file, contentType);
    else {
      const { error } = await storage.upload(prepared.data, file, { contentType, upsert: false });
      if (error) throw error;
    }
  } catch {
    // A previous upload may have succeeded before its response was interrupted.
    // Finish verifies the stored size/type and uploader in the database.
    const recovered = await finishVisitQuotationAction(visitId, id);
    if (recovered.ok) return;
    throw new Error("Upload could not be completed. Retry this file.");
  }
  const finished = await finishVisitQuotationAction(visitId, id);
  if (!finished.ok) throw new Error(finished.error);
}
