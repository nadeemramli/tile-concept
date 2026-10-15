# Configurable lead routing and Telegram progress

TILE-25 adds app-managed assignment pools and Telegram progress controls to the existing Google Sheet → n8n → Inquiry Inbox flow. The app database owns assignment, permissions, progress and reporting.

## Initial configuration

Administrators use **Settings → Lead routing** (`/platform/settings?tab=routing`). Defaults follow the client's latest instruction:

| Form customer type | Pool | Distribution |
| --- | --- | --- |
| Homeowner / end user / Pemilik rumah | Homeowners / end users | Naufal, fixed |
| Interior designer / Pereka dalaman | Designers / contractors | Beyla → Alia → Jerry → repeat |
| Contractor / Kontraktor | Designers / contractors | Same shared trade rotation |
| Business owner or an unknown answer | Review | Unassigned until explicitly mapped |

The names are pending slots, not invented app accounts. Select real active sales accounts when the owner supplies the staff details. Unlinked and inactive slots are skipped; an unavailable pool leaves a visible reason on the inquiry and its Telegram card. Configuration applies to new inquiries and never reassigns historical records. Existing unassigned inquiries can still be assigned through the app's existing audited controls.

Pools expose their name, fixed/round-robin mode, active state, member order and member availability. Rules expose the customer type, exact accepted form-answer aliases and destination pool. Aliases ignore case and surrounding whitespace. The database checks membership, unique slots/aliases and configuration versions; stale edits cannot overwrite newer settings.

Rotation is transactional and persistent. Duplicate source events do not consume another turn. Legacy intake location matching remains; legacy first-match assignees are superseded for newly accepted inquiries. Authenticated direct intake requires `source.import` and workspace access; signed server connectors retain their service-role path.

## Salesperson setup and daily use

Each salesperson opens **Inquiry Inbox → Connect my Telegram** (`/sales/inbox/telegram`), creates a private ten-minute link, opens the bot and presses Start. The database stores only the link hash and binds the actual numeric Telegram user to the signed-in app member. Codes expire and work once. There is no display-name matching or manual Telegram-ID field.

New group cards show the current assignee, type, progress and follow-up, with **WhatsApp sent**, **Customer replied**, **No response**, **Follow up tomorrow · 9am**, **Open Inquiry**, and contact navigation. Opening WhatsApp never records a sent message. These are staff-reported actions; this release does not ingest WhatsApp delivery or reply receipts. Tomorrow means the next calendar day at 09:00 in Asia/Kuala_Lumpur.

Only the linked assignee or a member with `sales.assign` and `sales.write` may change progress. The app and bot share the private actor-aware inquiry command; no user JWT is fabricated. Activities and business audit events identify the actual app actor and Telegram as the source. Closed inquiries retain navigation without progress controls.

## Delivery and recovery

The database queues one card per newly accepted intake. n8n leases a small batch and confirms each message individually. A lease expires after two minutes if delivery fails. The sender uses opaque rotating button tokens, bound to the configured group, lead, current assignment and saved message ID. Duplicate provider updates replay the committed result; stale or reassigned cards cannot act again.

The worker also reconciles app-side follow-up edits and removals. Its acknowledged follow-up is the content actually leased for delivery, so a concurrent app change remains discoverable. It does not take task row locks or alter ownership during reconciliation.

Telegram's API does not provide a send-message idempotency key. An ambiguous network timeout can produce a duplicate visible card, but only the registered message is actionable and inquiry state is not duplicated. An already-applied message edit is acknowledged safely when Telegram returns “message is not modified.”

Provider updates receive a success response only after app persistence succeeds. A failed app request returns 503 to request a provider retry. Telegram's secret header is checked at the n8n webhook; the internal relay signs the exact body for `/api/intake/telegram`. SSRF protection stays enabled with the existing `intake-relay` hostname allowance. Execution payload retention is disabled for this workflow.

## Deployment boundaries

The forward migration is `20261015200520_configurable_lead_routing_telegram.sql`. The routing settings, assignments, Telegram bindings/codes/cards and processed-update records have RLS. Bot-only RPCs are not executable by browser roles.

`ops/n8n/tile-concept-progress.workflow.json` is a credential-free template for the existing `tc-meta-sheet-telegram` workflow. Before import, preserve the live workflow's sheet checkpoint/static data and retain a private backup. Do not replace a live checkpoint with a template baseline or replay historical rows. Existing bot and Google credentials remain in n8n. The new `httpHeaderAuth` credential is `tc-telegram-webhook-secret`; its value must match Telegram's `secret_token` and must never enter Git. The bot webhook is `/webhook/tile-concept-telegram-progress`.

The relay extension accepts `/telegram` alongside `/intake`, forwards only to its fixed app endpoint, and continues to read the existing HMAC secret from its private mount. Configure the approved group in `api.telegram_sales_channels` through a trusted administrative setup path. No historical cards are queued during schema installation.

Deploy the migration and app before activating the extended workflow. Pause the old polling workflow for the cutover, preserve its checkpoint, build/restart only the relay and n8n services that changed, publish the replacement workflow, verify unsigned webhook rejection, and register the bot webhook. Check runtime readiness and the active version. Production validation must not create synthetic customer records or send test leads into the real sales group.

Rollback restores the prior app/workflow artifacts while retaining captured database history. Use forward SQL repairs; do not drop the new data tables. An old app without the bridge cannot process progress callbacks, so coordinate webhook/workflow rollback and expose the app's existing controls during repair.

## Verification

The agent's evidence includes clean synthetic migrations; SQL checks for rotation, retry safety, role denial, private linking, stale cards, Malaysia-time follow-ups and app-task reconciliation; existing Inquiry/intake regressions; card/schema unit checks; relay request-signing/failure checks; browser settings persistence; and a real HTTP/database journey with 12 concurrent leads distributed 4/4/4.

The installed n8n runtime is tested separately with an isolated temporary SQLite database, fixture credentials and mock vendor endpoints. The test covers the actual header-authenticated webhook, persistence-failure 503, callback answer, private link confirmation, per-message acknowledgement, keyboard serialization, escaped text, closed-card navigation and already-applied edit recovery. It sends no real Telegram message and removes its temporary database, processes and runner.

Run the local HTTP journey with `node --env-file=.env.local --import tsx tests/integration/lead-routing.mts` after saving synthetic pool bindings through the local settings UI. The script refuses non-local app/database hosts. For the native transport check, explicitly set `TC_N8N_TEST_HOST` and `TC_N8N_TEST_SSH_KEY`, then run `python ops/n8n/test-native-contract.py` from an authorized operator host. Build-specific delivery evidence belongs in Direct, separate from pending human acceptance.
