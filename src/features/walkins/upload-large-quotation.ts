import { getBrowserSupabase } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { QUOTATION_BUCKET } from "./quotation-files";

const CHUNK_SIZE = 6 * 1024 * 1024;

/** Large files use the project's existing TUS convention and user-session authorization. */
export async function uploadLargeQuotation(path: string, file: File, contentType: string) {
  const { Upload } = await import("tus-js-client");
  const { data: { session }, error } = await getBrowserSupabase().auth.getSession();
  if (error || !session) throw new Error("Sign in again to upload your quotation.");
  const endpoint = new URL(publicEnv.supabaseUrl);
  if (/^[^.]+\.supabase\.co$/.test(endpoint.hostname)) {
    endpoint.hostname = endpoint.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  endpoint.pathname = "/storage/v1/upload/resumable";
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: endpoint.toString(),
      chunkSize: CHUNK_SIZE,
      retryDelays: [0, 1000, 3000],
      headers: { authorization: "Bearer " + session.access_token, apikey: publicEnv.supabasePublishableKey },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Scope resumption to this user and attachment, never just the filename.
      fingerprint: async () => [endpoint.origin, session.user.id, path, file.size, file.lastModified].join("|"),
      metadata: { bucketName: QUOTATION_BUCKET, objectName: path, contentType, cacheControl: "3600" },
      onError: () => reject(new Error("Upload could not be completed. Retry this file.")),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}
