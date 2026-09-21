# Existing-page QC before Creative release

Checked 21 September 2026 from `codex/route-qc`, based on `origin/main` commit `78eae98c88c03ad6f8020353e94e9bd14e9a52fb`. This worktree changes tests and this handoff only. Claude's checkout/branch `perf/inbox-drawer-and-shell` was not edited, reset, or merged.

## Result and limits

- Hosted app: `https://tile-concept.vercel.app`, official **Enter as guest** path, isolated Playwright session `tile-route-qc`. Checks used the shared synthetic demo workspace. No customer records were created or edited; no imports, exports, uploads, invitations, messages, reviews, or settings changes were submitted.
- All 24 registered primary/platform routes were visited. The 22 guest-accessible pages rendered; Settings and Lead Connectors correctly showed **Not available to Guest (demo)**. All 11 report routes rendered without report RPC error text. Four additional standalone workflow pages rendered.
- No database failure was reproduced in the guest Inquiry Inbox: 14 demo leads rendered with no browser exception or HTTP failure during the route checks. This does **not** clear the user's real-workspace Inbox failure; the separate Inbox repair task owns that investigation and must supply its larger-workspace/role evidence.
- The feedback preparation page shows **Google review destination needs setup** on the hosted deployment. Configure `TC_GOOGLE_REVIEW_URL` with the approved showroom destination and redeploy before expecting the customer Google handoff to work. A business-listing fallback must remain labelled as such; it is not a verified direct review link. This QC did not change environment variables.
- Intermittent Chromium `net::ERR_NETWORK_CHANGED` errors occurred during guest entry and some navigations, including feedback preparation and one mobile walk-in load. The app displayed its retry page or the browser navigation timed out. Subsequent bounded retries loaded the same routes successfully. No failing database RPC could be inferred from these transport failures. Preserve this distinction when triaging a user's screenshot.
- These are functional smoke checks, not production-scale performance measurements, full accessibility certification, complete mutation tests, or proof that every real customer record is valid. Creative functionality added after the baseline requires its own release checks.

## Hosted route coverage

Each successful row below returned HTTP 200 and the expected page heading/content. Report checks inspected the visible `This report could not be computed` failure state as well as the document response. Empty states are recorded as valid only where the demo had no matching records.

| Area | Routes | Observed outcome |
| --- | --- | --- |
| Command Centre | `/` | Dashboard and morning brief |
| Sales | `/sales/pipeline`, `/sales/projects`, `/sales/walk-ins`, `/sales/feedback`, `/sales/tasks` | Board/list/ledger pages; feedback list empty |
| Customer | `/sales/inbox`, `/sales/accounts`, `/sales/identity-review` | Inbox and contacts populated; identity review empty state |
| Marketing | `/marketing/spend`, `/marketing/content-opportunities`, `/marketing/shoot-calendar` | Spend empty state, content opportunities populated, calendar rendered |
| Merchandise | `/merchandise/catalog`, `/merchandise/pricing`, `/merchandise/stock` | Products, price lists, stock populated |
| Sources | `/sources/library`, `/sources/review` | Explicit empty states |
| Reports index | `/insights/reports` | Report links rendered |
| Platform | `/platform/integrations`, `/platform/data-health`, `/platform/audit`, `/platform/help` | Integrations, health empty state, audit records and glossary rendered |
| Restricted platform | `/platform/settings`, `/platform/connectors` | Expected guest denial; admin versions passed locally |
| Additional workflows | `/sales/record-sale`, `/sales/walk-ins/new`, `/sales/walk-ins/import`, `/merchandise/catalog/compare` | Sales ledger, initial form steps and comparison selection empty state; no submissions |

| Report route under `/insights/reports/` | Query/RPC | Hosted outcome |
| --- | --- | --- |
| `funnel` | Funnel dashboard query | Business, marketing, showroom and customer-history sections rendered |
| `pipeline` | `report_pipeline` | Populated |
| `lead-source` | `report_lead_source` | Populated |
| `quotes` | `report_quotes` | Explicit empty period |
| `walkins` | `report_walkins` | Populated |
| `cohorts` | `report_cohorts` | Populated |
| `demand` | `report_demand` | Populated |
| `price` | `report_price_health` | Populated |
| `stock` | `report_stock_freshness` | Populated |
| `data-quality` | `report_data_quality` | Explicit empty period |
| `content` | `report_content_pipeline` | Populated |

## Detail views and mobile checks

