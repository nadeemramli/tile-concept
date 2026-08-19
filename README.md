# Tile Concept OS

Internal, invite-only operating system for Tile Concept: lead and walk-in capture, identity resolution, contract-sales pipeline, purchases and repeat history, governed product catalog and effective-dated pricing, with audit and data-health throughout. Product definition: [`docs/prd`](docs/prd/).

**Status:** Phase 1 slice (PRD §23) implemented end-to-end on a full schema; Phase 2–6 modules have schema + placeholder pages. Operating mode defaults to **Demo** (synthetic data only).

## Stack

GitHub · Vercel · Supabase (accepted platform, PRD §12.1). Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4 + shadcn (radix-nova), TanStack Table, react-hook-form + zod, nuqs, Supabase Auth (cookie sessions via `@supabase/ssr`), PostgreSQL 17 with private schemas + exposed `api` schema, pnpm, Node 24.

## Local development

```bash
nvm use            # Node 24 (see .nvmrc)
corepack enable && pnpm install
cp .env.example .env.local   # then paste the local keys printed by `pnpm db:start`
pnpm db:start      # local Supabase on ports 56321 (API) / 56322 (DB) / 56323 (Studio) / 56324 (Mailpit)
pnpm db:reset      # apply migrations + synthetic seed + local demo passwords
pnpm dev           # http://localhost:3000
```

Demo accounts (local stack only; passwords are set by `supabase/seeds/local-users.sql`, never in hosted projects):

| Email | Role | Password |
| --- | --- | --- |
| demo.admin@tileconcept.test | Platform administrator | `TileDemo!2026` |
| demo.manager@tileconcept.test | Sales manager | `TileDemo!2026` |
| demo.rep1@tileconcept.test / demo.rep2@… | Sales representative | `TileDemo!2026` |
| demo.showroom@tileconcept.test | Showroom staff | `TileDemo!2026` |
| demo.catalog@tileconcept.test | Catalog / pricing | `TileDemo!2026` |
| demo.marketing@tileconcept.test | Marketing coordinator | `TileDemo!2026` |

Real administrators are invited from **Platform → Settings → Invites** (Supabase Auth invitation email). `m.nadeemramli@gmail.com` is pre-seeded as a pending admin invite and becomes a member automatically on first sign-in.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:e2e` | Quality gates (CI runs the first three + build) |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:reset` | Local Supabase stack |
| `pnpm db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local `api` schema |
| `pnpm db:push` / `pnpm db:types:linked` | Apply migrations / regenerate types against the linked hosted project |

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | publishable (anon) key |
| `NEXT_PUBLIC_APP_URL` | server | canonical site URL (auth redirects) |
| `NEXT_PUBLIC_APP_MODE` | browser + server | `demo` \| `shadow` \| `live` (PRD §12.9) |
| `SUPABASE_SECRET_KEY` | **server only** | service-role key; used only for admin invites. Never `NEXT_PUBLIC_`. |

Preview and Production must use separate variable sets. Until a dedicated staging Supabase project exists, both point at the single `tile-concept` project — a documented deviation from PRD §12.6.

## Architecture at a glance

- `src/app/(app)` — authenticated shell (240px grouped sidebar, 56px top bar, command palette ⌘K). `src/app/(auth)`, `src/app/auth/*` — login, invite/magic-link confirmation, set password.
- `src/server/queries/*` (RSC reads) · `src/server/commands/*` (Server Actions: zod → authz → RPC/insert → audit → `ActionResult`).
- `src/components/patterns/*` — DataTable, RecordDrawer, StatusPill, MetricCard (always with definition/source/freshness), Timeline, states.
- `supabase/migrations` — private schemas (`core identity sales marketing merch stock ingest audit`), RLS on every table, `api.*` security-invoker views + SECURITY DEFINER business functions (walk-in, purchase, stage change, merge/unmerge, price publish, search, command-centre summary). `supabase/seed.sql` — synthetic fixtures only.

## Going live (remaining steps)

The GitHub repo and the Vercel project (`tile-concept`, team *nadeemramli's projects*, production branch `main`) exist and are linked; no deployment has been made yet because the hosted Supabase project is still outstanding.

1. **Settle the overdue invoices on the personal Supabase org** — project creation is currently rejected with *"There are overdue invoices in the organization(s) personal"*.
2. `ORG_ID=knqarurgnmzdtrpbieph ./scripts/cloud-bootstrap.sh` — creates `tile-concept` (Singapore), links, pushes migrations, seeds synthetic data, prints the keys and the DB password (store it in a password manager; it is shown once).
3. In the Supabase dashboard set **Settings → API → Exposed schemas** to `api` (remove `public`), and under **Authentication → URL configuration** set the site URL and `/auth/**` redirects for the Vercel domain plus `http://localhost:3000`.
4. In Vercel set the environment variables from `.env.example` for **Preview and Production separately**, then redeploy (any push to `main` deploys).
5. Invite yourself as administrator:
   `SUPABASE_URL=… SUPABASE_SECRET_KEY=… APP_URL=… pnpm exec tsx scripts/invite-user.ts m.nadeemramli@gmail.com`
   The seeded pending invite grants the `admin` role on first sign-in.
6. Optional: delete the synthetic demo staff users once real staff are invited.

## Delivery

- `main` is the production branch (Vercel). PRs get preview deployments. CI: lint, typecheck, unit tests, build, migration/types drift check (`.github/workflows/ci.yml`).
- Database changes are committed SQL migrations, applied with `supabase db push` from a reviewed branch — never dashboard-only.
- After creating the hosted project, set **Settings → API → Exposed schemas** to `api` (and remove `public`). The app talks only to the `api` schema; without this every request fails with `PGRST106`.
- No production customer, supplier, price, stock, or credential data in Git, fixtures, logs, or this repo.
