/**
 * Import the discovery corpus into Postgres.
 *
 * Everything written here is evidence or a proposal. Source assets, immutable
 * versions, raw observations, and the import audit trail may be complete while
 * every commercial fact stays `pending_review`: this importer never publishes a
 * product, price, certificate, semantic visual label, or product image.
 *
 * Idempotency is carried by the corpus's own stable ids (`variant_65a1f653…`,
 * `media_d37db14c…`) plus the Drive file id, all of which are unique per
 * workspace in the schema. Re-importing an unchanged corpus therefore updates
 * rows in place and creates none.
 */

import {
  BUCKET_MEDIA,
  BUCKET_SOURCE,
  DEFERRED_SOURCE_IDS,
  EXCLUDED_SOURCE_IDS,
  REL,
  ROOT_CODE_TO_NAME,
  assetKindFor,
  canonicalLinkBasis,
  canonicalObservationBasis,
  chunk,
  corpusPath,
  exactDecimal,
  heading,
  imageObjectKey,
  listFiles,
  nz,
  pageObjectKey,
  readJsonl,
  sourceObjectKey,
  strArray,
  supplyModelFor,
  withRetry,
  type ApiClient,
  type Cli,
} from "./lib.mts";
import type { DriveFile, MediaAssetRecord } from "./plan.mts";

const BATCH = 500;

export interface ImportCounts {
  [table: string]: number;
}

type Row = Record<string, unknown>;

/** Upsert in batches on the table's natural key. Retries only retryable errors. */
async function upsert(supabase: ApiClient, table: string, rows: Row[], onConflict: string): Promise<number> {
  return write(supabase, table, rows, onConflict, false);
}

/**
 * Insert only what is missing.
 *
 * For an append-only table an upsert would try to UPDATE the rows that are
 * already there, which the table refuses by design. Re-importing an unchanged
 * observation should be a no-op, and DO NOTHING says exactly that.
 */
async function insertIfAbsent(supabase: ApiClient, table: string, rows: Row[], onConflict: string): Promise<number> {
  return write(supabase, table, rows, onConflict, true);
}

async function write(
  supabase: ApiClient,
  table: string,
  rows: Row[],
  onConflict: string,
  ignoreDuplicates: boolean,
): Promise<number> {
  let n = 0;
  for (const batch of chunk(rows, BATCH)) {
    await withRetry(`${table} x${batch.length}`, async () => {
      const { error } = await supabase.from(table).upsert(batch, { onConflict, ignoreDuplicates });
      if (error) throw new Error(`${table}: ${error.message}`);
    });
    n += batch.length;
  }
  return n;
}

