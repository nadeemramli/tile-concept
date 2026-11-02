# Editable enquiry received date

An enquiry can be entered after the customer originally contacted the team. `sales.leads.received_at` now records that business event; `created_at` remains the system entry timestamp and cannot be edited through runtime updates.

## Staff workflow

- New inquiry has an optional **Enquiry received at (Kuala Lumpur)** field. Blank means now.
- The enquiry drawer shows both **Enquiry received at** and **Entered into system at**.
- The assigned owner, an authorized manager, or a writer on an unassigned enquiry can use **Edit enquiry received date**. A correction reason is required. The database enforces workspace membership and permissions independently of the UI.
- Corrections retain the previous/new date, previous/new response deadline, author and reason in immutable Activity/audit history. Concurrent stale edits fail; retries with an unchanged request ID return the original committed result.
- Received dates cannot be infinite, more than five minutes into the future, or later than an already recorded action, visit or sale. System entry time cannot be changed. Privileged identity attachment to history still works.

WhatsApp and other enquiry actions compare their event time with `received_at`. They can precede system entry but cannot precede the actual enquiry. Date inputs use an explicit Kuala Lumpur offset and retain seconds when editing an existing timestamp.

## Reports and imports

The inbox Received column/sorting, aging counts, command-centre aging, lead-source reporting, response durations, funnel cohorts/drilldowns, and applicable journey queries use the received date. Lead-source report day boundaries explicitly use Asia/Kuala_Lumpur. Visit/sale event timestamps keep their own meanings. First-response deadlines shift by the existing SLA offset when the received date is corrected.

Manual capture and connector intake store receipt time atomically. Connector deduplication uses the source event's date window rather than the batch entry date. Historical TikTok/tracker import scripts no longer rewrite `created_at`. Direct showroom lead creation records the visit time as receipt and retains system entry separately.

## Migration and release

Apply `supabase/migrations/20261102080641_enquiry_received_date.sql` before deploying this application revision. It adds/indexes `received_at`, preserves view column order/security/grants, and updates known date consumers in their current installed definitions. This deliberately preserves deployed Telegram/routing additions, including the actor-based command wrapper. The migration asserts that both supported action implementations were translated.

Existing leads initially receive their previous `created_at` value as `received_at`; no historical dates are guessed. Older import scripts already overwrote some creation timestamps. This migration cannot reconstruct those lost original entry times; the retained value is legacy evidence, not a newly verified entry time. Staff should correct actual receipt dates against their source history. Do not change historical customer data without identifying the relevant enquiry and evidence.

Release rollback should retain the additive column and correction history. The preceding app can still read these views; do not drop corrected dates or rewrite system entry times to undo a UI release.

## Observed verification — 2 November 2026

- All 940 database checks pass on isolated PostgreSQL/Supabase with the full synthetic seed, including 39 new date regressions.
- Those 39 regressions also pass locally using the exact deployed `api.work_inquiry` wrapper and `sales.work_inquiry_as`/permission/audit helper source, with synthetic records only.
- All 263 unit tests pass with two workers. The first unrestricted run had one unrelated area-selector timeout under local resource load; no assertion or timeout was relaxed.
- Type generation/typecheck, lint and production build pass. Lint retains the pre-existing TanStack compiler warning with zero errors.
- Compiled browser verification created an enquiry with 1 January 2025 receipt, corrected it to 31 December 2024 23:55 KL, and saved WhatsApp sent at 23:59. System entry remained 2 November 2026. The report counted it in December, excluded January, and calculated four response minutes; one date-correction activity was stored.
- Browser verification used local API/auth/database services. Realtime was excluded from this disposable fixture; its expected websocket failures showed the existing polling fallback. Realtime behavior was not re-certified.

No production migration, customer-record correction, merge or deployment was performed by this implementation task.
