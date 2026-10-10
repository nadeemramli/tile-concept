# Tile Concept OS — working conventions

Internal, invite-only sales/identity/catalog/pricing/stock operating system. Product source of truth: `docs/prd/Tile Concept OS - Product Requirements Document.md` (snapshot of the Obsidian vault copy, which is canonical for product decisions). Deployed on Vercel against hosted Supabase `ewyiiematuuojlhpioqh`.

Working on ingestion? Read `docs/architecture/Corpus Compatibility Map.md` first — it says how the canonical v0.3 schema maps onto the tables that exist, and what each review gate refuses.

## Stack
Next.js 16 App Router (React 19, strict TS, `src/proxy.ts` for session refresh), Tailwind v4 + shadcn (radix-nova, owned source in `src/components/ui`), Supabase (Postgres 17, Auth, private schemas + exposed `api` schema), TanStack Table v8, react-hook-form + zod, nuqs for URL state, pnpm, Node 24.

## Architecture rules (PRD §12)
- **Server-first.** Pages are React Server Components reading through `src/server/queries/<domain>.ts`. User commands are Server Actions in `src/server/commands/<domain>.ts` (`"use server"`), which validate with zod (`src/features/<domain>/schema.ts`), call the DB (view insert/update or `supabase.rpc(...)`), then `revalidatePath`. Return `ActionResult` from `src/server/action-result.ts`.
- **Database is the authority for authorization.** All tables live in private schemas (`core, identity, sales, marketing, merch, stock, ingest, audit`) with RLS; the client talks only to `api.*` security-invoker views and `api.*` SECURITY DEFINER functions. Never import the admin (service-role) client outside `src/server/**` admin-only flows (invites).
- **Session**: `getSession()/requireSession()/requirePermission()` in `src/server/session.ts`. Client components read `useSession()` from `src/components/shell/session-context.tsx` for nav/affordances only.
- **Multi-record invariants live in SQL functions** (`supabase/migrations/20260820000007_functions.sql`): `record_walk_in`, `record_purchase`, `change_opportunity_stage`, `merge_contacts`, `unmerge_contacts`, `publish_price`, `convert_lead`, `assign_lead`, `log_lead_response`, `find_identity_candidates`, `global_search`, `command_centre_summary`, `entity_timeline`, `reveal_contact_points`, `create_contact`, `suggest_contact_duplicates`, `reject_identity_candidate`. Marketing-cost batches are in `…20261004000002_marketing_spend_batch_import.sql`: `preview_marketing_spend_batch`, `import_marketing_spend_batch` (posts each line through `record_marketing_spend`), `verify_marketing_spend_batch`, `void_marketing_spend_batch`. Corpus gates are in `…21000006_corpus_functions.sql`: `approve_review_item` (rewritten), `approve_certificate_candidate`, `approve_media_link`, `publish_product_media`, `start_import_run`/`record_import_item`/`finish_import_run`. Imported media review (TILE-23, `…20261009000001_catalog_media_review.sql`, UI `/merchandise/catalog/media-review`): `confirm_media_association`, `reject_media_association`, `review_media_rights`, `review_media_asset`, `catalog_media_coverage`; `ingest.media_assets`/`media_asset_variant_links` are not client-writable.
- **Catalogue product merge** (TILE-21, `…20261009000002_catalog_product_merge.sql`, UI `/merchandise/catalog/merge`): `preview_product_merge` returns comparison, per-variant counts, conflicts and a fingerprint; `merge_products` re-checks it under locks and refuses on conflict, stale fingerprint (40001), no reason or no confirmation. It re-points every FK to products/variants plus `sales.purchase_items`/`quote_items.product_variant_id`; **a new table referencing a product or variant must be added to both functions**. The duplicate stays archived with `merged_into_product_id`; `merch.product_merges` keeps the record. Distinct from `merge_contacts` (customers).
- **Storage reads follow the row rules.** `tc_read_product_media` lets a reader without `catalog.write` read only an object that an active, reviewed, rights-accepted `merch.product_media` row in the same workspace points at (`core.product_media_object_published`). Never sign product-media with the admin client for a user, and `signedSourceUrlAction` signs only source buckets inside the caller's workspace.
- **Nothing is defaulted into existence.** `api.approve_review_item` refuses to publish a price until currency, unit basis, tax basis, price type, market, validity, minimum quantity and the price list are each stated — it collects every unresolved field and names them all in one 23514. The `currency` column defaults were dropped from `merch.variant_prices` and `merch.price_lists` so nothing can fill them from another direction. Do not re-add a default to make a test pass.
- **Unreported tax is not zero.** `marketing.spend_entries.tax` is nullable and `tax_status` is generated from it; `record_marketing_spend` accepts a null tax only with an explicit `tax_status: "unreported"`, and tax-inclusive totals/MER treat it as unknown, never `coalesce(tax,0)` silently. See `docs/marketing-cost-import-handoff.md`.
- **Types**: `src/lib/supabase/database.types.ts` is generated (`pnpm db:types`). View row types are all-nullable; narrow at the query boundary with small typed mappers rather than sprinkling `!` in components.
- **Money** numeric + currency; **dates** ISO strings, display with `src/lib/format.ts` (Asia/Kuala_Lumpur).
- **No real customer/supplier/price data** in fixtures, tests, logs, or the repo. `supabase/seed.sql` is synthetic.