async function selectAll(supabase: ApiClient, table: string, cols: string, workspaceId: string): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .eq("workspace_id", workspaceId)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function importCorpus(
  supabase: ApiClient,
  cli: Cli,
  workspaceId: string,
  importRunId: string,
): Promise<ImportCounts> {
  const counts: ImportCounts = {};
  const only = cli.only?.split(",").map((s) => s.trim());
  const want = (stage: string) => !only || only.includes(stage);

  // ---------------------------------------------------------------------------
  // 1. Source collections, locations, assets, versions
  // ---------------------------------------------------------------------------
  const driveFiles: DriveFile[] = [];
  const driveFolders: DriveFile[] = [];
  for await (const r of readJsonl<DriveFile>(corpusPath(cli, REL.driveInventory))) {
    (r.kind === "folder" ? driveFolders : driveFiles).push(r);
  }

  if (want("sources")) {
    heading("Sources");

    const rootCodes = [...new Set(driveFiles.map((f) => f.root_code))];
    counts.source_collections = await upsert(
      supabase,
      "source_collections",
      rootCodes.map((code) => ({
        workspace_id: workspaceId,
        code,
        name: ROOT_CODE_TO_NAME[code] ?? code,
        supply_model: supplyModelFor(code),
        provider: "google_drive",
        status: "active",
      })),
      "workspace_id,code",
    );

    const collections = await selectAll(supabase, "source_collections", "id, code", workspaceId);
    const collectionIdByCode = new Map(collections.map((c) => [String(c.code), String(c.id)]));

    // Folders first without parents, then a second pass to link them: the
    // manifest is not ordered parent-before-child.
    counts.source_locations = await upsert(
      supabase,
      "source_locations",
      driveFolders.map((f) => ({
        workspace_id: workspaceId,
        source_collection_id: collectionIdByCode.get(f.root_code),
        provider: "google_drive",
        external_id: f.id,
        name: f.name,
        display_path: f.path,
        location_type: "folder",
        brand_hint: brandHintFromPath(f.path),
        web_url: f.url,
        access_state: "readable",
        last_scanned_at: new Date(`${cliCutoff()}T00:00:00Z`).toISOString(),
      })),
      "workspace_id,provider,external_id",
    );

    const locations = await selectAll(supabase, "source_locations", "id, external_id", workspaceId);
    const locationIdByExternal = new Map(locations.map((l) => [String(l.external_id), String(l.id)]));

    const parentUpdates = driveFolders
      .filter((f) => f.parent_folder_id && locationIdByExternal.has(f.parent_folder_id))
      .map((f) => ({
        workspace_id: workspaceId,
        provider: "google_drive",
        external_id: f.id,
        source_collection_id: collectionIdByCode.get(f.root_code),
        name: f.name,
        parent_id: locationIdByExternal.get(f.parent_folder_id!),
      }));
    await upsert(supabase, "source_locations", parentUpdates, "workspace_id,provider,external_id");

    // Checksums for staged binaries come from the visual manifest, which
    // recomputed SHA-256 over every staged file.
    const shaBySource = new Map<string, { sha: string; size: number; fileName: string; collection: string }>();
    for await (const m of readJsonl<MediaAssetRecord>(corpusPath(cli, REL.mediaAssets))) {
      if (m.asset_kind === "source_pdf" || m.asset_kind === "standalone_image") {
        shaBySource.set(m.source_id, {
          sha: m.sha256,
          size: m.size_bytes ?? 0,
          fileName: m.file_name,
          collection: driveFiles.find((f) => f.id === m.source_id)?.root_code ?? "unknown",
        });
      }
    }

    const assetRows: Row[] = [];
    const versionRows: Row[] = [];

    for (const f of driveFiles) {
      const excluded = EXCLUDED_SOURCE_IDS.has(f.id);
      const deferred = DEFERRED_SOURCE_IDS.has(f.id);
      const staged = shaBySource.get(f.id);

      const snapshotState = excluded
        ? "excluded_by_policy"
        : deferred
          ? "binary_not_staged"
          : staged
            ? "uploaded"
            : "connector_text_only";

      // A version needs an identity even when no bytes were staged. Say plainly
      // that this is a provider revision marker, not a content hash.
      const checksum = staged ? staged.sha : `unstaged:${f.id}:${f.modified_time ?? "unknown"}`;

      assetRows.push({
        workspace_id: workspaceId,
        name: f.name,
        kind: assetKindFor(f.mime_type),
        provider: "google_drive",
        external_id: f.id,
        asset_class: excluded ? "other" : classifyAsset(f),
        source_location_id: locationIdByExternal.get(f.parent_folder_id ?? "") ?? null,
        checksum,
        mime_type: f.mime_type,
        size_bytes: f.size ? Number(f.size) : null,
        storage_bucket: staged && !excluded ? BUCKET_SOURCE : null,
        storage_path:
          staged && !excluded
            ? sourceObjectKey(workspaceId, staged.collection, f.id, staged.sha, staged.fileName)
            : null,
        url: f.url,
        source_web_url: f.url,
        status: excluded ? "archived" : "uploaded",
      });

      versionRows.push({
        _external_id: f.id, // stripped below; used to resolve the asset id
        version_no: 1,
        checksum,
        workspace_id: workspaceId,
        size_bytes: f.size ? Number(f.size) : null,
        mime_type: f.mime_type,
        modified_at_source: f.modified_time,
        snapshot_state: snapshotState,
        storage_bucket: staged && !excluded ? BUCKET_SOURCE : null,
        storage_path:
          staged && !excluded
            ? sourceObjectKey(workspaceId, staged.collection, f.id, staged.sha, staged.fileName)
            : null,
      });
    }

    counts.source_assets = await upsert(supabase, "source_assets", assetRows, "workspace_id,provider,external_id");

    const assets = await selectAll(supabase, "source_assets", "id, external_id", workspaceId);
    const assetIdByExternal = new Map(
      assets.filter((a) => a.external_id).map((a) => [String(a.external_id), String(a.id)]),
    );

    counts.source_asset_versions = await upsert(
      supabase,
      "source_asset_versions",
      versionRows
        .filter((v) => assetIdByExternal.has(String(v._external_id)))
        .map(({ _external_id, ...v }) => ({ ...v, source_asset_id: assetIdByExternal.get(String(_external_id)) })),
      "source_asset_id,checksum",
    );

    globalThis.__corpusAssetIds = assetIdByExternal;
  }

  const assetIdByExternal: Map<string, string> =
    globalThis.__corpusAssetIds ??
    new Map(
      (await selectAll(supabase, "source_assets", "id, external_id", workspaceId))
        .filter((a) => a.external_id)
        .map((a) => [String(a.external_id), String(a.id)]),
    );

  const versionIdByAsset = new Map(
    (await selectAll(supabase, "source_asset_versions", "id, source_asset_id", workspaceId)).map((v) => [
      String(v.source_asset_id),
      String(v.id),
    ]),
  );

  const assetId = (externalSourceId: string) => assetIdByExternal.get(externalSourceId) ?? null;
  const versionId = (externalSourceId: string) => {
    const a = assetId(externalSourceId);
    return a ? (versionIdByAsset.get(a) ?? null) : null;
  };

  // ---------------------------------------------------------------------------
  // 1b. Brands, from the corpus folder labels
  //
  // The Source Register is explicit that a Drive folder label is a provenance
  // hint, not a canonical organization identity - the same name can mean the
  // brand, the manufacturer, the supplier, or all three. So these are created
  // `unreviewed`, with the folder they came from recorded, and a person decides
  // what each one actually is. They exist at all because the review gate needs a
  // brand to point at, and inventing them by hand would lose the provenance.
  // ---------------------------------------------------------------------------
  if (want("brands")) {
    heading("Brands");
    const hints = new Map<string, string>();
    for await (const f of readJsonl<DriveFile>(corpusPath(cli, REL.driveInventory))) {
      if (f.kind !== "file" || EXCLUDED_SOURCE_IDS.has(f.id)) continue;
      const brand = brandHintFromPath(f.path);
      if (brand && !hints.has(brand)) hints.set(brand, f.root_name);
    }

    // merch.brands is unique on a generated normalized_name, which cannot be an
    // upsert conflict target, so diff against what is already there.
    const existing = new Set(
      (await selectAll(supabase, "brands", "id, name", workspaceId)).map((b) => normalizeName(String(b.name))),
    );
    const missing = [...hints.entries()].filter(([name]) => !existing.has(normalizeName(name)));

    if (missing.length) {
      const { error } = await supabase.from("brands").insert(
        missing.map(([name, root]) => ({
          workspace_id: workspaceId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          is_house_brand: false,
          review_state: "unreviewed",
          source_note: `Drive folder label under ${root} (2026-08-21 corpus); not a confirmed organization identity`,
        })),
      );
      if (error) throw new Error(`brands: ${error.message}`);
    }
    counts.brands = hints.size;
    counts.brands_created = missing.length;
  }

  // ---------------------------------------------------------------------------
  // 2. Shape profiles and clusters
  // ---------------------------------------------------------------------------
  if (want("shapes")) {
    heading("Document shapes");
    const profiles: Row[] = [];
    for await (const p of readJsonl<Row>(corpusPath(cli, REL.shapeProfiles))) {
      const sid = String(p.source_id);
      if (EXCLUDED_SOURCE_IDS.has(sid)) continue; // never read or store the credentials profile
      profiles.push({
        workspace_id: workspaceId,
        external_source_id: sid,
        source_asset_id: assetId(sid),
        source_version_id: versionId(sid),
        source_path: p.source_path,
        brand_hint: p.brand_hint,
        document_class: p.document_class,
        likely_grain: p.likely_grain,
        extraction: p.extraction ?? {},
        text_metrics: p.text_metrics ?? {},
        language_signals: strArray(p.language_signals),
        observed_fields: p.observed_fields ?? {},
        review_state: "pending_review",
        safe_for_schema_learning: Boolean((p.review as Row | undefined)?.safe_for_schema_learning),
        notes: nz((p.review as Row | undefined)?.notes),
      });
    }
    counts.shape_profiles = await upsert(supabase, "shape_profiles", profiles, "workspace_id,external_source_id");

    const clusters: Row[] = [];
    for await (const c of readJsonl<Row>(corpusPath(cli, REL.shapeClusters))) {
      clusters.push({
        workspace_id: workspaceId,
        cluster_key: c.cluster_id,
        root_name: c.root_name,
        document_class: c.document_class,
        mime_type: c.mime_type,
        extraction_method: c.extraction_method,
        layout_hint: c.layout_hint,
        document_count: Number(c.document_count ?? 0),
        representative_source_id: c.representative_source_id,
        representative_source_path: c.representative_source_path,
        member_source_ids: strArray(c.member_source_ids),
        review_state: "pending_review",
      });
    }
    counts.shape_clusters = await upsert(supabase, "shape_clusters", clusters, "workspace_id,cluster_key");
  }

  // ---------------------------------------------------------------------------
  // 3. Candidates — records first, then the typed detail tables
  // ---------------------------------------------------------------------------
  if (want("candidates")) {
    heading("Candidates");

    const records: Row[] = [];
    /**
     * Per-field facts.
     *
     * The typed tables hold the row; the facts hold each field's raw label, the
     * normalized proposal, and whether the source actually established it.
     * `incomplete` here is what makes "the source never said which currency"
     * queryable instead of merely absent.
     */
    const facts: { candidateKey: string; fields: FactInput[] }[] = [];
    const pushRecord = (type: string, key: string, sid: string, locator: unknown, confidence?: unknown, rule?: unknown) => {
      records.push({
        workspace_id: workspaceId,
        import_run_id: importRunId,
        candidate_record_type: type,
        candidate_key: key,
        source_asset_id: assetId(sid),
        source_version_id: versionId(sid),
        source_locator: locator ?? {},
        group_confidence: confidence == null ? null : Number(confidence),
        extraction_rule: rule ?? null,
        validation_state: "unvalidated",
        review_state: "pending_review",
      });
    };

    const catalogRows: Row[] = [];
    for await (const c of readJsonl<Row>(corpusPath(cli, REL.catalogEditions))) {
      const sid = String(c.source_id);
      pushRecord("catalog_edition", String(c.candidate_id), sid, {});
      catalogRows.push({
        workspace_id: workspaceId,
        candidate_key: c.candidate_id,
        source_asset_id: assetId(sid),
        external_source_id: sid,
        source_path: c.source_path,
        root_name: c.root_name,
        brand_hint: c.brand_hint,
        name_candidate: c.name_candidate,
        edition_label_candidate: c.edition_label_candidate,
        publication_date_candidate: c.publication_date_candidate,
        language_signals: strArray(c.language_signals),
        review_state: "pending_review",
      });
    }

    const variantRows: Row[] = [];
    for await (const v of readJsonl<Row>(corpusPath(cli, REL.variants))) {
      const sid = String(v.source_id);
      pushRecord("product_variant", String(v.candidate_id), sid, v.source_locator, v.confidence, v.extraction_rule);
      variantRows.push({
        workspace_id: workspaceId,
        candidate_key: v.candidate_id,
        source_asset_id: assetId(sid),
        external_source_id: sid,
        source_path: v.source_path,
        root_name: v.root_name,
        brand_hint: v.brand_hint,
        family_name_candidate: v.family_name_candidate,
        supplier_code_raw: v.supplier_code_raw,
        dimensions_raw: strArray(v.dimensions_raw),
        material_raw: v.material_raw,
        finish_raw: v.finish_raw,
        status_raw: v.status_raw,
        package_raw: v.package_raw,
        extraction_rule: v.extraction_rule,
        source_locator: v.source_locator ?? {},
        raw_excerpt: v.raw_excerpt,
        confidence: v.confidence == null ? null : Number(v.confidence),
        review_state: "pending_review",
      });
      facts.push({
        candidateKey: String(v.candidate_id),
        fields: [
          fact("supplier_code", "supplier code", v.supplier_code_raw, v.supplier_code_raw, v),
          fact("family_name", "family or series", v.family_name_candidate, v.family_name_candidate, v),
          fact("dimensions", "dimensions", strArray(v.dimensions_raw).join(" "), strArray(v.dimensions_raw), v),
          fact("material", "material", v.material_raw, v.material_raw, v),
          fact("finish", "finish", v.finish_raw, v.finish_raw, v),
          fact("status", "lifecycle status", v.status_raw, v.status_raw, v),
          fact("packaging", "packaging", v.package_raw, v.package_raw, v),
        ],
      });
    }

    const priceRows: Row[] = [];
    for await (const p of readJsonl<Row>(corpusPath(cli, REL.prices))) {
      const sid = String(p.source_id);
      pushRecord("price_entry", String(p.candidate_id), sid, p.source_locator, p.confidence, p.extraction_rule);
      priceRows.push({
        workspace_id: workspaceId,
        candidate_key: p.candidate_id,
        source_asset_id: assetId(sid),
        external_source_id: sid,
        source_path: p.source_path,
        brand_hint: p.brand_hint,
        variant_candidate_key: p.product_variant_candidate_id,
        product_code_candidate: p.product_code_candidate,
        amount_raw: String(p.amount_raw ?? ""),
        // Exact decimal string: a float would already have rounded it.
        amount_normalized: exactDecimal(p.amount_normalized),
        currency_code: nz(p.currency_code),
        price_type_raw: p.price_type_raw,
        unit_basis: nz(p.unit_basis),
        tax_basis: nz(p.tax_basis) ?? "unknown",
        effective_date_raw: nz(p.effective_date_raw),
        source_locator: p.source_locator ?? {},
        extraction_rule: p.extraction_rule,
        confidence: p.confidence == null ? null : Number(p.confidence),
        validation_flags: p.validation_flags ?? [],
        review_state: "pending_review",
      });
      facts.push({
        candidateKey: String(p.candidate_id),
        fields: [
          fact("amount", "amount", p.amount_raw, exactDecimal(p.amount_normalized), p),
          fact("currency_code", "currency", p.currency_code, p.currency_code, p),
          fact("unit_basis", "unit basis", p.unit_basis, p.unit_basis, p),
          // 'unknown' is an honest extraction result and must not read as resolved.
          fact("tax_basis", "tax basis", p.tax_basis, nz(p.tax_basis) === "unknown" ? null : p.tax_basis, p),
          fact("price_type", "price type or tier", p.price_type_raw, p.price_type_raw, p),
          fact("effective_date", "effective date", p.effective_date_raw, p.effective_date_raw, p),
          fact("product_code", "product code", p.product_code_candidate, p.product_code_candidate, p),
        ],
      });
    }

    const certRows: Row[] = [];
    for await (const c of readJsonl<Row>(corpusPath(cli, REL.certificates))) {
      const sid = String(c.source_id);
      pushRecord("certificate", String(c.candidate_id), sid, c.source_locator, c.confidence, c.extraction_rule);
      certRows.push({
        workspace_id: workspaceId,
        candidate_key: c.candidate_id,
        source_asset_id: assetId(sid),
        external_source_id: sid,
        source_path: c.source_path,
        root_name: c.root_name,
        brand_hint: c.brand_hint,
        title_candidate: c.title_candidate,
        certificate_number_candidates: strArray(c.certificate_number_candidates),
        filename_identifier_candidates: strArray(c.filename_identifier_candidates),
        certificate_type_signal_candidates: strArray(c.certificate_type_signal_candidates),
        standard_candidates: strArray(c.standard_candidates),
        date_candidates: strArray(c.date_candidates),
        filename_date_candidates: strArray(c.filename_date_candidates),
        role_candidates: c.role_candidates ?? {},
        // A folder location never establishes scope.
        scope_type: nz(c.scope_type) ?? "unknown",
        scope_text_raw: c.scope_text_raw,
        extraction_rule: c.extraction_rule,
        source_locator: c.source_locator ?? {},
        confidence: c.confidence == null ? null : Number(c.confidence),
        validation_flags: c.validation_flags ?? [],
        review_state: "pending_review",
      });
      facts.push({
        candidateKey: String(c.candidate_id),
        fields: [
          fact("title", "title", c.title_candidate, c.title_candidate, c),
          fact("certificate_number", "certificate number", strArray(c.certificate_number_candidates).join(", "), strArray(c.certificate_number_candidates), c),
          fact("standard", "standard", strArray(c.standard_candidates).join(", "), strArray(c.standard_candidates), c),
          fact("issued_or_expiry_dates", "dates", strArray(c.date_candidates).join(", "), strArray(c.date_candidates), c),
          // A folder location never establishes scope, so this fact is
          // incomplete by construction until a reviewer resolves it.
          fact("scope", "scope", c.scope_text_raw, nz(c.scope_type) === "unknown" ? null : c.scope_type, c),
        ],
      });
    }

    const amountRows: Row[] = [];
    for await (const a of readJsonl<Row>(corpusPath(cli, REL.amounts))) {
      const sid = String(a.source_id);
      pushRecord("commercial_amount_observation", String(a.observation_id), sid, a.source_locator);
      amountRows.push({
        workspace_id: workspaceId,
        observation_key: a.observation_id,
        observation_type: a.observation_type ?? "commercial_amount_unresolved",
        source_asset_id: assetId(sid),
        external_source_id: sid,
        source_path: a.source_path,
        brand_hint: a.brand_hint,
        amount_raw: a.amount_raw,
        amount_normalized: exactDecimal(a.amount_normalized),
        currency_code: nz(a.currency_code),
        source_locator: a.source_locator ?? {},
        raw_excerpt: a.raw_excerpt,
        reason_not_price_candidate: a.reason_not_price_candidate,
        review_state: "retained_raw_observation",
      });
    }

    const dupeRows: Row[] = [];
    for await (const g of readJsonl<Row>(corpusPath(cli, REL.duplicates))) {
      dupeRows.push({
        workspace_id: workspaceId,
        group_key: g.duplicate_group_id,
        brand_hint: g.brand_hint,
        supplier_code_normalized: g.supplier_code_normalized,
        candidate_count: Number(g.candidate_count ?? 0),
        source_count: Number(g.source_count ?? 0),
        candidate_keys: strArray(g.candidate_ids),
        external_source_ids: strArray(g.source_ids),
        resolution_state: "unreviewed",
      });
    }

    const issueRows: Row[] = [];
    for await (const i of readJsonl<Row>(corpusPath(cli, REL.validationIssues))) {
      const sid = nz(i.source_id);
      const severityRaw = nz(i.severity);
      issueRows.push({
        workspace_id: workspaceId,
        issue_key: i.issue_id,
        external_source_id: sid,
        source_asset_id: sid ? assetId(sid) : null,
        issue_type: i.issue_type,
        severity: severityLevel(severityRaw),
        severity_raw: severityRaw,
        affected_candidate_count: i.affected_candidate_count == null ? null : Number(i.affected_candidate_count),
        // details is prose in the corpus, so keep it addressable rather than
        // pretending it was already structured.
        details: typeof i.details === "string" ? { text: i.details } : (i.details ?? {}),
        review_state: "pending_review",
      });
    }

    counts.candidate_records = await upsert(supabase, "candidate_records", records, "workspace_id,candidate_key");
    counts.catalog_edition_candidates = await upsert(supabase, "catalog_edition_candidates", catalogRows, "workspace_id,candidate_key");
    counts.variant_candidates = await upsert(supabase, "variant_candidates", variantRows, "workspace_id,candidate_key");
    counts.price_candidates = await upsert(supabase, "price_candidates", priceRows, "workspace_id,candidate_key");
    counts.certificate_candidates = await upsert(supabase, "certificate_candidates", certRows, "workspace_id,candidate_key");
    counts.commercial_amount_observations = await upsert(supabase, "commercial_amount_observations", amountRows, "workspace_id,observation_key");
    counts.duplicate_code_groups = await upsert(supabase, "duplicate_code_groups", dupeRows, "workspace_id,group_key");
    counts.corpus_validation_issues = await upsert(supabase, "corpus_validation_issues", issueRows, "workspace_id,issue_key");

    const recordIdByKey = new Map(
      (await selectAll(supabase, "candidate_records", "id, candidate_key", workspaceId)).map((r) => [
        String(r.candidate_key),
        String(r.id),
      ]),
    );
    const factRows: Row[] = [];
    for (const group of facts) {
      const recordId = recordIdByKey.get(group.candidateKey);
      if (!recordId) continue;
      for (const f of group.fields) {
        if (f.rawValue === null && f.normalized === null) continue; // nothing observed at all
        factRows.push({
          workspace_id: workspaceId,
          candidate_record_id: recordId,
          field_path: f.path,
          raw_label: f.label,
          raw_value: f.rawValue,
          normalized_value: f.normalized === null ? null : JSON.stringify(f.normalized),
          source_page: f.page,
          source_region: f.region,
          confidence: f.confidence,
          validation_state: f.normalized === null ? "incomplete" : "valid",
          mapping_rule_version: f.rule,
        });
      }
    }
    counts.candidate_facts = await upsert(supabase, "candidate_facts", factRows, "candidate_record_id,field_path");
  }

  // ---------------------------------------------------------------------------
  // 4. Visual evidence
  // ---------------------------------------------------------------------------
  if (want("visual")) {
    heading("Visual evidence");

    const parents: Row[] = [];
    const derived: MediaAssetRecord[] = [];

    for await (const m of readJsonl<MediaAssetRecord>(corpusPath(cli, REL.mediaAssets))) {
      if (EXCLUDED_SOURCE_IDS.has(m.source_id) || DEFERRED_SOURCE_IDS.has(m.source_id)) continue;
      if (m.asset_kind === "pdf_page_render") {
        derived.push(m);
        continue;
      }
      parents.push(mediaRow(m, workspaceId, null));
    }
    counts.media_assets = await upsert(supabase, "media_assets", parents, "workspace_id,external_key");

    // Page renders hang off their source PDF so a crop always retains its page
    // and a page always retains its document.
    const parentIdBySource = new Map(
      (await selectAll(supabase, "media_assets", "id, external_key, source_asset_id, asset_kind", workspaceId))
        .filter((r) => r.asset_kind === "source_pdf")
        .map((r) => [String(r.source_asset_id), String(r.id)]),
    );

    const renderRows = derived.map((m) => {
      const a = assetId(m.source_id);
      return mediaRow(m, workspaceId, a ? (parentIdBySource.get(a) ?? null) : null);
    });
    counts.media_assets += await upsert(supabase, "media_assets", renderRows, "workspace_id,external_key");

    const mediaIdByExternal = new Map(
      (await selectAll(supabase, "media_assets", "id, external_key", workspaceId)).map((r) => [
        String(r.external_key),
        String(r.id),
      ]),
    );

    // Pixel measurements. These are reproducible image statistics, not product
    // colour: they land as evidence and stay pending.
    const observations: Row[] = [];
    for await (const o of readJsonl<Row>(corpusPath(cli, REL.visualObservations))) {
      const mid = mediaIdByExternal.get(String(o.media_asset_id));
      if (!mid) continue;
      observations.push({
        workspace_id: workspaceId,
        media_asset_id: mid,
        external_key: o.visual_observation_id,
        observation_scope: o.observation_scope,
        observation_type: "pixel_profile",
        observation_basis: canonicalObservationBasis(String(o.observation_basis)),
        observation_basis_raw: o.observation_basis,
        value: {
          palette: o.palette ?? [],
          dominant_color_families: o.dominant_color_families ?? [],
          mean_brightness: o.mean_brightness,
          mean_saturation: o.mean_saturation,
          luminance_std: o.luminance_std,
          edge_density: o.edge_density,
          surface_complexity_proxy: o.surface_complexity_proxy,
        },
        confidence: o.confidence == null ? null : Number(o.confidence),
        page_number: o.page_number == null ? null : Number(o.page_number),
        physical_size_inferred_from_pixels: false,
        review_state: "pending_review",
      });
    }

    for await (const o of readJsonl<Row>(corpusPath(cli, REL.semanticObservations))) {
      const mid = mediaIdByExternal.get(String(o.media_asset_id));
      if (!mid) continue;
      if (o.physical_size_inferred_from_pixels === true) {
        throw new Error(`semantic observation ${o.semantic_visual_observation_id} claims a pixel-derived size`);
      }
      observations.push({
        workspace_id: workspaceId,
        media_asset_id: mid,
        external_key: o.semantic_visual_observation_id,
        observation_scope: o.observation_scope,
        observation_type: "semantic_visual_candidates",
        observation_basis: canonicalObservationBasis(String(o.observation_basis)),
        observation_basis_raw: o.observation_basis,
        value: {
          color_family_candidates: o.color_family_candidates ?? [],
          pattern_candidates: o.pattern_candidates ?? [],
          shape_candidates: o.shape_candidates ?? [],
          application_candidates: o.application_candidates ?? [],
          scene_or_swatch: o.scene_or_swatch,
          product_visual_present: o.product_visual_present,
          contact_sheet: o.contact_sheet,
          contact_sheet_label: o.contact_sheet_label,
        },
        confidence: o.confidence == null ? null : Number(o.confidence),
        physical_size_inferred_from_pixels: false,
        // Machine-complete, human-pending. Not an approved product attribute.
        review_state: "machine_visual_review_complete_human_approval_pending",
      });
    }
    counts.visual_observations = await insertIfAbsent(supabase, "visual_observations", observations, "workspace_id,external_key");

    const variantIdByKey = new Map(
      (await selectAll(supabase, "variant_candidates", "id, candidate_key", workspaceId)).map((r) => [
        String(r.candidate_key),
        String(r.id),
      ]),
    );

    const links: Row[] = [];
    for await (const l of readJsonl<Row>(corpusPath(cli, REL.assetVariantLinks))) {
      const mid = mediaIdByExternal.get(String(l.media_asset_id));
      if (!mid) continue;
      links.push({
        workspace_id: workspaceId,
        media_asset_id: mid,
        external_key: l.asset_variant_link_id,
        variant_candidate_key: l.variant_candidate_id,
        variant_candidate_id: variantIdByKey.get(String(l.variant_candidate_id)) ?? null,
        source_code_raw: l.supplier_code_raw,
        link_basis: canonicalLinkBasis(String(l.link_basis)),
        link_basis_raw: l.link_basis,
        confidence: l.confidence == null ? null : Number(l.confidence),
        review_state: "pending_review",
      });
    }
    counts.media_asset_variant_links = await upsert(supabase, "media_asset_variant_links", links, "workspace_id,external_key");

    const sheetNames = await listFiles(corpusPath(cli, REL.contactSheets));
    counts.contact_sheets = await upsert(
      supabase,
      "contact_sheets",
      sheetNames.map((name) => ({
        workspace_id: workspaceId,
        sheet_key: name,
        storage_bucket: "ingest-artifacts",
        object_path: `${workspaceId}/contact-sheets/${name}`,
      })),
      "workspace_id,sheet_key",
    );

    const sheetIdByKey = new Map(
      (await selectAll(supabase, "contact_sheets", "id, sheet_key", workspaceId)).map((r) => [
        String(r.sheet_key),
        String(r.id),
      ]),
    );
    const sheetItems: Row[] = [];
    for await (const s of readJsonl<Row>(corpusPath(cli, REL.contactSheetIndex))) {
      const sheet = sheetIdByKey.get(String(s.contact_sheet));
      const mid = mediaIdByExternal.get(String(s.media_asset_id));
      if (!sheet || !mid) continue;
      sheetItems.push({
        workspace_id: workspaceId,
        contact_sheet_id: sheet,
        media_asset_id: mid,
        label: s.label,
        source_path: s.source_path,
      });
    }
    counts.contact_sheet_items = await upsert(supabase, "contact_sheet_items", sheetItems, "contact_sheet_id,label");
  }

  // ---------------------------------------------------------------------------
  // 5. Review queues
  // ---------------------------------------------------------------------------
  if (want("review")) {
    heading("Review queues");
    const tasks: Row[] = [];

    for await (const t of readJsonl<Row>(corpusPath(cli, REL.reviewQueue))) {
      const sid = nz(t.source_id);
      tasks.push({
        workspace_id: workspaceId,
        item_type: String(t.task_type),
        task_type: t.task_type,
        priority: Number(t.priority ?? 3),
        external_key: t.task_id,
        import_run_id: importRunId,
        review_target_key: nz(t.target_id),
        // Corpus tasks have no ingestion job, so they link to the document
        // directly; without this api.review_queue cannot show them.
        source_asset_id: sid ? assetId(sid) : null,
        proposed: { source_path: t.source_path, details: t.details, source_id: sid },
        conflicts: [],
        status: "pending",
      });
    }

    for await (const t of readJsonl<Row>(corpusPath(cli, REL.visualReviewQueue))) {
      const vsid = nz(t.source_id);
      tasks.push({
        workspace_id: workspaceId,
        item_type: String(t.task_type),
        task_type: t.task_type,
        priority: Number(t.priority ?? 3),
        external_key: t.review_task_id,
        import_run_id: importRunId,
        review_target_type: "media_asset",
        review_target_key: nz(t.media_asset_id),
        source_asset_id: vsid ? assetId(vsid) : null,
        proposed: {
          source_path: t.source_path,
          page_number: t.page_number,
          requested_fields: t.requested_fields,
          decision_rule: t.decision_rule,
        },
        conflicts: [],
        status: "pending",
      });
    }

    counts.review_items = await upsert(supabase, "review_items", tasks, "workspace_id,external_key");
  }

  return counts;
}

