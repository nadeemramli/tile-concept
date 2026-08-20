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

## Already documented elsewhere

- **SQL Account scorecard deferrals** (delivered-vs-collected split, collection
  reconciliation, period outlook, partial-payment tracking) — see PRD §11.3.1.