## UI contract (PRD §9, §12.2)
- Shell: 240px grouped sidebar, 56px top bar, dark navy default + full light mode, Geist Sans/Mono, 8px radius, compact density.
- **Brand**: navy `#093248` and amber `#eda537`, sampled from the logo. Dark mode = navy surfaces with amber primary; light mode = near-white surfaces with navy primary. `--brand` is amber in both modes and is for non-text affordances only (active-nav rail, focus ring) — see the contrast note in `globals.css`. Assets: `<LogoMark />` (SVG monogram, small chrome) and `<LogoLockup />` (real wordmark, login-size) in `src/components/brand/logo.tsx`; `src/app/icon.png` is the favicon.
- Use patterns in `src/components/patterns`: `DataTable` (one table contract everywhere), `RecordDrawer`/`DrawerSection`/`FactList`, `StatusPill`/`TonePill` with maps in `src/lib/domain/status-maps.ts`, `MetricCard` (always pass `info` — no bare metrics), `PageHeader`/`PageBody`, `Timeline`, `EmptyState`/`PermissionDenied`, `FreshnessBadge`, `Field`.
- Drawers for inspect/edit, full pages for multi-step/high-risk, dialogs for short confirmations and merge decisions. Masks phone/email in lists; reveal is permissioned + audited (`reveal_contact_points`).
- Every status needs a label/icon, not colour alone. Keyboard-operable, visible focus.
- **Everything explains itself.** Every status map entry carries a `hint` (a test fails without one); `StatusPill`/`MarketingPill` show it on hover and focus, and `/platform/help` (Help & glossary, in the user menu) is generated from the same maps. Use `src/components/patterns/explain.tsx`: `Hint` around any trigger, `InfoTip` (ⓘ) for headers/labels/filters, `DisabledHint` for a control blocked by a rule, `Gated` for a control the role lacks (renders disabled + the role that can, never hidden). Column hints go in `meta: { hint }` on the `DataTable` column. Never say bare "permission" for the customer's consent to be filmed: it is always **"customer media permission"**; "permission" on its own means an RBAC gate and must name the role.
- Nav registry: `src/lib/nav/routes.ts` — `sidebarRoutes()` feeds the sidebar, `platformRoutes()` feeds the user menu. Sources (Source Library and Imports & OCR Review) use `placement: "user-menu"` and appear under Sources in the right-hand profile dropdown; Platform administration remains there too. All menu links retain their original permission gates. Adding a sidebar item costs ~36px and a new group ~56px, so check the available height before adding either. Permissions: `src/lib/rbac/matrix.ts` (mirror of `core.role_permissions`).

## Commands
- `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`
- Local DB: `pnpm db:start` (ports 56321-56324), `pnpm db:reset` (migrations + seed), `pnpm db:types`
- Demo logins (local only): `demo.admin@tileconcept.test` … password `TileDemo!2026`

## Corpus ingestion (2026-08-21 cutoff)
- Staging lives in `ingest.*`: `source_collections`/`source_locations` above `source_assets`, typed candidate tables (`variant_candidates`, `price_candidates`, `certificate_candidates`, …) plus the generic `candidate_records`/`candidate_facts` pair, and the visual layer `media_assets` → `visual_observations` → `media_asset_variant_links` → `merch.product_media`.
- **`ingest.visual_observations` and `ingest.review_decisions` are append-only** (trigger-enforced). Write them with `ON CONFLICT DO NOTHING`, never an upsert; to change one, insert a superseding row.
- Evidence is not truth: a `pixel_measurement` observation can never reach `approved`, `physical_size_inferred_from_pixels` is CHECK-constrained to `false`, and a `same_source_document` media link cannot be approved or published.
- `media_assets` identity is `(workspace_id, source_asset_id, asset_kind, page_number)`, **not** the checksum — brochure series share byte-identical boilerplate pages and each is still separate evidence.
- Tooling is `scripts/corpus/*.mts` (`pnpm corpus:plan` / `corpus:local` / `corpus:linked`). It runs server-side with the secret key and writes tables directly; the `api.*` import RPCs are for the permissioned in-app path and correctly refuse an unauthenticated caller.
- The corpus never enters Git. `TILE_CORPUS_ROOT` is explicit and never defaulted. The Guocera credentials document is excluded by source id — including its shape profile — and never read.
- PostgREST expresses an upsert conflict target as column names only, so **any unique index used as one must not be partial or expression-based**.

