# Engineering backlog

Non-blocking follow-ups. Product/feature backlog lives in the PRD; this file is
for verification and technical debt we chose to defer.

## Corpus migration — remaining steps

The 2026-08-21 discovery corpus is **imported and fully reconciled on the hosted
project** (`ewyiiematuuojlhpioqh`) as well as locally. See
[Corpus Compatibility Map](architecture/Corpus%20Compatibility%20Map.md).

### Catalog and pricing are live (2026-08-21)

Reference data and a first published catalog are on the hosted project:

| | |
| --- | ---: |
| Products / variants | 5,087 |
| Live prices (`state = 'current'`) | 6,575 |
| Price lists | 5 |
| Brands (all `unreviewed`) | 19 |
| Attribute definitions / category rules | 22 / 28 |
| Product attribute values | 10,889 |
| Variants with a stated size | 960 |
| Variants with stated packaging | 4,462 |
| Packaging configurations | 8,816 |
| Review tasks remaining | 2,785 |
| Price candidates still pending | 3,482 |

Migration `…10_publish_corpus_priced_catalog` did the bulk approval. Four things
no source states were decided by the business and are recorded on every row:
currency **MYR**, tax **exclusive**, validity **from 2026-08-21**, and the unit
basis per source label — White Horse **pallet** (its column reads `W.M
Pallet/FOB Price`), Belleza **piece**, generic RM lines whatever unit the text
itself stated. Each published price carries a `source_ref` saying so, and each
has a `review_decision`, so these are findable and revisable rather than
indistinguishable from source facts.

**What that means for anyone reading the catalog now:** the *amounts* come from
the documents; the *meaning* around them was supplied on 2026-08-21. If it later
turns out White Horse quotes per square metre rather than per pallet, every
affected row can be found by its price list and corrected.

### A re-import used to un-decide everything (fixed 2026-08-23)

Migration `…11_protect_review_decisions` closed a bug that had already fired
once. The importer writes candidates with a PostgREST upsert, and an upsert
writes every column in its payload on the update path too — including the
literal `review_state = 'pending_review'` a *new* candidate needs. So each run
silently un-decided every row it re-observed.

On 2026-08-21 the bulk publication approved 6,701 price and 5,126 variant
candidates at 01:53:39; a reconciliation re-import at 01:55:28 set all of them
back to pending. Nothing was lost — the published catalog was untouched, and
`review_decisions` is append-only — but for two days the review queue claimed
10,183 prices and 6,011 variants needed a person when 11,827 of them were
already decided, and `corpus:reconcile` printed *"nothing is published"* over a
live catalog of 6,575 prices.

The fix is a trigger on all 14 upserted `ingest.*` tables refusing exactly one
transition — decided → pending — while letting the rest of the payload through.
Restoring rather than raising is deliberate: the importer legitimately rewrites
the source-derived columns of thousands of rows per batch, and an exception
would make a re-import impossible instead of correct. The repair rebuilt each
decision only from evidence that survived. `api.corpus_reconciliation` now also
exposes what was *independently* published, and the reconciler raises an
exception when the two disagree, so this class of drift cannot go quiet again.

### Still pending, and why

- **3,482 price candidates.** 2,794 carry no product code and 688 name a variant
  that was never extracted as a candidate. Publishing either would create priced
  products with no identity.
- **885 variant candidates** with no price.
- **62 certificates**, all `scope_type = 'unknown'`. A brand folder does not
  establish scope.
- **2,015 semantic visual labels** awaiting human confirmation, and **1,513**
  same-document media links that cannot be approved as they stand.

### Follow-ups this created

1. **The 19 brands are unreviewed.** Each is a Drive folder label, which may name
   the brand, the manufacturer, the supplier, or all three. Confirm each, and
   split any that turn out to be two entities.
2. **Every product is categorised `tile`.** The corpus never assigns a category;
   this was a blanket decision to get a navigable catalog. Mosaic, wall panel,
   cut tile and accessory products are in there miscategorised.
3. **Products have attributes now, for the subset that stated them.**
   `…12_catalog_attributes` installed the vocabulary on hosted (22 definitions,
   28 category rules, including `cartons_per_pallet`, which the seed never had
   and the White Horse list states for 3,743 variants) and filled it: 960
   variants carry a size and 4,462 carry packaging, 10,889 values in all, plus
   8,816 `packaging_configurations`.

   What it deliberately did **not** fill: 350 variants whose source states a size
   with no unit — a bare `306X 306X6` — or offers more than one size. Read as
   millimetres the first is an ordinary tile and as centimetres it is absurd, so
   mm is almost certainly right; almost certainly is a guess, and a guessed
   millimetre is indistinguishable from a stated one once it is a number in a
   column. They are `dimension_unit_unstated` review tasks instead.

   Still empty: everything the corpus never stated — `edge`, `grade`,
   `sqm_per_carton`, and the mosaic sheet/chip attributes.
4. **377 same-code collisions were collapsed.** 5,464 variant candidates became
   5,087 products, because the same supplier code appeared under one brand in
   more than one source. That is the right default, but the 238 unresolved
   duplicate-code groups still deserve a look.
5. **Only 13 of the 95 low-confidence price tasks were auto-resolved** — the ones
   whose source document produced published prices. The rest still need a person.

### Review capacity, not engineering

The priced, identifiable portion of the corpus is published. What is left needs
a person rather than more engineering — in every case because the source does
not say the thing, not because nothing has parsed it:

| Queue | Count | What unblocks it |
| --- | ---: | --- |
| Price candidates | 3,482 | All are `generic_rm_line_candidate` — RM amounts found in catalogue prose, not a price table. 2,794 carry no product code at all and 688 name a variant never extracted, so there is nothing to attach them to. Needs better extraction or a person reading the page |
| Variant candidates | 885 | Brand, category, selling unit; and the 238 duplicate-code groups |
| Product sizes | 350 | The source states a size with no unit (`306X 306X6`) or offers several. Confirm the unit, or which size is the product |
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
- **The review UI is built for the upload flow, not for corpus tasks.** A
  `certificate_scope_review` or `duplicate_code_resolution` task renders with the
  product/price correction fields, because `correctableFor()` keys off
  `item_type`. The task types have readable labels and the queue is usable, but
  each corpus task type deserves its own editor.

### Authentication

- **Custom SMTP is still not configured** (`smtp_host` is null). Auth emails go
  through Supabase's default service, which their docs call best-effort and
  intend for "testing email templates with the members of the project's team".
  An invitation to a staff address may never arrive, so
  `scripts/provision-user.mts` is the reliable route for now — it creates the
  account and prints a one-time password instead of relying on delivery.
  Configuring Resend (or any SMTP provider) would restore the normal invite flow;
  also raise the auth email rate limit afterwards, which defaults low.
- **Self-signup was open on the hosted project until 2026-08-21** — `disable_signup`
  was `false` while `supabase/config.toml` said `enable_signup = false`. Now closed.
  Nothing was exposed: an account with no membership sees nothing through RLS. But
  the hosted auth config is not covered by any migration, so it can drift again;
  `supabase config push` is **not** the fix, because it would overwrite `site_url`
  with the localhost value from `config.toml`.
- **`scripts/invite-user` and `provision-user` are `.mts`, not `.ts`.** A `.ts`
  script with top-level await fails under tsx, because package.json has no
  `"type": "module"` so esbuild targets CJS. `invite-user` had this latent bug
  from the start and had never been run in this environment.

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
  Invites, or `scripts/invite-user.mts`; roles in `core.roles`).
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
