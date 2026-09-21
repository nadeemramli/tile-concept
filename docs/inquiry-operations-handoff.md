# Inquiry operations — first reporting foundation

This branch implements the first bounded delivery (F1) of the marketing funnel scope approved for development on 21 September 2026. It does not yet implement showroom matching, sale/receipt capture, marketing expenses or the funnel dashboard. No hosted migration or production rollout has been performed.

## Result

Staff can record WhatsApp sent, an actual customer reply, another contact attempt, no response, follow-up scheduling/rescheduling/completion, lost and reopening. Future reminders appear immediately in Upcoming. Completed work stays discoverable; the selected inquiry stays open when its current filter no longer matches. All inquiries, search and direct links retain access to authorized history.

The default table prioritizes next follow-up, customer, source, owner, stage and staff-contact timing. Extra columns remain selectable. The inquiry drawer uses the full phone viewport, with action controls before contact details on narrow screens.

Search, owner/source filters, pagination and view counts run in PostgreSQL across the authorized population, replacing the former 500-lead and 1,000-task limits. Private task bodies keep their existing read scope; the inbox exposes a minimal shared next-action summary. Read failures show a retry state rather than an empty queue.

## Data and compatibility

- Apply `supabase/migrations/20260921021742_inquiry_operations.sql` before deploying this application version. It is a forward migration; do not apply local seed/password fixtures to a hosted database.
- Explicit sent/reply/outcome timestamps are additive. Historical `first_response_at` remains a staff response and is **not** backfilled as a customer reply. Existing inquiry source fields and connectors retain their meaning.
- `api.work_inquiry` locks the lead, checks workspace and owner permissions, records progress/tasks/activity/audit in one transaction, and deduplicates retries by request ID plus payload. Changed payloads require a new request ID. The UI retains that ID after an unconfirmed submission while the dialog remains mounted.
- Follow-up completion requires an outcome. Marking Lost cancels outstanding lead tasks with the reason; reopening requires a reason and due date. Lead reassignment transfers outstanding reminders.
- The Tasks screen uses transactional completion too. Lead-linked task edits check inquiry ownership; a lost inquiry cannot regain an open follow-up through Tasks.
- No response means an explicitly unsuccessful contact attempt. A subsequent recorded reply or later contact attempt clears that current-outcome view. It does not erase earlier customer replies.
- All event dates and due-day boundaries use Kuala Lumpur time. Repeated follow-ups do not create new inquiries or customer-reply milestones.
- “Converted” is labeled “Opportunity created”; it is not represented as a purchase.

## Validation

Validated using only synthetic data in a separate local Supabase project, `tile-concept-reporting`, API port 61321 / database port 61322. The original checkout and its local database were not reset. The isolated stack was rebuilt from all migrations and synthetic seeds.

- 146 unit/component assertions pass.
- 168 database assertions pass across eight pgTAP files. New coverage includes retry deduplication, rollback when history fails, no fabricated replies or purchases, future/overdue/completed reminders, lost/reopen, ownership transfer, private task scope, anonymous/non-sales/cross-workspace denial, and searching/paging 1,100 inquiries with 1,100 reminders.
- TypeScript and the optimized Next.js build pass.
- ESLint has no errors. The existing TanStack Table / React Compiler compatibility warning remains.
- Browser walkthrough: create inquiry → record WhatsApp sent → schedule a three-day follow-up → find it in Upcoming → complete it with outcome → record actual reply. Reply stays empty until explicitly recorded. Desktop and 390px phone layouts inspected; no console warnings/errors during that walkthrough.

This is local implementation evidence, not proof of the hosted deployment state or a production-scale performance audit.

## Claude Code verification handoff

Review branch `codex/reporting-funnel` in `/home/nadeemramli/workspace/github.com/nadeemramli/tile-concept-reporting`. Record `git rev-parse HEAD` with findings. Start with `CLAUDE.md` and the migration and query code; use synthetic data only.

On this machine, `.local/runtime` already points to the isolated database. Use Node 24 and pnpm 11:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm exec supabase test db --workdir .local/runtime
pnpm build
```

Independently verify:

1. The full inquiry journey as a rep, teammate and manager, including refresh/back navigation, future reminders, completed history, loss, reopening and reassignment.
2. Double-clicks, uncertain network results and retries; simultaneous staff actions and stale task selections. Check rollback and eventual refresh of both Inbox and Tasks.
3. Phone/name search, source/owner filters and consistent counts beyond former limits. Test the Kuala Lumpur midnight boundary and undated legacy tasks.
4. Unauthorized writes from direct API calls, cross-workspace IDs, and private task/attachment visibility. Check that old first-response values never become customer replies.
5. Representative-volume query plans and latency, particularly the per-lead follow-up summary. The 1,100-record regression fixture proves coverage, not production scalability.
6. Hosted application commit and migration history, then reproduce the staff-reported disappearing-follow-up issue safely. Production cause has not been independently confirmed.

Report reproducible findings against the exact commit. Resolve findings before rollout. This handoff has been prepared locally; it has not been sent to another service or agent.

## Remaining delivery

F2 links confirmed walk-ins to the original inquiry without guessing ambiguous phone matches. F3 separates recorded sale value from collections and adds receipt evidence. F4 adds daily/event marketing expenses. F5 builds the reconciled business-period and lead-cohort dashboard. The accepted reporting basis remains recorded sales for MER, with collections separate; sample redacted business documents are still needed to settle historical sale/collection and tax mappings.
