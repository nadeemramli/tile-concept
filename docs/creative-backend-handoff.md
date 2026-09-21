# Creative production backend handoff

Backend branch: `codex/creative-backend`, based on `78eae98`. The UI/navigation is integrated separately in `codex/creative-production`.

Migration: `supabase/migrations/20260921062925_creative_production.sql`.

Additive follow-up: `supabase/migrations/20260921065600_creative_demo_and_current_version.sql`.

## Contracts and behavior

`src/features/creative/types.ts` describes cards, details, calendar posts, filters and options. `schema.ts` supplies the validated create form and discriminated command inputs. Server queries are `getCreativeList`, `getCreativeDetail`, `getCreativeCalendar` and `getCreativeOptions`. Server Actions include create/mutate, lazy detail, searched source options and related creatives.

One creative is one deliverable. Production stores Briefing, Preparing, In production, Review and Approved. Scheduled/Published derive from active publication plans; zero/all-cancelled plans stay Approved. Published also requires at least one published record for the current approved version. A newly approved cut with only older published history stays Approved and is discoverable as Unscheduled. Each publication retains its own version, account label, use, target/scheduled/actual dates and live URL. A date alone is not scheduling evidence. Published history survives reopening production.

Briefs, sources and links freeze during review/approval. Reopen before changing them. Submitted export records, reviews and events are append-only; the app cannot prove external URL bytes immutable. Staff must identify a specific export and confirm access. New creative links are URL-only; the backend never fetches them or alters file sharing. Unsafe schemes, credentials and recognizable expiring token URLs are refused.

Source links preserve existing content opportunity / shoot / output identities, including multiple customers or shoots. Output links require an existing approved output. New footage needs an explicit shot plan, completed/partly completed shoot and accessible raw material; completing a shoot alone never marks it ready. Existing footage and no-filming work need no invented booking or customer. Raw link accessibility and coverage are human confirmations, not a Drive integration.

Customer media permission is checked across every linked customer before approval, scheduling and publication, including expiry on the planned use date and the current date, revocation and intended use. Free-text restrictions require the responsible approver/publisher's explicit acknowledgement. These checks do not automatically interpret restrictions. A source permission change flags scheduled/published records for external action; a changed linked shoot invalidates readiness and flags affected releases. The app never claims to cancel an external scheduler or remove a public post.

`marketing.read/write` govern ordinary access and commands. `creative.approve/publish` are granted to administrator and marketing coordinator; `creative.self_approve` to administrator. The guest role explicitly receives all three, confined by the existing demo-workspace membership trigger. The designated reviewer must perform review; there is no implicit admin override. Owners or submitters need the explicit self-approval grant to approve their own output.

Database commands enforce active workspace/membership, immutable versions, revision checks, request-ID idempotency and transactional event history. Direct authenticated table/view mutation is denied. The existing privileged demo workspace reset may cascade creative records when the whole demo workspace is removed; ordinary version/review deletion remains prohibited.

List queries page on the server. Stage counts preserve all filters except the chosen stage; `total` includes the chosen stage. My Work means owner OR reviewer. Related opportunity/shoot filters use source relationships. Calendar uses `[from,to)` Kuala Lumpur dates, at most 366 days, with separate channel-post and distinct-creative totals. Undated work remains available via `unscheduled`. Source option search returns a visible limit (30) and matching totals. Detail lazily loads history; its activity list currently returns the latest 100 events.

The migration also fixes an inherited `api.shoot_conflicts` failure: PostgreSQL has no `abs(interval)`. Its travel warning now takes the absolute value of elapsed numeric seconds, preserving existing conflict rules.

## Local runtime and verification

Dedicated runtime: `.local/runtime`, project `tile-concept-creative-backend`, API `63321`, DB `63322`. Its config/migration links are local ignored files. No other worktree's database was reset. No hosted changes, production data, external messages or posting were used.