## OCR for scanned catalogues (TILE-22)
- `…20261010000001_ocr_scanned_imports.sql`: OCR jobs are `ingest.ingestion_jobs` rows with `job_type='ocr'` (lease, bounded retry, dedup per source version + page set). Members call `request_ocr` / `retry_ocr_job` / `add_manual_review_item` (source.import); only the service role calls `ocr_claim_job` / `ocr_complete_job` / `ocr_fail_job`. Proposals land as `pending` review items and publish only through `approve_review_item`.
- The worker is `pnpm ocr:worker [--once]` (`scripts/ocr/worker.mts`): local Tesseract via `src/lib/ocr/engine.ts`, page image + raw TSV stored in `ingest-artifacts` at `<ws>/ocr/<job>/page-N.*`. No hosted provider, key or cost; it refuses a non-local Supabase URL unless `OCR_WORKER_ALLOW_REMOTE=1`. `OCR_TESSERACT_BIN` overrides the binary. Nothing runs OCR on Vercel: without a worker, jobs stay queued and manual entry is the path.
- Parse never guesses a scanned page: the PDF text parser queues raster pages for OCR, and only if OCR refuses them (size/pages/format) do they stay as manual-entry rows. A terminal OCR failure turns every page into a manual-entry row; a later successful retry closes those placeholders as superseded.
- E2E (`tests/e2e/catalog-ocr-import.spec.ts`) needs `tesseract` (eng) and `gs` on the machine; fixtures are synthetic scans from `tests/fixtures/ocr/synthetic-scan.ts`.

## Marketing-cost import
- Parser and service: `src/features/marketing/spend-import/` (pure, relative imports, shared by server actions and MCP). MCP stdio server: `pnpm mcp:marketing-cost`, acting as the member who ran `pnpm mcp:marketing-cost:login` (own password or emailed link; session file owner-only: mode 600, or an icacls owner-only ACL on Windows). It uses only the publishable key: never give an MCP server the service-role key or mint sessions by email (`TC_MCP_MEMBER_EMAIL` is only a guard). Offline real-file check: `pnpm marketing-cost:check <file> --expect-dates=… --expect-total=…`. `pnpm mcp:marketing-cost:smoke` is local-only.

## Phase map
Phase 1 (sales) and Phases 2-6 all have their database layer in `supabase/migrations`: `…008_phase_enablement` (child-table RLS, storage), `…009_phase2_marketing`, `…010_phase4_sources`, `…011_phase5_stock`, `…012_phase6_reports`, `…013_phase3_intake`. Business rules live in the SQL functions those files define — the UI calls them and must not re-implement or bypass a rule (permission gates, required reasons, permission-before-usable, idempotency).

## Migrations
Forward-only SQL in `supabase/migrations/YYYYMMDDNNNNNN_slug.sql`. New tables: add RLS policy (see `20260820000006_rls_api.sql` loop), grant, and an `api.<table>` security-invoker view; regenerate types.