interface FactInput {
  path: string;
  label: string;
  rawValue: string | null;
  normalized: unknown;
  page: number | null;
  region: unknown;
  confidence: number | null;
  rule: string | null;
}

/** One observed field, carrying its raw form beside the normalized proposal. */
function fact(path: string, label: string, raw: unknown, normalized: unknown, parent: Row): FactInput {
  const locator = (parent.source_locator ?? {}) as Record<string, unknown>;
  const empty =
    normalized === null ||
    normalized === undefined ||
    normalized === "" ||
    (Array.isArray(normalized) && normalized.length === 0);
  return {
    path,
    label,
    rawValue: nz(raw),
    normalized: empty ? null : normalized,
    page: locator.page_number == null ? null : Number(locator.page_number),
    region: locator.row_number != null || locator.line_number != null ? locator : null,
    confidence: parent.confidence == null ? null : Number(parent.confidence),
    rule: (parent.extraction_rule as string | undefined) ?? null,
  };
}

function mediaRow(m: MediaAssetRecord, workspaceId: string, parentId: string | null): Row {
  const isRender = m.asset_kind === "pdf_page_render";
  return {
    workspace_id: workspaceId,
    source_asset_id: globalThis.__corpusAssetIds?.get(m.source_id) ?? null,
    parent_media_asset_id: parentId,
    external_key: m.media_asset_id,
    asset_kind: m.asset_kind,
    storage_bucket: m.asset_kind === "source_pdf" ? BUCKET_SOURCE : BUCKET_MEDIA,
    object_path: isRender
      ? pageObjectKey(workspaceId, m.source_id, m.page_number ?? 0)
      : m.asset_kind === "standalone_image"
        ? imageObjectKey(workspaceId, m.source_id, m.sha256)
        : null,
    content_checksum: m.sha256,
    mime_type: isRender ? "image/jpeg" : m.file_name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    size_bytes: m.size_bytes,
    width_px: m.width_px ?? null,
    height_px: m.height_px ?? null,
    orientation: m.orientation ?? null,
    page_number: m.page_number,
    document_class: m.document_class,
    brand_hint: m.brand_hint,
    source_path: m.source_path,
    source_web_url: m.source_url,
    usage_rights_state: "unreviewed",
    review_state: "pending_review",
  };
}

