import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { OPEN_LINK_STATES, type MediaReviewView } from "@/features/catalog/media-review-schema";

export interface MediaReviewRow {
  link_id: string;
  link_state: string;
  link_basis: string;
  link_basis_raw: string | null;
  confidence: number | null;
  page_number: number | null;
  source_code_raw: string | null;
  variant_candidate_key: string | null;
  product_variant_id: string | null;
  variant_sku: string | null;
  variant_name: string | null;
  product_id: string | null;
  product_name: string | null;
  product_code: string | null;
  link_reviewed_at: string | null;
  created_at: string;
  media_asset_id: string;
  asset_kind: string;
  mime_type: string | null;
  width_px: number | null;
  height_px: number | null;
  asset_state: string;
  usage_rights_state: string;
  rights_basis: string | null;
  source_path: string | null;
  source_web_url: string | null;
  source_asset_id: string | null;
  source_name: string | null;
  published_media_id: string | null;
  published_is_primary: boolean;
  /** Short-lived signed links; null when the object is missing or not readable. */
  image_url: string | null;
  page_url: string | null;
}

const PAGE_SIZE = 200;

/**
 * The imported media review queue. Reads api.media_review_queue under the
 * caller's own RLS and signs previews with the caller's own client, so a role
 * without catalogue review access gets neither rows nor objects.
 */
export async function getMediaReviewQueue(view: MediaReviewView, q?: string): Promise<{ rows: MediaReviewRow[]; total: number; truncated: boolean }> {
  const supabase = await createServerSupabase();
  let query = supabase.from("media_review_queue").select("*", { count: "exact" }).order("created_at", { ascending: true }).limit(PAGE_SIZE);
  // In progress: still needs a decision, or confirmed but not yet published.
  if (view === "open") query = query.or(`link_state.in.(${OPEN_LINK_STATES.join(",")}),and(link_state.eq.approved,published_media_id.is.null)`);
  else if (view === "approved") query = query.eq("link_state", "approved").is("published_media_id", null);
  else if (view === "published") query = query.not("published_media_id", "is", null);
  else if (view === "rejected") query = query.in("link_state", ["rejected", "superseded"]);
  const term = q?.trim().replace(/[%,()]/g, " ").trim();
  if (term) query = query.or(`source_name.ilike.%${term}%,source_code_raw.ilike.%${term}%,product_name.ilike.%${term}%,variant_sku.ilike.%${term}%,source_path.ilike.%${term}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const sign = async (bucket: string | null, path: string | null) => {
    if (!bucket || !path) return null;
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    return signed?.signedUrl ?? null;
  };
  const mapped = await Promise.all(rows.map(async (r): Promise<MediaReviewRow> => ({
    link_id: r.link_id!,
    link_state: r.link_state ?? "pending_review",
    link_basis: r.link_basis ?? "manual_match",
    link_basis_raw: r.link_basis_raw,
    confidence: r.confidence === null ? null : Number(r.confidence),
    page_number: r.page_number,
    source_code_raw: r.source_code_raw,
    variant_candidate_key: r.variant_candidate_key,
    product_variant_id: r.product_variant_id,
    variant_sku: r.variant_sku,
    variant_name: r.variant_name,
    product_id: r.product_id,
    product_name: r.product_name,
    product_code: r.product_code,
    link_reviewed_at: r.link_reviewed_at,
    created_at: r.created_at!,
    media_asset_id: r.media_asset_id!,
    asset_kind: r.asset_kind ?? "other",
    mime_type: r.mime_type,
    width_px: r.width_px,
    height_px: r.height_px,
    asset_state: r.asset_state ?? "pending_review",
    usage_rights_state: r.usage_rights_state ?? "unreviewed",
    rights_basis: r.rights_basis,
    source_path: r.source_path,
    source_web_url: r.source_web_url,
    source_asset_id: r.source_asset_id,
    source_name: r.source_name,
    published_media_id: r.published_media_id,
    published_is_primary: !!r.published_is_primary,
    image_url: await sign(r.storage_bucket, r.object_path),
    page_url: r.page_object_path && r.page_object_path !== r.object_path ? await sign(r.page_bucket, r.page_object_path) : null,
  })));
  return { rows: mapped, total: count ?? mapped.length, truncated: (count ?? 0) > mapped.length };
}

export interface MediaCoverage {
  generated_at: string;
  source: string;
  products: { total: number; with_published_image: number; with_primary_image: number; evidence_pending_only: number; no_known_evidence: number };
  variants: { total: number; with_published_image: number };
  media_assets: { total: number; by_review_state: Record<string, number>; by_rights_state: Record<string, number>; last_imported_at: string | null };
  associations: { by_state: Record<string, number>; pending_by_basis: Record<string, number>; pending_without_variant: number };
  catalogue_media: { active_published: number; active_unreviewed: number; from_imported_evidence: number; archived: number; primary_failing_gate: number };
  commercial_proposals: { price_candidates_by_state: Record<string, number>; review_items_pending: number };
  last_media_decision_at: string | null;
  sources: { source_asset_id: string; name: string; assets: number; rights_unknown: number; pending: number; approved: number; rejected: number; published: number }[];
}

/** Live counts from api.catalog_media_coverage(); nothing here is cached or estimated. */
export async function getMediaCoverage(): Promise<MediaCoverage> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("catalog_media_coverage");
  if (error) throw new Error(error.message);
  return data as unknown as MediaCoverage;
}

/** Variants a reviewer can assign an image to, by SKU, supplier code or product name. */
export async function searchVariantsForMedia(term: string) {
  const supabase = await createServerSupabase();
  const t = term.trim().replace(/[%,()]/g, " ").trim();
  if (t.length < 2) return [];
  const { data: byCode } = await supabase.from("product_variants").select("id, sku, name, supplier_code, product_id").or(`sku.ilike.%${t}%,supplier_code.ilike.%${t}%,name.ilike.%${t}%`).limit(20);
  const { data: products } = await supabase.from("products").select("id").ilike("name", `%${t}%`).limit(20);
  const productIds = (products ?? []).map((p) => p.id!);
  const { data: byProduct } = productIds.length ? await supabase.from("product_variants").select("id, sku, name, supplier_code, product_id").in("product_id", productIds).limit(20) : { data: [] };
  const variants = [...new Map([...(byCode ?? []), ...(byProduct ?? [])].map((v) => [v.id!, v])).values()].slice(0, 20);
  const ids = [...new Set(variants.map((v) => v.product_id!))];
  const { data: names } = ids.length ? await supabase.from("products").select("id, name").in("id", ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((p) => [p.id!, p.name ?? ""]));
  return variants.map((v) => ({ id: v.id!, label: [nameOf.get(v.product_id!) ?? "Product", v.sku ?? v.supplier_code ?? v.name].filter(Boolean).join(" · ") }));
}
