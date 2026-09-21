# Reporting, sales and showroom release — 21 September 2026

The release combines the inquiry, opportunity, walk-in review and reporting worktrees on `codex/reporting-funnel`. The user authorized committing and pushing the completed changes to `main`. The separate `codex/creative-production` worktree contains no application changes: its scope/mockup stays a separate future build. The unrelated Microsoft project-media worktree is not part of this release.

## Accepted reporting rules

- MER = recorded net sales revenue, excluding separately stated sales tax, divided by incurred marketing invoice costs **including tax**. Collections are shown separately.
- TikTok, Meta (Facebook/Instagram), Google Ads and shared marketing costs have separate ledgers. Influencer/content/event costs are included in total spend without invented platform attribution.
- Expenses use their incurred date; credits use their own date. Each platform/day uses one daily total or campaign details, never both. Coverage must be explicitly checked, including zero-spend days; later changes invalidate the affected coverage.
- Period revenue/cash and acquisition cohorts answer different questions. A lead created in August that buys in September converts the August cohort but contributes September period revenue.
- Unknown historical sales/payments remain visibly unclassified. Source labels are reported as known origins, not proof of paid-ad causality. Location filters do not allocate shared costs or invent a showroom MER.

## QC journeys

Use the isolated local stack or a staging workspace with synthetic data. Local preview: `http://localhost:4317`. Local seeded accounts are `demo.manager@tileconcept.test`, `demo.showroom@tileconcept.test` and `demo.marketing@tileconcept.test`, password `TileDemo!2026`. These are local fixture credentials, not hosted accounts.

| Area | Journey and expected result |
| --- | --- |
| Inquiry Box | Create a TikTok/Instagram/Facebook inquiry; record WhatsApp sent, reply/no response and an append-only remark. Schedule a future follow-up: find it under Upcoming, with the selected drawer retained. Complete the task and distinguish the completed task from a closed sale. Open a second session and change the record: updates should arrive without losing a draft. |
| Customer identity | Record a walk-in with the inquiry's uniquely matched phone. The inquiry records showroom conversion while preserving its source. A shared/ambiguous phone must require review, never silently pick the first contact. |
| Sales evidence | From an inquiry/visit, save a sale draft, upload an actual receipt, then confirm. Net revenue excludes discount/tax; a deposit adds only to collections. Check a dated credit and separate cash refund without duplicate revenue. |
| Companies and opportunities | Create a company without an opportunity, add an opportunity later, also create one from a contact, edit it and upload a captioned photo. Archive and restore it: active pipeline/operational reports omit archived opportunities, while history remains. Winning an opportunity alone must not count as confirmed revenue. |
| Marketing spend | Enter MYR 100 before tax plus MYR 6 tax: invoice spend is MYR 106. Add shared content cost. Confirm all four groups' coverage, then correct a cost: its coverage becomes incomplete. Duplicate daily totals and duplicate vendor credits must fail. |
| Funnel dashboard | Open Reports → Marketing & showroom dashboard. Check period, as-of date, channel stages, reply-to-sale conversion and showroom staff/visit history. Follow customer history and purchase links. MER stays unavailable with incomplete spend coverage or a zero/negative denominator. Check visible historical financial coverage warnings before interpreting totals. |
| Google review | From a resolved walk-in, prepare at least two neutral answers, record WhatsApp agreement and separate media permission, and upload photos if agreed. Preview the editable WhatsApp message. Open the private link without staff login, edit/confirm private feedback, copy the draft, save photos and open the Google listing. Opening Google is not proof of a posted review. Verify reported/verified states, replacement-link invalidation and revocation. |

Detailed checks: [inquiry operations](./inbox-live-handoff.md), [opportunity workflow](./opportunity-workflow-handoff.md), [walk-in review handoff](./walk-in-reviews-handoff.md), [sales evidence and collections](./sales-evidence-handoff.md).

## Verification evidence

