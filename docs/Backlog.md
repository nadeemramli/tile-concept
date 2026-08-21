# Engineering backlog

Non-blocking follow-ups. Product/feature backlog lives in the PRD; this file is
for verification and technical debt we chose to defer.

## Corpus migration — remaining steps

The 2026-08-21 discovery corpus is fully imported and reconciled **against the
local stack**. Everything below is what stands between that and the hosted
project. See
[Corpus Compatibility Map](architecture/Corpus%20Compatibility%20Map.md).

### Blocked on a dashboard setting

- **Raise the project-wide Storage file size limit to 512 MB** (Storage →
  Settings on `ewyiiematuuojlhpioqh`). A bucket limit cannot exceed the global
  one, so `20260821000005_corpus_storage.sql` raises `source-assets` to 512 MiB
  but stays inert until this is done. 14 of the 154 staged catalogues exceed the
  current 50 MB cap; the largest is 366,392,675 bytes. Without it those 14
  uploads fail and the rest still succeed — the importer is resumable, so it can
  be re-run after the limit is raised and will upload only what is missing.

### Then

1. `pnpm exec supabase db push --linked` — six migrations, verified against a
   clean local reset and 56/56 pgTAP.
2. `pnpm db:types:linked` and confirm no diff against the committed types.
3. `TILE_CORPUS_ROOT=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… pnpm corpus:linked --workspace 638c7f4d-39f2-420b-96d7-6e403cf51cc3`
   — ~2.73 GB across 2,261 objects. Expect roughly the local timings.
4. Re-run the same command and confirm it uploads 0 and inserts 0.
5. Re-run the Supabase advisors and diff against the 113 WARN + 1 INFO baseline
   recorded below.

### Review capacity, not engineering

Nothing commercial was published, deliberately. What is now waiting on a person:

| Queue | Count | What unblocks it |
| --- | ---: | --- |
| Price candidates | 10,183 | Currency (5,936 missing), unit basis (7,235 missing), tax basis, price type, market, effective date. For White Horse, what `W.M Pallet/FOB Price` actually means across 3,743 rows |
| Variant candidates | 6,011 | Brand, category, selling unit; and the 238 duplicate-code groups |
| Certificates | 62 | Scope — all 62 are `unknown`, and a brand folder does not establish one |
| Semantic visual labels | 2,015 | Human confirmation; machine passes are complete and pending |
| Media-to-variant links | 3,344 | 1,513 are `same_source_document` and cannot be approved as they stand; they need an exact page/region, code, or manual match |

### Known gaps in the corpus itself

- **Alpha** (174,006,407 B) and **Bellezza** (382,335,899 B) catalogues are
  recorded `binary_not_staged`. Recovering them means an approved local Drive
  sync or a smaller source PDF; re-running the importer afterwards picks them up.
- **White Horse catalogue imagery does not exist** in the corpus — the
  catalogues are external website links that were not crawled. Crawl permission
  and internal-use image rights are unresolved.
- **`candidate_facts` covers the publication-blocking fields only** (7 per price,
  7 per variant, 5 per certificate). Widening it to every observed field is
  cheap but was not needed for the gate.

### Tooling follow-ups

- `severityLevel` in `import-postgres.mts` is not yet covered by a unit test;
  the other pure mapping helpers are (`tests/unit/corpus-mapping.test.ts`).
- The importer holds the whole candidate set in memory before batching (~62k
  fact rows at peak). Fine at this size; stream it if the corpus grows.
- `api.start_import_run` / `record_import_item` / `finish_import_run` exist for a
  permissioned in-app import but have no UI and no pgTAP coverage yet. The CLI
  writes the ledger directly because it has no user identity.

## Verification / E2E gaps

The features below are typecheck-, lint-, unit-test- and build-clean, and their
core write paths were driven manually in the app. These specific paths were
**not** yet driven end-to-end and should be covered (ideally by an automated
Playwright suite — see below):

- **Import commit to the database.** The parse + column auto-mapping was verified
  against the real workbook via a Node reproduction, but the actual **Commit**
  (create contacts → visits → purchases, with `renovation_area` / `quotation_ref`
  / `quotation_amount` persisted) was not clicked, to avoid writing real customer
  data. Verify with a small **synthetic** CSV. (`src/features/walkins/components/import-wizard.tsx`, `commitImportAction`)
- **Opportunity segment → Command Centre donut.** Editing an opportunity's
  segment in the pipeline and confirming the "Pipeline by segment" donut and
  `sales_scorecard` reflect it. (`opportunity-dialogs.tsx`, `sales-scorecard.tsx`)
- **Accounts & Contacts quick filters.** Only the View selector was driven in the
  browser; the Type / Source / Lifecycle / Activity quick filters and the account
  segments (My accounts / Unassigned) were verified by typecheck only. (`contacts-table.tsx`)

## Automated E2E suite

