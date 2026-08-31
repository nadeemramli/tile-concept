# Tile Concept OS

Internal, invite-only operating system for Tile Concept: lead and walk-in capture, identity resolution, contract-sales pipeline, purchases and repeat history, governed product catalog and effective-dated pricing, with audit and data-health throughout. Product definition: [`docs/prd`](docs/prd/).

**Status:** deployed. Phase 1 slice (PRD §23) is implemented end-to-end on a full schema;
Phases 2–6 have their database layer and working surfaces. The identifiable, priced part
of the 2026-08-21 supplier corpus is published (5,087 products and 6,575 current prices);
ambiguous remnants stay in the review queue. Operating mode defaults to **Demo** for
synthetic app data.

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
| `pnpm corpus:plan` | Dry run: recompute every discovery-corpus count and reconcile it against the manifests. Writes nothing |
| `pnpm corpus:local` / `pnpm corpus:linked` | Upload + import the corpus into the local stack / the linked hosted project |

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | publishable (anon) key |
| `NEXT_PUBLIC_APP_URL` | server | canonical site URL (auth redirects) |
| `NEXT_PUBLIC_APP_MODE` | browser + server | `demo` \| `shadow` \| `live` (PRD §12.9) |
| `SUPABASE_SECRET_KEY` | **server only** | service-role key; admin invites, user provisioning, and the corpus importer. Never `NEXT_PUBLIC_`. |
| `TILE_CORPUS_ROOT` | corpus tooling only | Absolute path to `Discovery Corpus/_local`. Never defaulted — a wrong default would silently import the wrong tree. |
| `TC_INTAKE_WORKSPACE_ID` | **server only** | Workspace written by inbound connectors; optional only when the database has exactly one workspace. |
| `N8N_INTAKE_SECRET` | **server only** | HMAC secret shared only with the Hetzner n8n workflow for `/api/intake/automation`. |
| `INTAKE_WEBSITE_SECRET` | **server only** | Separate HMAC secret for direct website submissions at `/api/intake/website`. |

Production has the five core app/database variables set; connector secrets remain an
explicit rollout step. Preview has no database. Both environments should use separate Supabase projects; until a staging
project exists this is a documented deviation from PRD §12.6.

## Architecture at a glance

- `src/app/(app)` — authenticated shell (240px grouped sidebar, 56px top bar, command palette ⌘K). `src/app/(auth)`, `src/app/auth/*` — login, invite/magic-link confirmation, set password.
- `src/server/queries/*` (RSC reads) · `src/server/commands/*` (Server Actions: zod → authz → RPC/insert → audit → `ActionResult`).
- `src/components/patterns/*` — DataTable, RecordDrawer, StatusPill, MetricCard (always with definition/source/freshness), Timeline, states.
- `supabase/migrations` — private schemas (`core identity sales marketing merch stock ingest audit`), RLS on every table, `api.*` security-invoker views + SECURITY DEFINER business functions (walk-in, purchase, stage change, merge/unmerge, price publish, search, command-centre summary). `supabase/seed.sql` — synthetic fixtures only.

## Product and price lookup

`/merchandise/catalog` is the sales-facing **Product & Price Finder**. It opens on
**Ready to quote**, searches the entire published corpus, and filters by brand, colour,
finish, material, and category. Results are server-paginated and show the selected
current reviewed price beside the product. `/merchandise/pricing` remains the operator
surface for price-list maintenance and history.

Publication controls still protect the catalog; ordinary lookup does not send sales
staff back through the review queue. Products without a usable current price are
isolated in **Missing price**.

## n8n lead intake and WhatsApp handoff

The Hetzner-hosted n8n workflow posts a normalized payload to
`POST /api/intake/automation`. TikTok, Facebook, Instagram, Threads, Meta, and website
forms use one contract:

```json
{
  "submission_id": "provider-submission-id",
  "source": "tiktok",
  "name": "Example Lead",
  "phone": "+60123456789",
  "email": "example@example.invalid",
  "interest": "kitchen tiles",
  "product_interest": ["tile"],
  "occurred_at": "2026-09-01T10:00:00+08:00",
  "campaign_name": "Showroom September",
  "form_name": "Tile Consultation"
}
```

n8n must send `x-tc-timestamp` (Unix seconds) and `x-tc-signature`, where the
signature is `sha256=` plus the lowercase HMAC-SHA256 of
`<timestamp>.<exact raw JSON body>` using `N8N_INTAKE_SECRET`. Requests older than five
minutes or with an invalid signature are rejected. `submission_id` makes retries
idempotent; the existing intake function then deduplicates, matches exact phone/email,
routes ownership, and starts the response SLA.