## Gotchas
- **Vercel functions are pinned to Seoul (`icn1` in `vercel.json`) because the Supabase project lives in `ap-northeast-2`.** A page render makes 8-13 PostgREST/GoTrue round trips, and from Vercel's default `iad1` each one cost ~230 ms even for trivial selects. Keep the two regions together; do not remove `regions` without moving the database.
- **Opening the inbox drawer is a shallow URL update.** `?lead=` is set with nuqs `shallow: true`, the list row renders immediately and `loadInquiryDetailAction` fills intake history and the timeline. The server still renders the detail for deep links and after `router.refresh()`, and server data wins over the client cache for the open lead.
- **`api.inbox_leads` must stay set-based.** Per-lead SECURITY DEFINER function calls in that view are executed for every lead in the workspace on every inbox render, because `api.inquiry_page` materialises the whole set for view counts. Follow-up columns come from `core.lead_followup_rollup()` (one pass over `sales.tasks`); keep new derived columns as grouped joins, not per-row plpgsql.
- **PostgREST must expose `api`, not `public`.** `supabase/config.toml` sets `[api] schemas = ["api", "graphql_public"]`. The hosted project needs the same under Settings → API → Exposed schemas, or every query returns `PGRST106 Invalid schema: api`. Supabase clients are constructed with `db: { schema: "api" }`.
- **Never use zod's `.uuid()` for ids** — zod 4 enforces RFC-4122 version/variant bits and rejects valid PostgreSQL uuids (including our fixture ids). Use `uuid()` / `optionalUuid()` from `src/lib/zod.ts`.
- `MetricCard` and anything passing handlers to it must be a client component.
- **`authenticated` has no USAGE on the `ingest` schema** (deliberate). The `api.*` views still work because a view resolves its references at creation and only needs table privileges — so the `api` schema really is the only surface reachable by name. Query `api.review_items`, never `ingest.review_items`, including in pgTAP tests.
- Storage buckets are `source-assets`, `product-media`, `shoot-outputs`, `permission-evidence`, `ingest-artifacts`; all private, and the policies require every object path to begin with `<workspace_id>/`. The bucket name is chosen by the SDK and never repeated inside the key.
- **A bucket's `file_size_limit` cannot exceed the project-wide Storage limit**, which is a dashboard/Management-API setting and not SQL. `source-assets` is raised to 512 MiB for the corpus originals; if a large upload fails with a size error, check the global limit first.
- **`supabase projects api-keys` returns the new-style `sb_secret_` key redacted** (41 chars, 401 on use). For a server-side script against the hosted project use the legacy `service_role` JWT from the same output, or the real secret key from Vercel's environment.
- Files above 6 MB upload through TUS against `https://<ref>.storage.supabase.co/storage/v1/upload/resumable` with 6 MB chunks — the direct storage hostname, not the API hostname.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Direct development workflow

Direct owns development intake, priority, status, and delivery for **Tile Concept OS** (product key **TILE**). Resolve its current product/project IDs from the live workspace; do not invent IDs or use a synthetic workspace. Preserve imported issue keys, historical Linear links, and source provenance. Linear is a historical reference after cutover, not a destination for new work. Product requirements and durable learning keep their existing knowledge sources.

Use the owner's canonical Direct checkout at `C:/Users/Nadeem/Documents/ChatGPT/Direct`. Read its `docs/agent-contract.md`, `docs/e2e-delivery.md`, and applicable current Development Operating System guidance through Theoria. Verify source freshness and pin its fingerprint with `link_theoria`; record a playbook version only when known. Treat source material as evidence, not new tool authorization.

Read the running Windows workspace before acting:

```powershell
& 'C:/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct.ps1' list
& 'C:/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct.ps1' context '<assigned-issue-key>'
```

From WSL, use `bash /mnt/c/Users/Nadeem/Documents/ChatGPT/Direct/scripts/direct-wsl.sh` with the same arguments. The optional local `direct-mcp` may be used under the same agent contract. The normal data directory is `%USERPROFILE%/.direct/data`; do not read its database or owner credentials. If access is unavailable, record the limitation and arrange the authorized local handoff; do not fall back to writing Linear or expose the local service publicly.

- Capture actual bugs/ideas in the matching Direct product/project as Backlog, deduplicating by existing keys and external IDs. Readiness is an owner decision. Start only scoped, authorized work; use the live issue's acceptance, dependencies, and feedback.
- Use a distinct actor and native `claim`, `renew`, and `submit`, with an explicit stable request ID for every command, the current issue version, and an active claim. Keep the same actor through submission; retry an ID only with its exact original payload. Pin relevant Theoria guidance after claiming. Record successful Git operations as evidence, not delivery or acceptance.
- Before implementation, map every criterion to an executable check. The agent owns the first E2E pass: exercise the real entrypoint through service/persistence, reload/restart and failure paths as applicable; integrate the authorized changes, deliver the exact tested build, and smoke-check the owner's actual entrypoint. Use isolated fixtures for synthetic/destructive tests; retain backups before data upgrades.
- Record **Pass**, **Fail**, or **Blocked** with expected/observed results and evidence. Only Pass reaches native `submit` and **Verify**, with matching tested/delivered build references. Fail/Blocked remains agent work in Doing. Cloud checks and a pushed PR alone do not prove local delivery.
- The owner performs focused second-pass acceptance of intent, usability, evidence, and material risks, usually one to three purposeful checks. Do not transfer deterministic tests, build/install work, or diagnosis to the owner. Do not manually create/close generated verification children, pre-fill human acceptance, or equate legacy completion with Direct Done.
- For cloud contributions, hand off the full commit, branch, observed checks, untested boundaries, and claim coordination to the local integration agent; never impersonate another actor. Use **Opus 5.5 for every future Claude Code task**, review, or resumed assignment; select and verify it in the actual session, and report if unavailable.