There is a `playwright.config.ts` and manual QA scripts (`scripts/_sources_*.mjs`)
but no CI-runnable E2E suite. Stand one up covering the critical flows: walk-in
capture (incl. tracker fields), workbook import, pipeline stage change (reason
gates), scorecard target set, Accounts views/filters, and the sidebar collapse.
Wire it into CI so these paths are guarded automatically.

## Production security hardening

From the Supabase security advisors on the hosted project (`ewyiiematuuojlhpioqh`,
run 2026-08-21) — all **WARN**, none blocking. The `api.*` functions are already
protected by internal `core.require_permission(...)` checks and `anon` has no
`api`-schema usage, so they are not reachable unauthenticated; these are
defence-in-depth cleanups, best shipped as one forward migration:

- **Revoke `execute` from `public` on `api.*` SECURITY DEFINER functions** (54
  "Public Can Execute" warnings). `revoke execute on all functions in schema api
  from public;` — the explicit `authenticated` / `service_role` grants remain.
- **Set a fixed `search_path`** on the 3 functions flagged "Function Search Path
  Mutable".
- **"RLS Enabled No Policy"** on 1 table — identify it and either add the intended
  policy or confirm the deny-all is deliberate (it is reachable only via SECURITY
  DEFINER functions / `service_role`).
- The 55 "Signed-In Users Can Execute SECURITY DEFINER Function" warnings are
  expected (these are the app's RPCs, granted to `authenticated` by design) — no
  action, but note them so future audits don't re-flag as new.

## Deployment follow-ups (hosted)

The app is live at `https://tile-concept.vercel.app` against the hosted Supabase.
Remaining production polish:

- **Preview env vars.** The 5 env vars are set for **Production** only. Add them
  for **Preview** (and Development) so PR previews and `vercel dev` work.
- **Custom SMTP for auth email.** Invites/magic-links currently use Supabase's
  default sender (rate-limited to a few per hour). Configure a real SMTP provider
  before onboarding multiple staff.
- **Invite the rest of the staff** with appropriate roles (Platform → Settings →
  Invites, or `scripts/invite-user.ts`; roles in `core.roles`).
- **Custom domain** (optional) instead of `*.vercel.app`; update the Supabase Auth
  site URL + redirect allow-list to match.
- **Compute sizing / backups.** Project is on `nano` compute in Seoul; review
  size and PITR/backups as real usage grows.
- **Verify storage buckets on hosted** (`source-assets`, `product-media`,
  `shoot-outputs`, `permission-evidence`) and their `<workspace_id>/` path
  policies once the source/media flows are used in production.

## Toolchain / CI

Found on 2026-08-21 while getting `main` green again (run
[32425621032](https://github.com/nadeemramli/tile-concept/actions/runs/32425621032)).
None of these block development, but each cost real debugging time once.

- **CI actions still target the deprecated Node 20 runtime.** `actions/checkout@v4`,
  `actions/setup-node@v4` and `pnpm/action-setup@v4` — 6 `uses:` lines across both
  jobs in `.github/workflows/ci.yml` — are being force-run on Node 24 by GitHub,
  which emits a deprecation annotation on every run. Bump all three to `@v5`
  before the forced-run grace period ends.
- **The default WSL login shell runs Node 20, but the project requires Node 24.**
  `.nvmrc` pins `24` and `engines` requires `>=24 <25`, yet a plain shell reports
  `v20.15.1` — and under Node 20 corepack's pnpm shim dies with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, so *every* `pnpm` command fails until
  you `nvm use 24`. The stack trace names corepack rather than the Node version,
  so it reads like a broken pnpm install instead of a wrong shell. Add an
  `.nvmrc` auto-switch (nvm shell hook or `fnm --use-on-cd`) and/or a README line
  so a fresh clone doesn't lose time to it.
- **`main` stayed red for 5+ hours across 4 pushes without anyone noticing.**
  Nothing enforces CI on `main` — pushes land regardless of result. Consider
  branch protection with `verify` and `database` as required status checks, so a
  red build blocks rather than accumulates.

### Fixed in this pass — context worth keeping

- **`pnpm typecheck` silently depended on a prior build.** `PageProps<T>` is a
  Next 16 *generated global*, written to `.next/types/routes.d.ts` by `next dev`,
  `next build`, or `next typegen`; `tsc` never emits it. The script was bare
  `tsc --noEmit`, and CI runs it *before* `pnpm build` on a checkout with no
  `.next`, so all 23 `PageProps` references failed to resolve. It passed locally
  only because a running `next dev` had already written those types — which also
  defeats the obvious reproduction, since deleting `.next/types` while dev is
  running regenerates it instantly. Fixed by making the script
  `next typegen && tsc --noEmit` so it is correct standalone on a fresh clone.
  **Keep this ordering in mind for any future script that runs `tsc`.**

## Already documented elsewhere

- **SQL Account scorecard deferrals** (delivered-vs-collected split, collection
  reconciliation, period outlook, partial-payment tracking) — see PRD §11.3.1.