A successful response includes `lead_url`, `whatsapp_url`, and `notification_text`.
n8n sends `notification_text` to the configured sales WhatsApp group through the
approved WhatsApp provider. The app itself does not silently send messages. In the
inbox, staff with contact-reveal permission also get a one-click, pre-filled WhatsApp
action; sending remains a deliberate human action and must be logged afterward.
Facebook, Instagram, and Threads report under the stable `meta` channel while the exact
platform, campaign, and form remain in source detail and the immutable intake payload.

## Hosted project

Supabase project `tile-concept` (`ewyiiematuuojlhpioqh`, ap-northeast-2), org *EFFEN
Group*, Pro plan. Vercel project `tile-concept`, production branch `main`. Both are
linked and deployed; `supabase/.temp/project-ref` records the link.

Settings that are not in migrations and must be checked in the dashboard:

1. **Settings → API → Exposed schemas** must be `api` (not `public`). Without it every
   request fails with `PGRST106`.
2. **Storage → Settings → Global file size limit** must be at least **512 MB** for the
   corpus originals. A bucket limit cannot exceed the global one, so
   `20260821000005_corpus_storage.sql` is inert until this is raised. 14 of the 154
   staged catalogues exceed 50 MB; the largest is 366,392,675 bytes.
3. **Authentication → URL configuration** — site URL and `/auth/**` redirects for the
   Vercel domain plus `http://localhost:3000`.

`scripts/cloud-bootstrap.sh` created the project originally and is kept for reference; it
is not part of the normal workflow.

## Adding people

The app is invite-only: self-signup is disabled on the hosted project, and the "Email
link" tab passes `shouldCreateUser: false`, so a magic link is only ever sent to an
address that already exists in `auth.users`. There is no way to get in without being
added first — that is deliberate.

**Two routes in.** Both end at the same place: a pending row in
`core.membership_invites`, which `core.handle_new_auth_user()` converts into a membership
the moment the auth user appears.

```bash
# 1. Normal route — sends a Supabase Auth invitation email
SUPABASE_URL=… SUPABASE_SECRET_KEY=… APP_URL=… pnpm exec tsx scripts/invite-user.mts you@example.com

# 2. Direct route — creates the account and prints a one-time password
SUPABASE_URL=… SUPABASE_SECRET_KEY=…   pnpm exec tsx scripts/provision-user.mts ops@example.com sales_rep
```

**Prefer route 2 until custom SMTP is configured.** The project has no SMTP server, so
invitation emails go through Supabase's default service, which their docs describe as
best-effort and intended for *"testing email templates with the members of the project's
team"* — an invite to a staff address may simply never arrive. Route 2 provisions the
same end state without depending on delivery: hand the printed password over out of band
and have them change it at `/auth/set-password`.

Neither route bypasses authorization. The role comes from `core.roles` and the membership
from the invite; RLS is unchanged. Roles: `admin`, `management`, `sales_manager`,
`sales_rep`, `showroom`, `marketing_coordinator`, `catalog_pricing`, `stock_coordinator`,
`analyst` (`src/lib/rbac/matrix.ts` mirrors `core.role_permissions`).

## Corpus migration

The supplier discovery corpus (242 Drive files, ~3.1 GB) lives outside this repository and
is Git-ignored wherever it is mounted. `scripts/corpus/` moves it into Supabase:

```bash
export TILE_CORPUS_ROOT="…/Discovery Corpus/_local"
pnpm corpus:plan                                  # recompute and reconcile; writes nothing
pnpm corpus:local                                 # rehearse against the local stack
SUPABASE_URL=… SUPABASE_SECRET_KEY=…   pnpm corpus:linked --workspace <workspace-id>   # hosted
```

What lands where, and what stays out, is documented in
[Corpus Compatibility Map](docs/architecture/Corpus%20Compatibility%20Map.md). Three things
are worth knowing before running it:

- **Import is not publication.** 6,011 variant, 10,183 price, and 62 certificate
  candidates arrive `pending_review`. `api.approve_review_item` refuses to publish a price
  until currency, unit basis, tax basis, price type, market, validity, and the price list
  are each stated explicitly — none of them is defaulted.
- **It is idempotent.** Objects are create-only and every row is keyed on a stable corpus
  id, so re-running an unchanged corpus adds nothing.
- **Three sources are deliberately absent.** The Guocera credentials document is excluded
  by policy and never read; the Alpha and Bellezza catalogues are recorded as
  `binary_not_staged` with no object and no placeholder.

## Delivery

- `main` is the production branch (Vercel). PRs get preview deployments. CI: lint, typecheck, unit tests, build, migration/types drift check (`.github/workflows/ci.yml`).
- Database changes are committed SQL migrations, applied with `supabase db push` from a reviewed branch — never dashboard-only.
- The app talks only to the `api` schema; the hosted project's **Exposed schemas** setting must match, or every request fails with `PGRST106`.
- No production customer, supplier, price, stock, or credential data in Git, fixtures,
  logs, or this repo. The discovery corpus reaches Supabase directly from the operator's
  machine and never passes through the repository.