/**
 * Map the corpus's consequence-graded severity onto the repo's level scale.
 *
 * "blocks_price_publication" is the highest grade the corpus issues, and it
 * means exactly what it says, so it maps to high rather than being softened.
 */
function severityLevel(raw: string | null): string {
  if (!raw) return "medium";
  if (raw.startsWith("blocks")) return "high";
  if (raw.startsWith("requires")) return "medium";
  if (["low", "medium", "high"].includes(raw)) return raw;
  return "medium";
}

/**
 * Provisional document role from the observed folder path.
 *
 * A hint only: asset_class_review_state stays 'pending_review' so the reviewer,
 * not the folder name, decides what a document actually is.
 */
function classifyAsset(f: DriveFile): string {
  const p = f.path.toLowerCase();
  if (f.mime_type === "application/vnd.google-apps.document") return "link_manifest";
  if (f.mime_type === "image/jpeg") return "product_image";
  if (p.includes("certificate")) return "certificate";
  if (p.includes("pricelist") || p.includes("price list")) return "price_list";
  if (p.includes("catalog")) return "catalog";
  if (f.mime_type.includes("spreadsheet")) return "price_list";
  return "other";
}

/**
 * Approximates core.normalize_text for de-duplication only.
 *
 * The database is still the authority - it has a unique index on the generated
 * normalized_name - this just avoids sending inserts that would bounce.
 */
function normalizeName(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Second path segment is the brand folder in all three roots. */
function brandHintFromPath(p: string): string | null {
  const parts = p.split("/");
  return parts.length >= 2 ? parts[1] : null;
}

function cliCutoff(): string {
  return "2026-08-21";
}

declare global {
  var __corpusAssetIds: Map<string, string> | undefined;
}
