# Walk-in linkage — second reporting foundation

F2 connects a confirmed showroom customer and visit to the original buying inquiry. Previously every walk-in created another lead, so a TikTok inquiry could never acquire its showroom milestone through the normal counter flow. This delivery follows F1 (`10fe5e7`) on `codex/reporting-funnel`. It remains local; no hosted migration, push, merge or deployment has been performed.

## Staff workflow

The existing phone-first customer confirmation stays in place. On Review, a single unambiguous earlier inquiry is linked automatically. The inquiry keeps its marketing source, owner and WhatsApp milestones. Every visit remains a separate ledger record, while the inbox derives one first-showroom timestamp and a visit count. Staff can find these inquiries in **Visited showroom**.

Multiple buying inquiries, shared identifiers, provisional customers, closed inquiries and conflicting identities prevent automatic attribution. Staff can choose a matching inquiry with a reason, start a separate Walk-in inquiry, or save as **Needs linking**. Conflicting customer identities cannot be overridden through this chooser. A continued visit to a closed inquiry does not reopen its sales outcome.

The **Needs linking** ledger filter queries the whole authorized visit population with server pagination. Opening a visit permits a reasoned correction and shows correction history. Corrections recalculate both inquiries' showroom milestones and retain audit evidence. A linked opportunity must remain consistent with the inquiry; staff cannot relink it to an unrelated buying inquiry.

## Data and permissions

- Apply `supabase/migrations/20260921032114_walk_in_inquiry_linkage.sql` after the F1 migration, before deploying this app version. Never apply the local fixtures/password seeds to hosted environments.
- Existing visit links are labelled `legacy`; no historical digital attribution is guessed or backfilled.
- `api.record_showroom_visit` writes the visit, link, tracker fields, optional project/opportunity/purchase, activity and audit in one transaction. A workspace/request-ID lock and payload/actor comparison make retries of the same request return the same result. The wizard keeps this token while mounted; this is not a persistent offline draft.
- `api.record_walk_in` remains a compatibility wrapper and now uses the same safe matching rules. Legacy clients without a request ID still need their own duplicate protection.
- Corrections use a link version to reject stale edits. Direct authenticated writes cannot bypass the visit-link commands. The private request ledger has RLS and no authenticated/anonymous access.
- The `showroom` role gains `sales.leads.read_all`, matching the existing shared read access for sales reps. Existing inquiry edits and opportunity creation remain owner/manager controlled. Counter staff can record visits to another rep's inquiry without taking ownership. New direct inquiries retain the selected serving staff member as owner.
- “How they heard” remains a visit-level, self-reported field. It does not overwrite an existing inquiry's acquisition source. Unknown contact acquisition is filled from a confirmed inquiry only.
- The wizard sends an explicit Malaysia offset. Matching only considers inquiries received by the recorded visit time. Repeated visits do not fabricate WhatsApp replies or new lead conversions.
- Spreadsheet imports reject shared/ambiguous phone identity instead of taking the first matching customer. Tracker fields now save atomically. Bulk import is still a row-by-row operation with its existing preview/duplicate-review workflow; this is not a new resumable import job.
- Direct visit links and their linked purchases are fetched by ID/context, rather than relying on the latest 500 visits. The separate purchase ledger retains its existing recent-record limit pending F3.

## Local verification

Only synthetic data was used in the isolated Supabase project `tile-concept-reporting` (API 61321, database 61322). The original checkout/database and hosted project were not reset or modified.

- Clean migration/seed rebuild succeeded.
- 146 unit/component checks passed; optimized Next.js build and TypeScript passed.
- 233 pgTAP assertions passed across nine suites, including 65 new checks for clear/ambiguous/conflicting identity, repeat visits, first milestone, direct acquisition, closed continuation, ownership/account boundaries, stale corrections, atomic rollback, optional purchases/opportunities and retry deduplication.
- ESLint: no errors; existing TanStack Table/React Compiler warning remains. Sales-schema database lint is clean.
- Broader database lint found a pre-existing error in `api.shoot_conflicts`: `abs(interval)` is undefined. It also reported pre-existing extraction/review/certificate/sync warnings. The new/changed visit and inbox functions produced no lint findings. This broader check is not represented as passing.
- Browser walkthrough as **showroom staff**: formatted phone lookup → confirmed customer → automatic TikTok inquiry link → original inquiry shows first showroom visit, original owner/source and untouched WhatsApp fields. Separate walkthrough: two possible inquiries → save Needs linking → open visit → select Meta inquiry with reason → history and link update. Desktop and 390px layouts inspected; browser console had no errors or warnings during those flows.

These checks establish local functional evidence, not hosted readiness or production-scale performance. The final reset removes the temporary browser fixtures; screenshots remain in ignored `output/playwright/` for local review.

## Claude Code review handoff

Use `/home/nadeemramli/workspace/github.com/nadeemramli/tile-concept-reporting`, branch `codex/reporting-funnel`. Read `CLAUDE.md` and [the F1 handoff](inquiry-operations-handoff.md), then record the exact `git rev-parse HEAD` with findings. The handoff is prepared locally; it has not been transmitted to another agent or service.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec supabase test db --workdir .local/runtime
pnpm exec supabase db lint --local --workdir .local/runtime --schema api,sales --level warning --fail-on error
pnpm build
```

Independently review:

1. Concurrent staff saves, simultaneous identity changes, network-uncertain retries, double-clicks, stale corrections and browser navigation. Retry coverage currently includes sequential database replay and browser success flows, not a fault-injected concurrency benchmark.
2. Sales rep, showroom, manager, non-sales and cross-workspace boundaries through both UI and direct API. Confirm the intended showroom shared-read permission and unchanged owner write restrictions.
3. Shared phone, email conflict, merged/archived contact, multiple projects, closed/won/lost inquiries, backdated visits and Malaysian midnight. Test the identity-review workflow before resolving a conflict; no contact merges happen here.
4. Lookup and inbox query plans at representative volume, including customers with many inquiries and old visits beyond former caps. The current evidence is functional, not a throughput claim.
5. Existing visit/opportunity/purchase consistency before proposing historical repairs. Preserve the old link and reason in an audit; do not bulk infer historical campaign credit.
6. The existing shoot-calendar lint error and older review/certificate warnings as separate findings. Confirm hosted migration/commit state before any rollout.

F3 remains sale/receipt evidence, recorded net sales, collections and adjustments. F4 is daily/event marketing expenses; F5 is the reconciled funnel dashboard. MER remains recorded net sales divided by total marketing spend, with collections shown separately.
