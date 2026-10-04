# Marketing-cost batch import — 4 October 2026

Imports a TikTok Ads trend report into the marketing-cost ledger as one batch, from the Marketing spend page or through MCP tools. Built on the existing ledger command, so the popup's rules (permission, one daily total or campaign detail per platform day, unique daily key, coverage invalidation, audit) apply to every imported line. **Not deployed and nothing imported into hosted data.**

## Rules

| Rule | Where it is enforced |
| --- | --- |
| Campaign Spend is summed per date; dates summing to zero (or only `-`/blank) are excluded and listed on the batch. | Parser (`tiktok-trend.ts`), rechecked by `marketing.spend_batch_issues` |
| Each date becomes TikTok / Platform daily total / Platform advertising, vendor `TikTok`, key `daily-total`. | `api.import_marketing_spend_batch` → `api.record_marketing_spend('save', …)` |
| MYR amounts are kept exactly (integer sen in the parser, `numeric(14,2)` in SQL). A non-MYR or mixed-currency report is refused; nothing is converted. | Parser + `spend_batch_issues` |
| Currency is never assumed. The report must state it (Currency column, `(MYR)` header suffix or `Currency: MYR` line), or the operator explicitly declares MYR; the batch records `report_stated` vs `operator_declared`. | Parser, `spend_import_batches.currency_basis` |
| **Unreported tax is never zero.** `spend_entries.tax` is nullable; `tax_status` is a generated column (`unreported` when tax is null). The ledger command accepts a null tax only with an explicit `tax_status: "unreported"`. Tax-inclusive totals exclude unknown tax and count it; the funnel's MER at the tax-inclusive basis and cost-per-lead stay N/A until a reviewer states the tax. Credits cannot be recorded against an unreported tax. | Migration `20261004000002`, `marketing_spend_period`, `funnel_dashboard` |
| The same file (SHA-256) cannot be imported twice while its batch is active. A retry with the same request id returns the same batch. | Partial unique index + `request_id` |
| A batch is refused if any of its dates already has a recorded TikTok daily total or campaign entry; the preview lists each one and whether its amount matches the report. | `marketing.spend_batch_conflicts`, then the ledger command's own rule |
| All or nothing: any refusal imports no line. Every validation problem is named in one 23514. | Single function call / transaction |
| Expected figures are restated at import (the UI uses the previewed figures; MCP requires `expected_entry_count` and `expected_total`). | `importSpendBatch` + `totals` check in SQL |
| Provenance: batch row (file name, SHA-256, parser version, report range, row/campaign counts, excluded dates, currency basis); one line per date (campaign breakdown, source row numbers, ledger entry); each entry's reference `TikTok trend <sha12> · <date>`; audit events `marketing.spend.import` and one `marketing.spend.save` per entry naming the batch. | `spend_import_batches`, `spend_import_lines`, `audit.audit_events` |
| Correction history: imported entries are corrected with the popup (reviewer + reason, versioned, audited). The batch line keeps what the source said; verification reports each date as matches / edited / corrected / voided. A wrong import is undone with **Void batch** (reviewer + reason), which voids each entry through the ledger command and releases the file for re-import. | `api.verify_marketing_spend_batch`, `api.void_marketing_spend_batch` |

Permissions: preview and verify need `marketing.spend.read`; import needs `marketing.spend.write`; void needs `marketing.spend.review`. The database checks all of these; the UI and MCP only report its answer.

## Using it

**App** — Marketing spend → *Import TikTok report* → choose the file → *Preview*. Enter the expected figures (for example 46 and 3,269.40) to have the preview reconcile against them. *Import N dates · RM X* appears only when nothing blocks. The result is read back and verified. *Recent imports* has *Verify* and, for reviewers, *Void batch*. The popup has a "source does not report tax" option, and a reviewer unticks it to state the tax from the invoice.

**MCP (stdio)** — the tools act as a named member, using a one-time session minted like `scripts/import`:

```sh
claude mcp add tile-marketing-cost -e TC_MCP_MEMBER_EMAIL=<member email> -- pnpm --silent mcp:marketing-cost
```

`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are read from the environment or `.env.local`; a local URL is refused unless `--local` is passed. Tools: `marketing_cost_preview_tiktok_report`, `marketing_cost_import_tiktok_report`, `marketing_cost_verify_import` (by batch id, or by file: finds its batch by fingerprint and compares every date), `marketing_cost_list_imports`. Void stays in the app, where a reviewer gives a reason.

## Verification evidence (local stack, synthetic data only)

- `supabase/tests/023_marketing_spend_batch_import.sql`: 87 assertions covering permissions (analyst, sales rep, coordinator, anonymous), reconciliation mismatches, tax/currency/mapping refusals, zero/fractional/duplicate/out-of-range/impossible dates, failed batches leaving no rows, duplicate file, same-request retry, overlap with daily totals and with manual campaign detail, provenance, audit, coverage invalidation, funnel MER N/A with unreported tax, correction history, batch void and re-import, and workspace isolation. All 24 DB suites pass (870 assertions), including the unchanged `014_marketing_funnels.sql`.
- Unit tests: parser (a synthetic 50-day, two-campaign report with 4 zero-spend days reconciles to exactly **46 dates / MYR 3,269.40**; Excel serial dates; currency detection; total-row check; bad rows), service (preview, blockers, duplicate retry, refusals, verification compare) and MCP tools over an in-memory transport.
- `pnpm mcp:marketing-cost:smoke` (local only) spawns the real stdio server: preview, import, verify-by-file, same-request retry, duplicate and overlap refusal, sales-rep refusal, then voids its batch.
- Browser check of the import dialog, duplicate/overlap blockers, the ledger table, stating tax through the popup, verification and the funnel's unreported-tax hints.
- `supabase db lint` reports no finding in the new or changed functions.

**The supplied TikTok report was not available in this session**, so the parser is validated against synthetic files in the described shape (Date / Campaign name / Spend, currency stated). It reads headers by name, not position. An unexpected layout is refused with a message naming the missing column, never guessed.

## Before importing live records

1. Apply `supabase/migrations/20261004000002_marketing_spend_batch_import.sql` to hosted (dry run first) **before** deploying the code: the spend page reads the new view columns and functions. Never use the local reset command on hosted data.
2. Deploy the app.
3. Preview the real report with the expected figures 46 / 3,269.40, in the app or with the MCP preview tool. Check the currency basis, the excluded zero-spend dates and that there are no blockers.
4. Import, then verify. Spending coverage for those TikTok days is invalidated by design, so re-confirm it after checking the statements.
5. When the TikTok invoice arrives, a reviewer states the tax on each entry. MER becomes available once every cost in the period has a stated tax and coverage is complete.
