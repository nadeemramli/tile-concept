# Creative production — implementation and release handoff

Integration branch: `codex/creative-production`. Route: `/marketing/creative`.

## Release state

The real database-backed workflow is implemented and exercised locally. It is not yet deployed. The branch includes `origin/main` through `faac3aa`, including Claude's Inbox performance work (PR #11) and sidebar/session handoff (PR #12). The original dirty `perf/inbox-drawer-and-shell` checkout was preserved without resets, stashing or edits.

The remaining release decision is separate from Creative: an already-hosted migration grants sales representatives `sales.read_all`, `review.approve` and `report.read`. Existing code also uses `sales.read_all` to permit editing another salesperson's records. The user is being asked whether this should mean shared viewing with owner-limited editing, or shared editing. Do not silently choose a policy or weaken ownership tests to clear CI. The isolated candidate is commit `07dc116` on `codex/sales-shared-view-owner-edit`; its own checks passed 645 SQL assertions, 204 unit tests and a representative role browser flow. It is not integrated or deployed. If that policy is chosen, cherry-pick only `07dc116`: its prerequisite grant import is already in this branch. Its handoff documents preserved unassigned-record behavior and the limits of this bounded repair.

## What users can do

- Create a deliverable from Creative, an accepted/scheduled/completed content opportunity, a shoot, or an approved output. Source context pre-fills the brief while preserving links to the original records.
- Choose a practical brief template, owner, reviewer, format, channels, source mode and deadlines. Record the objective, audience, hook, call to action, shot plan, required coverage and copy.
- Work through Briefing → Preparing → In production → Review → Approved. Blocked, on hold and cancelled are separate work conditions. There is no drag-and-drop shortcut around readiness, review or publication requirements.
- Link customer opportunities, shoots and typed external material. Record source access and coverage, and retain the customer media permissions and restrictions for every linked source.
- Submit numbered exports, request changes, submit another version and approve a specific version. Earlier submissions and review decisions remain visible. Owners/submitters need explicit self-approval permission; the designated reviewer must perform the review.
- Plan each channel/account release separately, record external scheduling evidence and then record the actual publication time and live URL. Scheduled/Published derive from those records. One of two scheduled releases does not mark the whole creative Scheduled; both must be scheduled or published. Published history survives reopening for a new cut.
- Use Board, Content Calendar, My Work and All Creatives. Board columns and lists page on the server. My Work includes items owned by or awaiting review from the current person. Calendar offers month/week/agenda and distinguishes channel releases from unique creatives. Dates use Kuala Lumpur time; unscheduled work stays discoverable.

Lists refresh every 30 seconds while visible, with a manual Refresh control. Refresh pauses while a drawer or editing dialog is open. Concurrent saves use revision checks and request IDs; a stale save shows an error and retains form values instead of overwriting a colleague's changes. Retry after the refreshed record loads.

External files, schedules and published links are staff-entered references. The app neither uploads Creative media nor changes external sharing, schedules posts, sends messages or proves that a remote file exists. If customer permission is revoked or a linked shoot changes, affected work needs attention and external-action flags remain until staff record what they did.

## Five-minute client demonstration

1. Enter through the official **Enter as guest** button, then Marketing → Creative. The isolated demo workspace has eight clearly labelled synthetic examples across all seven stages, including blocked preparation. Example URLs deliberately use `example.invalid`.
2. Open **Demo: customer story version 1**. Show the brief, linked project/shoot, permitted uses, version and review action. No real customer or message is involved.
3. Open Content Calendar. Switch month/week/agenda and target/scheduled/published date basis. A creative with two channel releases contributes two releases and one unique creative.
4. Open **Demo: approved kitchen showcase** to show that approval can coexist with an unscheduled release. Open the scheduled and published examples to show the separate channel histories.
5. From a source opportunity or shoot, inspect the linked deliverables or start **Create creative** to show the pre-filled context. Cancel if only demonstrating navigation.

The shared demo can be edited by guests and resets through the existing demo maintenance flow. Demonstrate production mutations in a synthetic preview workspace, not in client records.

