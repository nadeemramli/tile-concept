# Inquiry Inbox database QC — 21 September 2026

The reported database failure is **not yet reproduced**. This change adds narrowly scoped diagnostics; it does not claim to fix an unknown database cause. No schema or hosted data changes were made.

## Checked

- Deployed guest session: `/sales/inbox` loads 14 synthetic demo inquiries; opening an inquiry shows its contact, source, progress, and activity without a database error.
- Hosted database, read-only transactions: the active administrator and all six sales representatives successfully read the inbox, a selected inquiry, its intake and activity, and reference profiles, memberships, and locations. Each bundle took 357–684 ms with an 8-second statement timeout. Only aggregate results were returned; customer records were not exported.
- Fresh isolated local stack (`tile-concept-inbox-repair`, ports 62321/62322), all existing migrations: `008_inquiry_operations.sql`, `011_inbox_live.sql`, and `015_manual_inquiry.sql` pass. These cover queue/history preservation, ownership and workspace boundaries, retries, ambiguous identity, and rollback.
- Local browser against synthetic data: capture inquiry → open saved drawer → record WhatsApp sent → schedule follow-up. The inquiry remains selected, activity refreshes, and the future follow-up is available through Upcoming.
- Realtime was intentionally omitted from the isolated stack; its socket returned 503 while the inbox continued using polling. This local setup condition is not evidence of a hosted failure.
- Seven new query tests pass. TypeScript and targeted ESLint pass.

## Diagnostic change

Failed reads now emit `inquiry_query_failed` with only a fixed operation name and a validated SQLSTATE/PostgREST code (or `unknown`). There are no query arguments, record/user/workspace IDs, error messages, details, hints, or customer content in that diagnostic. Staff still see the existing safe error message and retry behavior. Failed reads are not converted into empty results.

Covered operations: `inquiry_page`, `inbox_leads`, `intake_events`, and `entity_timeline`.

The Vercel runtime-error connector returned 403 during this investigation, so historical application errors could not be inspected through that connector. A concrete triggering step/error remains necessary to diagnose any failure outside the verified cases.

## Follow-up QC

1. Open Inquiry Inbox and switch between Needs action, All inquiries, and Upcoming. Search and select a record; confirm the drawer and history load.
2. In a synthetic preview workspace, create an inquiry, record WhatsApp sent, then schedule a future follow-up. Confirm the saved inquiry stays selected and appears in Upcoming.
3. If the failure recurs, note the time, page URL, staff role, and action immediately before it. Check server logs for `inquiry_query_failed` at that time. Do not copy customer details into issue comments or tests.
4. Use the operation and database code to reproduce the exact failure before changing permissions, SQL functions, or schema.

## Integration touchpoints

Branch: `codex/inbox-database-repair`, based on `78eae98`.

Only `src/server/queries/leads.ts` changes runtime behavior. It adds a local helper and replaces four generic throws with the diagnostic helper. `src/server/queries/leads.test.ts` supplies the seven tests. Claude's `perf/inbox-drawer-and-shell` work may change this same query file; retain equivalent safe diagnostics if it moves or splits these reads. No generated database types or migrations change.