- Walk-ins: selected a demo visit row; the drawer showed visit facts, original-inquiry linkage, purchases, customer timeline and the feedback preparation link.
- Feedback: followed the visit's preparation link; the question/photo/message form rendered after the transport retry. The missing Google destination warning is an outstanding deployment configuration item. No draft was saved.
- Projects: opened an existing project and its linked opportunity. The opportunity drawer showed edit/archive controls, photos and remarks, facts, stage history, tasks, purchases and timeline. Controls were inspected without submitting changes.
- Contacts and accounts: the linked customer detail rendered. Opened a company with zero opportunities; **New opportunity** opened a form with the company and primary contact selected. Cancelled without submitting.
- Merchandise details: opened a product's specifications and pricing tab (four prices with their currency, basis and program), then a price-list detail with 44 rows. Both details rendered without an error state.
- Mobile at **390 × 844**: Command Centre, Inbox, Walk-ins, Projects, Catalog, funnel dashboard, sales ledger, new walk-in, import, comparison empty state, feedback preparation and contact detail had document width 390 px. Opportunity drawer width was 390 px with internal scroll width 389 px; text and actions wrapped within the screen.
- Reviewed screenshots of the opportunity drawer and funnel dashboard. The mobile navigation opened with the primary links visible. Local ignored artifacts are under `output/playwright/` (`opportunity-mobile.png`, `funnel-mobile.png`); they contain synthetic demo data only and are not committed.
- Product and price-list details also fit the 390 px viewport. The company opportunity form measured 358 px wide with no internal horizontal overflow; selecting Catalog from mobile navigation closed the menu and loaded the page.

Token-dependent invitation/password setup and private customer review routes were not exercised using real links. Source/review detail records were unavailable in the empty demo queues. No production mobile-camera upload or Google/WhatsApp submission was attempted.

## Automated checks

The old admin and guest tests each looped through many routes within one 60-second test. Those loops now create **one independent test per route**, keeping the existing timeout unchanged. The route catalogues are imported from the application nav/report registries, with four explicit secondary routes. New registered pages automatically enter this smoke coverage.

`expectHealthyRoute` checks document status, absence of unexpected redirects, page content, explicit error boundaries, report RPC error text, and uncaught browser errors. A report returning HTTP 200 with an error heading/message no longer counts as healthy. Guest Lead Connectors denial is also covered. The former misleading guest "creates" test was renamed to reflect its actual read-only row continuity check.

Against the already-running optimized fixture server at `http://localhost:4317`:

- 79 tests passed in the expanded main/admin/guest/report matrix (1.5 minutes, two workers).
- Eight additional secondary-page tests passed (8.9 seconds, two workers).
- Total **87 passing tests across these runs**, including admin Settings/Connectors, guest isolation, global search, role denial, all registered pages and reports. No database reset or server restart was performed.
- Focused ESLint passed for the modified test files.

Run the final integrated suite from the selected worktree using its local fixture server:

```sh
E2E_BASE_URL=http://localhost:4317 pnpm exec playwright test tests/e2e/smoke.spec.ts tests/e2e/guest.spec.ts --workers=2
```

Use fixture admin credentials only against a local seeded stack. For a hosted read-only check, use the official guest button and the guest tests or CLI; do not try fixture admin credentials against production. Keep mutation testing in an isolated local database.

## Integration update

Creative integration has now merged `origin/main` through `faac3aa`, including
Claude's performance PR #11 and sidebar/handoff PR #12. The original dirty
checkout remains untouched. The integrated optimized app passed **89** route
smoke tests, including the newly registered Creative page, on port 4328.
The historical results above describe the earlier baseline; current Creative
flow coverage and the unresolved hosted sales-permission interaction are in
`creative-production-handoff.md`.

## Claude merge and release checklist

1. Preserve the original `perf/inbox-drawer-and-shell` checkout and any uncommitted work. Its committed performance changes are already on main and integrated here. Compare any further dirty changes explicitly in a separate worktree; do not reset or overwrite them.
2. Retain the new Inbox lifecycle/attribution fields, follow-up visibility, receipts and walk-in links when merging drawer/query optimizations. Validate both guest and the reported affected role/record volume; the 14-row demo alone is insufficient.
3. Apply the integrated forward-only migrations in a disposable fixture database, regenerate database types, and run required database permission/scope tests. Never reset the original database containing private corpus data.
4. Run the app's typecheck, lint, unit checks and the expanded smoke suite. Test an optimized build as well as development when evaluating route/interaction timing; per-route test structure addresses cumulative cold-compile test timeouts without changing product performance claims.
5. Exercise the new Creative workflow locally with synthetic fixtures, including denied roles, media permissions and empty/error states, before publishing. Verify the Creative routes appear in the automatically expanded nav smoke matrix once registered.
6. Confirm Google review destination configuration, explicit listing-fallback wording, and the actual production app origin. Customer consent, manual WhatsApp sent confirmation and Google customer submission remain separate actions.
7. After the authorized deployment, repeat hosted guest route checks and key mobile drawers. Have staff QC the affected real Inbox account without changing or messaging real customers during diagnosis. Record exact visible errors and correlate them to server logs/RPCs before declaring the reported database problem fixed.
