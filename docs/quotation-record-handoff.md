# Canonical quotations (TILE-5)

One quotation record, with preparing, issuing and sending kept as separate facts and every earlier version preserved. Staff record quotes from the inquiry drawer, the visit drawer or the opportunity, without opening the pipeline or re-entering the customer. Hosted databases, deployments and data have not been changed, and nothing in this feature sends a message to a customer.

Migration: `supabase/migrations/20261029161000_canonical_quotations.sql` (TILE-5 namespace; it is the only new migration and has no ordering dependency beyond `20261016015608`).

## Model

| Fact | Where | Rule |
| --- | --- | --- |
| Quote identity | `sales.quotes` | Anchored to an inquiry, a visit or an opportunity (at least one). `opportunity_id` is now optional, and quoting never creates an opportunity. Contact and company are copied from the anchors; anchors that name different customers are refused. |
| Reference | `sales.quote_references` | Every quote number and SQL Account SQ number, normalised by `core.quote_ref_key` (`sq-00123` = `SQ 00123`). One reference belongs to exactly one quote; reusing it for a second quote is a 23505 that names the owning quote. |
| Version | `sales.quote_versions` | `prepared_at` (business time) → `issued_at`. A trigger makes a version immutable apart from that single prepared → issued step; a change is a new revision. `evidence_state`: `staff_entered`, `unverified_historical`, `legacy`. |
| Send | `sales.quote_deliveries` | Append-only: actual version, `sent_at` (business time), channel, sender, evidence, `recorded_at`. Unique on version + channel + time, so a repeated mark-sent is one fact. Mistakes are voided in `sales.quote_delivery_voids`, never deleted. |
| History | `sales.quote_events` | Append-only: prepared, revised, issued, sent, send voided, accepted/rejected/expired, reopened, anchors changed, evidence linked. Each also writes an activity (inquiry/visit/opportunity timeline) and an audit event. |
| Visit evidence | `api.visit_quote_evidence`, `sales.visit_quote_evidence_decisions` | A visit SQ note/amount or uploaded file is evidence. It is `matched` when its SQ number is a registered reference, `linked`/`unresolved`/`not_a_quote` when a reviewer decided (append-only chain, stale reviews refused), otherwise `unreviewed`. Nothing is backfilled and nothing is created on upload. |
| Writes | `api.quote_command(action, input, request_id)` | The only write path (direct table/view writes are revoked). Idempotent on `request_id`; a reused id with a different payload is refused. Revisions state `base_version_no`; a stale one is a 40001. |

Actions: `prepare`, `revise` (both may carry nested `issue` / `send` objects, written in one transaction as separate facts), `issue`, `send` (`issue_if_prepared` must be explicit), `void_send`, `accept` / `reject` / `expire` (outcome on the quote only: no purchase, no stage change), `reopen`, `link` (anchor change with reason, before/after kept), `resolve_evidence` (`link`, `create_prepared`, `unresolved`, `not_a_quote`).

Nothing is defaulted into existence: the currency must be stated on every version, including a record a reviewer creates from historical visit evidence.

## Counting contract (for TILE-6 and reports)