## Verification completed

- Creative database tests: 87 lifecycle/security assertions plus 21 demo/current-version assertions. Covers immutable submissions, exact-version approval, multi-source permission/expiry/revocation, stale writes, retry idempotency, derived publication states, scoped reads and demo isolation.
- Before reconciling the separately applied sales grant, the integrated database suite passed **609 assertions across 18 files**. After importing that exact hosted grant, the suite has **612 assertions with 20 failures** reflecting the permission-policy conflict and newly permitted reads. This is an unresolved release check, not a clean final database result.
- Integrated TypeScript and lint passed; lint has the existing TanStack React Compiler warning. The unit suite passed **191 tests**. The optimized production build generated 51 routes successfully, including after the final layout/copy polish.
- **89 automated browser smoke tests passed** against the optimized local fixture server, repeated after the shared mobile drawer correction (1.6 minutes). Coverage includes registered admin/guest pages, all report routes, secondary workflows, global search, guest restrictions and reload continuity.
- In a local synthetic admin workspace, the browser flow created a no-filming graphic, prepared it, confirmed readiness, entered production, submitted version 1, requested changes, submitted version 2 and approved it. Two channel plans were scheduled and then marked published independently; the derived board stage changed only when their combined state justified it. Both review records remained visible.
- The guest demo rendered all eight cards. Board, Calendar, My Work and All Creatives navigated successfully. Sources opened the original content opportunity, which showed five related creatives and the completed shoot; its create form pre-filled source context and cancelled cleanly. Phone checks use 390 × 844: all four views had no document overflow, and a drawer measured 390 px wide with 389 px internal scroll width. Intentional horizontal scrolling stays inside the board and tab strip. An empty second board page recovered through Previous. Mobile record drawers use the full viewport width and wrap header actions.
- Guest Inquiry Inbox and read-only queries for all seven active hosted staff accounts loaded successfully; the user's exact intermittent database failure remains unreproduced. Safe operation/code-only diagnostics were added. See `inbox-database-qc.md` for limits and reproduction steps.

These checks are functional coverage, not a production performance benchmark or a complete accessibility audit. No real customer records, messages, public posts or Google reviews were submitted during QC.

## Deployment and merge order

1. Resolve the sales access policy, integrate its chosen implementation and reconcile intentional read assertions while retaining the intended write restrictions. Run the final database suite, generated-type drift check, typecheck, lint, unit tests, build and route smoke checks. Do not reset a populated shared database.
2. The hosted hot-path ledger mismatch has been reconciled after checking its SQL text against the repository file; see `hot-path-performance-handoff.md`. The exact already-hosted sales grant is represented by `20260921073229_sales_rep_review_and_reports.sql`.
3. Run `supabase db push --linked --include-all --dry-run` and inspect the pending list. Before a new policy migration, the dry run lists only Creative migrations `20260921062925` and `20260921065600`. Apply the reviewed forward migrations before deploying the dependent route. Never run a production reset or full seed.
4. Push a reviewable PR, require all CI checks, merge normally and verify the Vercel deployment. Repeat hosted guest Creative, Inbox, funnel and phone checks. Record the release commit and actual hosted result here.
5. Keep the original checkout intact. Any later Claude work should start from current main or a new worktree, preserve the safe Inbox diagnostics and Creative source links, and compare overlap explicitly.

## Remaining work outside this release

- Automated notifications/tasks, platform posting/scheduling, media hosting and external file/version verification.
- Arbitrary custom calendar ranges beyond the available month/week/agenda controls; a dedicated upcoming-shoot panel beyond the current linked shoot calendar.
- Staff reproduction of the specific Inquiry Inbox database error if it recurs, with time, role and triggering action.
- Hosted `TC_GOOGLE_REVIEW_URL` configuration and a verified direct review destination. The supplied business-listing fallback must stay labelled as a fallback; customers still submit their own Google reviews and WhatsApp delivery remains manual.
- Full production-volume performance and broader accessibility checks can continue in Claude after the release baseline is recorded.