- Clean replay of the base migration package plus synthetic seeds succeeded. The final narrow shoot-conflict function replacement and the additive demo/current-version migration were applied and verified afterward without another runtime reset, because UI integration had started sharing this isolated stack.
- `supabase/tests/016_creative_production.sql`: **87 passing assertions**, transaction/rollback. Covers full lifecycle, change requests, exact version approval, publish-now, partial/full/all-cancelled publication, retries, stale writes, role gates, source use/expiry/revocation, footage readiness/reschedules, immutability, demo reset, server pagination and workspace isolation.
- `supabase/tests/017_creative_demo.sql`: **21 passing assertions**, transaction/rollback. Covers demo-only restriction, idempotent fixtures, all derived stages, covered customer use, guest ownership, controlled reset consistency, complete cross-domain evidence cascades and protection of still-linked live sources.
- Existing `002_phases.sql`: **14 passing assertions**, including marketing regression coverage.
- Full unit suite: **180 passed**, including 11 creative input tests.
- TypeScript passed. Lint: zero errors; existing TanStack React Compiler warning.
- SQL lint: no errors or warnings in creative functions or the corrected shoot-conflict function. Existing unrelated corpus/review warnings remain.
- Local database advisors: no errors and no new creative warnings at warning/error level; inherited function-search-path warnings remain outside this change.
- Synthetic 605-record board query (`page_size=8`) measured **31.615 ms execution** with local `EXPLAIN ANALYZE`. This is one database observation, not a production benchmark or browser latency claim. Search beyond record 500, matching counts and page 7 were asserted.

UI/browser checks and final combined build belong to the integration branch. The additive follow-up supplies eight explicitly labeled synthetic demo cards through `core.build_demo_dataset`, covering all seven stages plus blocked preparation. It seeds only the isolated demo workspace, skips until a demo guest exists, uses deterministic IDs, preserves repeated-build edits and runs through the existing weekly reset. Example links use `example.invalid` deliberately: they demonstrate typed metadata and never claim an actual external file, scheduler or published post exists. Fixture source rights and review/version relationships are coherent; no demo data is written to ordinary business workspaces. Evidence foreign keys are checked at transaction end so whole-workspace cascades finish safely while deletion of a still-referenced live source remains invalid.

## QC sequence

1. Create a no-filming graphic with no customer. Add an owner, eligible reviewer, format/channels, objective/audience/message and production/review deadlines. Move to Preparing; confirm readiness; move to In production.
2. Submit an explicitly numbered export with review/final URLs. As the designated reviewer, request changes; confirm the prior version/review remains. Submit version 2 and approve it. As a normal coordinator who owns/submitted the work, confirm self-approval is refused.
3. Plan Instagram and TikTok separately. Schedule one with actual scheduling evidence: board stays Approved. Schedule both: Scheduled. Record one live post: remaining work stays Scheduled. Record both: Published. Confirm all-cancelled/zero plans do not show Published.
4. Reopen an approved creative with scheduled posts. Confirm a publisher must acknowledge external cancellation. Existing published history remains; pending plans lose old version linkage and need the new approved version.
5. Link two accepted customer content opportunities or shoots. Confirm a revoked/expired/mismatched-use permission on either source blocks approval/release. An organic-use grant must not permit a paid-ad plan. Observe external-action flags after permission changes.
6. Create from a completed shoot. Without a raw link/usable output, readiness fails. Add a confirmed accessible raw source and coverage/shot plan. Reschedule the linked shoot and confirm readiness/risk changes without silently changing publication dates.
7. Open a record in two sessions and save different changes. The stale revision must fail visibly. Retry the same request ID and payload after an uncertain response; no duplicate item, version, review, plan or event should appear.
8. Filter/search/page beyond 500 synthetic records. Match Board stage totals to All Creatives. Verify distinct creative versus publication counts across month boundaries, Kuala Lumpur midnight and undated work.

Remaining boundaries: free-text customer restrictions need human interpretation; external file revision/checksum verification, automated posting, notices/task generation and general studio booking model changes are outside this backend package. Approved project-progress media remains in its existing storage; this package links existing content opportunities, shoots and shoot outputs rather than copying media.
