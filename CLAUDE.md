# Tile Concept OS — working conventions

Internal, invite-only sales/identity/catalog/pricing/stock operating system. Product source of truth: `docs/prd/Tile Concept OS - Product Requirements Document.md` (snapshot of the Obsidian vault copy, which is canonical for product decisions). Deployed on Vercel against hosted Supabase `ewyiiematuuojlhpioqh`.

Working on ingestion? Read `docs/architecture/Corpus Compatibility Map.md` first — it says how the canonical v0.3 schema maps onto the tables that exist, and what each review gate refuses.

## Stack
Next.js 16 App Router (React 19, strict TS, `src/proxy.ts` for session refresh), Tailwind v4 + shadcn (radix-nova, owned source in `src/components/ui`), Supabase (Postgres 17, Auth, private schemas + exposed `api` schema), TanStack Table v8, react-hook-form + zod, nuqs for URL state, pnpm, Node 24.

## Architecture rules (PRD §12)
- **Server-first.** Pages are React Server Components reading through `src/server/queries/<domain>.ts`. User commands are Server Actions in `src/server/commands/<domain>.ts` (`"use server"`), which validate with zod (`src/features/<domain>/schema.ts`), call the DB (view insert/update or `supabase.rpc(...)`), then `revalidatePath`. Return `ActionResult` from `src/server/action-result.ts`.
- **Database is the authority for authorization.** All tables live in private schemas (`core, identity, sales, marketing, merch, stock, ingest, audit`) with RLS; the client talks only to `api.*` security-invoker views and `api.*` SECURITY DEFINER functions. Never import the admin (service-role) client outside `src/server/**` admin-only flows (invites).
- **Session**: `getSession()/requireSession()/requirePermission()` in `src/server/session.ts`. Client components read `useSession()` from `src/components/shell/session-context.tsx` for nav/affordances only.
- **Multi-record invariants live in SQL functions** (`supabase/migrations/20260820000007_functions.sql`): `record_walk_in`, `record_purchase`, `change_opportunity_stage`, `merge_contacts`, `unmerge_contacts`, `publish_price`, `convert_lead`, `assign_lead`, `log_lead_response`, `find_identity_candidates`, `global_search`, `command_centre_summary`, `entity_timeline`, `reveal_contact_points`, `create_contact`, `suggest_contact_duplicates`, `reject_identity_candidate`. Corpus gates are in `…21000006_corpus_functions.sql`: `approve_review_item` (rewritten), `approve_certificate_candidate`, `approve_media_link`, `publish_product_media`, `start_import_run`/`record_import_item`/`finish_import_run`.
- **Nothing is defaulted into existence.** `api.approve_review_item` refuses to publish a price until currency, unit basis, tax basis, price type, market, validity, minimum quantity and the price list are each stated — it collects every unresolved field and names them all in one 23514. The `currency` column defaults were dropped from `merch.variant_prices` and `merch.price_lists` so nothing can fill them from another direction. Do not re-add a default to make a test pass.
- **Types**: `src/lib/supabase/database.types.ts` is generated (`pnpm db:types`). View row types are all-nullable; narrow at the query boundary with small typed mappers rather than sprinkling `!` in components.
- **Money** numeric + currency; **dates** ISO strings, display with `src/lib/format.ts` (Asia/Kuala_Lumpur).
- **No real customer/supplier/price data** in fixtures, tests, logs, or the repo. `supabase/seed.sql` is synthetic.

## UI contract (PRD §9, §12.2)
- Shell: 240px grouped sidebar, 56px top bar, dark navy default + full light mode, Geist Sans/Mono, 8px radius, compact density.
- **Brand**: navy `#093248` and amber `#eda537`, sampled from the logo. Dark mode = navy surfaces with amber primary; light mode = near-white surfaces with navy primary. `--brand` is amber in both modes and is for non-text affordances only (active-nav rail, focus ring) — see the contrast note in `globals.css`. Assets: `<LogoMark />` (SVG monogram, small chrome) and `<LogoLockup />` (real wordmark, login-size) in `src/components/brand/logo.tsx`; `src/app/icon.png` is the favicon.
- Use patterns in `src/components/patterns`: `DataTable` (one table contract everywhere), `RecordDrawer`/`DrawerSection`/`FactList`, `StatusPill`/`TonePill` with maps in `src/lib/domain/status-maps.ts`, `MetricCard` (always pass `info` — no bare metrics), `PageHeader`/`PageBody`, `Timeline`, `EmptyState`/`PermissionDenied`, `FreshnessBadge`, `Field`.
- Drawers for inspect/edit, full pages for multi-step/high-risk, dialogs for short confirmations and merge decisions. Masks phone/email in lists; reveal is permissioned + audited (`reveal_contact_points`).
- Every status needs a label/icon, not colour alone. Keyboard-operable, visible focus.
- Nav registry: `src/lib/nav/routes.ts` — `sidebarRoutes()` feeds the sidebar, `platformRoutes()` feeds the user menu. The Platform group (Integrations, Data Health, Audit, Settings) is administration, not daily work, so it lives in the user dropdown and keeps the sidebar short enough not to scroll (~700px). Adding a sidebar item costs ~36px and a new group ~56px; the nav ends at ~830px, so check it still fits before adding either. Permissions: `src/lib/rbac/matrix.ts` (mirror of `core.role_permissions`).

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

## Phase map
Phase 1 (sales) and Phases 2-6 all have their database layer in `supabase/migrations`: `…008_phase_enablement` (child-table RLS, storage), `…009_phase2_marketing`, `…010_phase4_sources`, `…011_phase5_stock`, `…012_phase6_reports`, `…013_phase3_intake`. Business rules live in the SQL functions those files define — the UI calls them and must not re-implement or bypass a rule (permission gates, required reasons, permission-before-usable, idempotency).

## Migrations
Forward-only SQL in `supabase/migrations/YYYYMMDDNNNNNN_slug.sql`. New tables: add RLS policy (see `20260820000006_rls_api.sql` loop), grant, and an `api.<table>` security-invoker view; regenerate types.

## Gotchas
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
