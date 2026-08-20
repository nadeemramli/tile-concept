# Engineering backlog

Non-blocking follow-ups. Product/feature backlog lives in the PRD; this file is
for verification and technical debt we chose to defer.

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

## Already documented elsewhere

- **SQL Account scorecard deferrals** (delivered-vs-collected split, collection
  reconciliation, period outlook, partial-payment tracking) — see PRD §11.3.1.
