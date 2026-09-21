# Sales, receipt evidence and collections (F3)

Implemented locally on `codex/reporting-funnel`, following F1 inquiry operations and F2 showroom linkage. No hosted migration, push or deployment has been performed.

## Accepted definitions

- WhatsApp progress remains manual.
- MER will use recorded sales, with collections shown separately.
- Nadeem confirmed on 2026-09-21: **revenue excludes separately stated sales tax**.
- New sales use MYR. Foreign-currency historical records require a reviewed conversion basis; this version refuses to silently treat them as MYR.

## Staff journey

From an inquiry, choose **Sales, receipts & payments**. The same workspace is available from a saved showroom visit and the Walk-ins toolbar. Existing customer documents are listed with server pagination so a balance payment can reuse its original sale.

1. Confirm the customer identity, enter the document reference/type, sale date in Malaysia time, sale value before tax, discount and explicit tax (zero when none).
2. Save a recoverable draft. It contributes no revenue and does not close the inquiry.
3. Upload private PDF/JPG/PNG evidence (maximum 5 MB). An upload intent without a stored object is insufficient.
4. Confirm the documented sale. A linked inquiry appears in **Closed sales**, its original acquisition source stays intact, and open inquiry reminders are cancelled with a recorded outcome. Opportunity creation alone still does not mean a sale.
5. Record deposits and later collections on that same purchase. Credit terms are not cash. Manager-only credits/voids change revenue; cash refunds change collections separately. Both credits/voids and cash refunds require supporting evidence and a reason.

Voiding or fully crediting the last positive sale removes the current closed-sale milestone and exposes the next-action gap again. Earlier confirmation and adjustment events remain available for dated reporting. Managers can correct the credited inquiry with a reason; mismatched customers/accounts/visits are refused.

## Data and security contract

Migration: `20260921041005_sales_evidence_and_collections.sql`.

- `sales.purchases` is still the canonical record. Added financial classification, explicit inquiry link, net/discount/tax fields, confirmation time and historical snapshot. Draft `amount` is zero to avoid contaminating existing monetary sums; confirmed `amount` is the document total including tax. **Use `sale_events`, not `purchases.amount`, for new net-revenue reporting.**
- `sale_events` contains dated confirmation, credit and void deltas. Net revenue in a period is the signed sum of `net_delta` by `occurred_at`. A later credit can make that period negative. Void reverses the remaining value on the void date; it does not erase the original sale event.
- `purchase_payments` contains separately reviewed collections and refunds. Collections are signed payment amounts by `paid_at`; credit terms and unreviewed payments are excluded. `api.sale_balances` provides database aggregates.
- `sale_command` validates and locks the purchase, enforces roles/workspace/identity, applies version checks, writes history and audit atomically, and deduplicates request UUID plus actor/payload. Document-reference checks also span the compatibility entry point. Browser retries keep a stable UUID while the form is mounted; after a reload the existing document list/reference guard provides recovery.
- Direct authenticated purchase/payment writes are revoked. Existing capture/import RPCs remain available but create **unclassified** records; they cannot imply net sales. The old amount correction uses the transaction RPC.
- `sales-receipts` is private. Paths are generated against a valid purchase and upload intent. Authenticated uploads require the initiating staff member and purchase permission; authorized sales staff can read. No authenticated storage update/delete policy is supplied, so evidence cannot be replaced behind a confirmed sale. Links expire after five minutes.
- All new RPCs set an empty search path and revoke anonymous/public execution. New tables use RLS and security-invoker API views. Workspace cascades preserve the existing demo-reset behavior.

## Historical review

Existing amounts/payments stay unclassified. A manager can verify a full sale, explicitly enter its money/tax basis, upload evidence and confirm it. The original purchase is retained in `legacy_snapshot`; historical payments still need individual review.

A collection-only receipt can be linked once to an existing confirmed sale for the same customer. Its unreviewed payment rows **move rather than copy**, and must be reviewed on the parent sale before entering collections. The historical receipt total is never auto-created as another payment. Already-reviewed collections cannot be silently moved. An unlinked collection-only classification can be reviewed back into a full-sale draft with a manager reason.

The home scorecard now derives collections from reviewed payment events and displays its historical coverage gap. Visit collection cells show reviewed collections on linked sales, including later payments, rather than claiming the full invoice was collected at the visit. New drafts are excluded from feedback selection and existing purchase reports. Older reports still describe their original document-level measures; the complete period/cohort net-sales reports belong to F5.

## Validation and independent review

Local validation uses only synthetic data in the isolated `tile-concept-reporting` Supabase stack (API 61321, database 61322). **Do not reset the original checkout’s database**, which contains a separate private corpus.

```sh
pnpm build
pnpm test
pnpm lint
pnpm exec supabase db reset --local --workdir .local/runtime --yes
pnpm exec supabase test db --workdir .local/runtime
pnpm exec supabase db lint --local --workdir .local/runtime --schema api,sales --level warning --fail-on error
pnpm exec supabase db advisors --local --workdir .local/runtime --type all --level warn --fail-on error
```

The F3 database suite exercises evidence gating, tax/discount calculations, deposits, refunds/credits/voids, duplicate documents and retries, stale versions, workspace/role boundaries, transaction rollback when history fails, inquiry progression and historical collection linkage. Browser verification includes an actual private PDF upload, confirmation, partial collection, and the original inquiry’s Closed sales view at desktop/mobile sizes. Synthetic example: document total 954, net revenue 900, tax 54, deposit 200, balance 754. Browser console reported no errors or warnings. Screenshots remain local under `output/playwright/`.

Final local results: optimized production build and TypeScript passed; 148 unit tests passed; 304 pgTAP assertions across 10 suites passed (71 new F3 assertions); the complete forward migration applied during a clean reset of the isolated reporting database; ESLint had zero errors. The final reset removed the temporary browser fixtures.

Existing unrelated check findings: TanStack/React Compiler lint warning; database lint error in `api.shoot_conflicts` (`abs(interval)`) and older ingestion warnings. Security advisors report mutable search paths on the existing `core.set_updated_at`, `core.mask_value` and `core.storage_workspace_of`; performance advisors report existing overlapping policies. No new F3 function lint findings were observed.

Claude Code should independently check the final commit, with emphasis on simultaneous saves/collections, interrupted uploads and recovery after reload, stale browser tabs, sale/visit relinking, historical document samples, receipt access after role changes, and large-history query plans. Automated browser journeys and SQL assertions here do not constitute production load testing. Failed upload intents are retained for recovery; long-term orphan-storage cleanup is an operational follow-up.

Next development packages: F4 marketing expense ledger, then F5 period/cohort funnel reporting and reconciled drill-downs. Production rollout and independent performance verification remain outstanding.