- All migrations replayed from a clean database in the isolated `tile-concept-reporting` runtime. The original checkout and its private corpus database were not reset.
- 169 unit tests passed. All 15 database suites passed (487 assertions), then the updated marketing suite passed with two additional regression assertions (489 assertions covered in total).
- TypeScript and optimized production build passed. ESLint has zero errors and one existing TanStack React Compiler warning.
- All 12 existing Playwright end-to-end tests passed against the optimized build, including guest isolation and role denial.
- Feature browser checks covered live inquiry updates/draft retention, actual receipt/photo uploads, opportunity creation/edit/archive/restore, anonymous review confirmation, and desktop/mobile reporting/spend layouts. These are functional checks, not a production-scale performance benchmark.
- API/marketing/reporting SQL lint reports the existing `api.shoot_conflicts` error (`abs(interval)`) and older ingestion warnings (`record_extraction`, `approve_review_item`, `start_sync_run`, `approve_certificate_candidate`). No new function finding was reported. Prior security advisor findings include existing mutable helper search paths and overlapping policies; this is not a claim of a clean security audit.

## Deployment and operational follow-up

1. **Completed on 21 September 2026:** the eight migrations from `20260921021742_inquiry_operations.sql` through `20260921051515_atomic_manual_inquiry.sql` were applied to hosted Tile Concept after a dry run confirmed that exact set. The deployed funnel page had failed because code was released before these database functions existed. Reloading the hosted page after migration restored the dashboard and customer history. Future releases must apply compatible database migrations before serving dependent code; **never use the local reset command on hosted data**.
2. Set `TC_GOOGLE_REVIEW_URL` to the supplied listing fallback `https://share.google/PNz6R4QrCC4xRNhFm`, or a subsequently verified direct Google review URL. Only the ignored local environment is configured now. Confirm `NEXT_PUBLIC_APP_URL` is the public HTTPS origin. One Google destination per environment is currently supported.
3. Verify hosted private Storage policies and Realtime channel authorization. The inbox shows connection state and falls back to periodic refresh if live updates are unavailable.
4. Run the QC journeys as manager, showroom and marketing roles on staging, then verify a real phone's camera/gallery, WhatsApp message and correct Google business listing. The app cannot silently submit a Google review or attach images through WhatsApp click-to-chat; the message links to the customer page containing the photos.
5. Have Claude Code independently test concurrent edits/retries, role/workspace isolation, realistic history volumes and query performance. The handoff is local; it has not been sent to another service.

Known limits: historical financial classification needs business review; platform cost-per-lead uses known source labels rather than ad-click attribution; the inherited opportunity pipeline query retains its 2,000-record ceiling; abandoned feedback photo intents can consume upload slots until cleanup; physical-device and hosted integration checks remain outstanding. The creative production board will be built separately.

## Reporting display repair

The featured dashboard link on the Reports index was an inline anchor containing block content. Its border/background and padding therefore rendered as fragmented strips instead of one card. It now has a block layout, mobile padding, and a nonshrinking arrow. A report-specific error boundary retains the app navigation and gives retry/back-to-reports actions if a report later fails.

Browser verification covered the hosted funnel after migration, the repaired Reports card at desktop and phone sizes, and navigation into the dashboard. Hosted verification used the isolated guest/demo workspace; no customer records were changed. Existing hosted security-advisor warnings remain a separate hardening task (privileged-function grants, helper search paths and authentication configuration).

## Remaining development versus rollout work

| Category | Remaining work |
| --- | --- |
| Feature build | Creative production board, publishing calendar and creator queue, connected to content opportunities and shoots. The existing worktree contains the scoped design, not implementation. |
| Later integration | Automatic WhatsApp send/reply synchronization; manual updates remain the agreed first version. |
| Usability and scale | Replace the inherited 2,000-opportunity query ceiling with server pagination; reclaim abandoned feedback photo-upload slots. |
| Review rollout | Configure the hosted Google listing/review destination and test camera, photos, WhatsApp and Google on a real phone. Separate destinations per showroom are not implemented. |
| Independent QC | Concurrent changes/retries, realistic history volumes, hosted Storage/Realtime checks and performance profiling. |
| Business data review | Classify historical sales and collections and reconcile actual marketing spend; these are operational inputs, not invented engineering fixtures. |
| Release process | Add a hosted migration-readiness check before promoting app code so a deployment cannot repeat the missing-function failure. |
