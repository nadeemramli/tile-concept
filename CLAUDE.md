# Tile Concept OS — working conventions

Internal, invite-only sales/identity/catalog/pricing/stock operating system. Product source of truth: `docs/prd/Tile Concept OS - Product Requirements Document.md` (snapshot of the Obsidian vault copy, which is canonical for product decisions).

## Stack
Next.js 16 App Router (React 19, strict TS, `src/proxy.ts` for session refresh), Tailwind v4 + shadcn (radix-nova, owned source in `src/components/ui`), Supabase (Postgres 17, Auth, private schemas + exposed `api` schema), TanStack Table v8, react-hook-form + zod, nuqs for URL state, pnpm, Node 24.

## Architecture rules (PRD §12)
- **Server-first.** Pages are React Server Components reading through `src/server/queries/<domain>.ts`. User commands are Server Actions in `src/server/commands/<domain>.ts` (`"use server"`), which validate with zod (`src/features/<domain>/schema.ts`), call the DB (view insert/update or `supabase.rpc(...)`), then `revalidatePath`. Return `ActionResult` from `src/server/action-result.ts`.
- **Database is the authority for authorization.** All tables live in private schemas (`core, identity, sales, marketing, merch, stock, ingest, audit`) with RLS; the client talks only to `api.*` security-invoker views and `api.*` SECURITY DEFINER functions. Never import the admin (service-role) client outside `src/server/**` admin-only flows (invites).
- **Session**: `getSession()/requireSession()/requirePermission()` in `src/server/session.ts`. Client components read `useSession()` from `src/components/shell/session-context.tsx` for nav/affordances only.
- **Multi-record invariants live in SQL functions** (`supabase/migrations/20260820000007_functions.sql`): `record_walk_in`, `record_purchase`, `change_opportunity_stage`, `merge_contacts`, `unmerge_contacts`, `publish_price`, `convert_lead`, `assign_lead`, `log_lead_response`, `find_identity_candidates`, `global_search`, `command_centre_summary`, `entity_timeline`, `reveal_contact_points`, `create_contact`, `suggest_contact_duplicates`, `reject_identity_candidate`.
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

## Migrations
Forward-only SQL in `supabase/migrations/YYYYMMDDNNNNNN_slug.sql`. New tables: add RLS policy (see `20260820000006_rls_api.sql` loop), grant, and an `api.<table>` security-invoker view; regenerate types.

## Gotchas
- **PostgREST must expose `api`, not `public`.** `supabase/config.toml` sets `[api] schemas = ["api", "graphql_public"]`. The hosted project needs the same under Settings → API → Exposed schemas, or every query returns `PGRST106 Invalid schema: api`. Supabase clients are constructed with `db: { schema: "api" }`.
- **Never use zod's `.uuid()` for ids** — zod 4 enforces RFC-4122 version/variant bits and rejects valid PostgreSQL uuids (including our fixture ids). Use `uuid()` / `optionalUuid()` from `src/lib/zod.ts`.
- `MetricCard` and anything passing handlers to it must be a client component.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
