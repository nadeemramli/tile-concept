# Inquiry inbox: live updates, remarks and source clarity

Built from the F1–F3 reporting foundation in the `codex/inbox-live-qc` worktree. This is a local delivery; no hosted migration, production data change or deployment has been performed.

## Changes

- Private workspace notifications refresh the inbox, counts and open drawer when inquiries, tasks, activity, visits or sales change. Notifications contain only a changed flag (plus Supabase's notification ID); fresh server reads enforce current permissions. Bulk statements send one notification per workspace. A failed notification cannot abort a staff action.
- The connection indicator shows live, reconnect/fallback or offline state and the last successful page-load time. Visible tabs check every 30 seconds if live delivery is unavailable, and every minute while connected to update time-based queues. Focus/reconnect catches up. Draft input, current filters and selected inquiry survive refreshes.
- Staff can add standalone remarks without fabricating a WhatsApp send, customer reply or follow-up completion. Remarks record the author and time in Activity, accept safe retries, and cannot be overwritten/deleted.
- Facebook, Instagram and explicitly evidenced Google Ads are available as origins. Historical Meta remains **Meta (unspecified)**; a website entry is not treated as Google Ads. Source corrections require evidence/reason, retain original intake and before/after history, and reject stale competing changes. Platform labels alone do not establish paid attribution.
- Existing owner/manager write rules remain in the database. Contextual remarks can be added to lost/closed inquiries without reopening them. Closed sales no longer display a first-response SLA warning in the optional table column.

Apply `supabase/migrations/20260921045553_inbox_live.sql` before the matching app release, then regenerate `src/lib/supabase/database.types.ts`. The migration uses supported Realtime functions and only adds an RLS policy to `realtime.messages`; it does not alter Supabase-owned schema objects. No source backfill is performed. Customer and opportunity original acquisition fields are not rewritten by an inquiry source correction.

## Staff QC

Use a test deployment with synthetic customers and two browser sessions: assigned salesperson and manager/teammate.

1. Open **Inquiry Inbox → All inquiries**, then create test inquiries for TikTok, Instagram and Facebook. Check each source filter and a phone/name search.
2. Open an inquiry and **Add remark**. Check wording, author and time in Activity. Confirm the message/reply milestones remain empty and no follow-up is implicitly completed.
3. Record **WhatsApp sent** only after sending; record **Customer replied** only after an actual reply. Schedule a reminder three days ahead and confirm it appears immediately in **Upcoming**. Complete it with an outcome, then check **Follow-ups completed** and All inquiries. The drawer should stay open even when the current view no longer includes it.
4. Keep that inquiry open in the other session. Add a remark, change its reminder or record a showroom visit in the first session. The second session should update without a full page reload. Confirm its selected inquiry and filters remain selected.
5. Begin typing an unsaved remark in the second session while the first session updates the inquiry. The unsaved text must remain. Turn off network access and restore it; verify the honest offline/fallback indicator and automatic catch-up.
6. Correct Meta (unspecified) to Instagram only with evidence. Confirm the original intake is retained and the correction reason appears in Activity. Try competing source corrections from two open forms; the stale form should ask staff to review the latest source.
7. A teammate may read shared inquiries but cannot add remarks or correct another owner's inquiry. A manager can. Verify the same denial through a direct API call, not only disabled controls.
8. Repeat the main journey at a 390px phone width. Follow-up controls should remain usable and no draft should disappear during live refresh.

## Local evidence and remaining checks

- 152 unit/component tests passed, including live refresh coalescing, recovery, hidden/offline behavior and unmount cleanup.
- 29 new pgTAP assertions passed against the isolated synthetic reporting database, including permissions, cross-workspace topic denial, immutable history, source concurrency and retry deduplication.
- TypeScript passed. ESLint reported no errors and only the existing TanStack Table/React Compiler warning. Supabase security advisors reported only the three existing mutable-search-path warnings in `core`.
- A real browser connected to the private channel. A new lead from a separate database session appeared without navigation within approximately six seconds, before the polling interval. Remote refresh preserved unsaved remark text. Browser remark save, Facebook source correction and a future follow-up succeeded; the 390px drawer screenshot was inspected. No console errors/warnings occurred during the walkthrough.
- The root integration run must verify a fresh migration reset and optimized build together with the opportunity/review/reporting branches. Production-scale performance and hosted Realtime configuration still need the independent QC pass. Activity currently loads the latest 100 events; older history remains in the database.

No WhatsApp messages were sent during verification. Local browser fixtures are synthetic and are removed by the final isolated database reset.