- `api.quote_send_facts`: one row per non-voided send. `send_kind` = `first_quote` (the quote's first send, whichever version), `revision` (first send of any other version), `resend`. `sent_week_start` is the Monday of the send in Asia/Kuala_Lumpur.
- `api.quote_register`: one row per quote with `lifecycle` (`prepared`, `issued`, `sent`, `accepted`, `rejected`, `expired`), `first_sent_version_no`, and `pursuit_key` (the opportunity, directly or via the converted inquiry, else the inquiry, else the visit).
- `api.quote_send_summary(from, to)`: per week, first quotations, revisions, resends, distinct quoted pursuits, sends without a pursuit, versions prepared and unverified versions prepared (by `prepared_at`). Row-level security applies.
- Prepared as v1 and first sent as v2 counts one first quotation; a later v3 send counts one revision; resends and retries count nothing.
- Legacy seed/pipeline quotes with an `issued_at` but no send are `issued`, not sent. `api.report_quotes` is unchanged (still opportunity-based) and is left for the reporting worker.

## Entrypoints

- Inquiry Inbox drawer → **Quotations**: quotes on the inquiry and on the opportunity it became; evidence from the inquiry's visits.
- Walk-ins visit drawer → **Quotations** (above **Quotation files**): the visit's and its inquiry's quotes, and the visit's evidence with **Review evidence**.
- Pipeline opportunity drawer → **Quotations** replaces the old *Quote version* dialog (the four-insert `addQuoteVersionAction` is removed).
- Links between them use `/sales/inbox?lead=`, `/sales/walk-ins?visit=` and `/sales/pipeline?opportunity=`. Help & glossary lists every new status.

## Verification run in the TILE-5 cloud session

The Supabase container images could not be pulled in the cloud sandbox (the GitHub container blob host is blocked, Docker Hub rate-limited, ECR over its anonymous limit). Database checks ran on a local Postgres 17 built from the official image plus pgTAP and Supabase's own role/auth/storage init scripts. Generated types from postgres-meta v0.98.0 against `main` were byte-identical to the committed file before this change. The browser suite runs in CI against the full local Supabase stack.

- pgTAP: all 26 suites pass; `supabase/tests/024_canonical_quotations.sql` adds 92 assertions; `012` now writes its quote through `api.quote_command`.
- Real concurrency (separate sessions): two revisions from the same base → one version, the other 40001; three simultaneous mark-sents → one delivery; two identical retries → one delivery, the second replayed.
- Vitest: `src/features/quotes/schema.test.ts`, `src/features/quotes/components/quote-panel.test.tsx` (unchanged-form retry reuses the request id, an edited form gets a new one; role gating).
- Browser (`tests/e2e/quotations.spec.ts`, its own workspace and users): inbox prepare → issued last week → sent this week with a dropped response and retry → repeat mark-sent → revision; reload persistence; visit SQ note matched; counter hand-over; file upload creates no quote, review links it; owner download works, anonymous and other-workspace access refused; historical note becomes only an unverified prepared record; a role without `sales.write` sees disabled, explained actions and is refused by the database.

## Reproducing locally

```bash
pnpm db:start && pnpm db:reset
```

```bash
pnpm exec supabase test db
```

```bash
pnpm exec playwright test tests/e2e/quotations.spec.ts --reporter=list
```

```bash
pnpm db:stop
```

The e2e suite creates and deletes its own workspace and users; it refuses non-local targets.

## Open business questions (not decided here)

- Whether a quote "sent" requires an SQ number. The model records sends with or without one.
- Whether outcomes should require a sent version (today: an issued version).
- Contact and company pages still list quotes through opportunities only.

## TILE-85: per-workspace reads of quotation history

`20261029161100_quotation_history_workspace_reads.sql` changes the read policy on the five tables behind `api.quote_references`, `api.quote_deliveries`, `api.quote_delivery_voids`, `api.quote_events` and `api.visit_quote_evidence_decisions` from `workspace_id in member_workspace_ids() and has_permission('sales.read')` to TILE-62's per-row rule, `workspace_id in (select core.permitted_workspace_ids('sales.read'))`. Under TILE-62, `has_permission` is the acting membership's, so the old pairing let an admin of the acting workspace read another workspace's quotation history through a membership there without `sales.read`, and refused a legitimate reader of a non-acting workspace. Nothing else changes: same single read policy per table, no write path, grant or role change.

`core.permitted_workspace_ids` is TILE-62's. The migration creates it, with TILE-62's byte-identical body, only when it does not exist yet, so it is correct on this stack alone and in the integrated order TILE-62 (`20261029000002`) → quotations (`20261029161000`) → this fix. Do not rerun TILE-62 after the quotation migration instead of applying this fix.

Tests: `supabase/tests/027_quotation_history_workspace_reads.sql` and `tests/e2e/quotation-history-scope.spec.ts` (real password sign-in and PostgREST reads, both mixed-role orientations, suspended and removed membership, an unrelated admin, anonymous).
