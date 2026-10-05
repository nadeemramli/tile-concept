# Marketing-cost batch import — 4 October 2026

Imports a TikTok Ads trend report into the marketing-cost ledger as one batch, from the Marketing spend page (*Import TikTok report*, which needs no MCP connection) or through MCP tools. Built on the existing ledger command, so the popup's rules (permission, one daily total or campaign detail per platform day, unique daily key, coverage invalidation, audit) apply to every imported line. **Not deployed and nothing imported into hosted data.**

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

**MCP (stdio)**: see [MCP server: authentication and connection](#mcp-server-authentication-and-connection) below. Tools: `marketing_cost_preview_tiktok_report`, `marketing_cost_import_tiktok_report`, `marketing_cost_verify_import` (by batch id, or by file, which finds the file's batch by fingerprint and compares every date) and `marketing_cost_list_imports`. Voiding stays in the app, where a reviewer gives a reason.

## Checking the real report offline

```sh
pnpm marketing-cost:check "<TikTok report>.xlsx" --expect-dates=46 --expect-total=3269.40
```

This runs the same parser the app and MCP use, reading the file only (no network, no database, nothing written). It prints:

- the sheet, the header row and the columns it mapped;
- currency and whether it was stated or declared;
- dates with spend and the MYR total;
- the excluded zero-spend dates;
- every date that sums more than one campaign (17 August should show two), with its rows.

It exits 1 on any error or mismatch. The real export is read from sheet `Trend` (preferred when present) with headers `By Day` (date), `Campaign ID`, `Campaign name`, `Cost per conversion` and `Conversions` (both ignored), `Spend` and `Currency`. Campaigns are told apart by ID and name together, and a warning is printed if Excel stored the 19-digit IDs as rounded numbers.

## MCP server: authentication and connection

### How a member is authenticated

- **The member signs in once, as themselves.** In a terminal at the repository: `pnpm mcp:marketing-cost:login`. They give their email, then either their own password or the one-time sign-in link that Supabase emails to their own inbox. They paste the link instead of opening it: it works once.
- **The session is a normal Supabase session.** It is stored in `~/.config/tile-concept/mcp-session.json` (on Windows `%APPDATA%\tile-concept\mcp-session.json`; override with `TC_MCP_SESSION_FILE`) and readable only by its owner: mode 600 on macOS/Linux, an owner-only ACL on Windows (see below). The server refuses a file anyone else can read. Refresh-token rotation is written back to the same file.
- **The server holds no privileged key.** `pnpm mcp:marketing-cost` needs only `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and it never reads `SUPABASE_SECRET_KEY`. At start it asks Supabase Auth to validate the session (`getUser`), then requires an active membership (`api.my_membership`). Otherwise it exits before speaking MCP.
- **`TC_MCP_MEMBER_EMAIL` is a guard, not a credential.** If set, the server refuses to start unless the signed-in member has that email. Setting an email alone, with no session, cannot select or impersonate anyone.
- **Every tool call is the member's.** Each call is a PostgREST request carrying the member's JWT, so `auth.uid()`, `core.current_workspace_id()`, RLS and `core.has_permission(...)` decide exactly as in the app:
  - preview and verify need `marketing.spend.read`;
  - import needs `marketing.spend.write`;
  - another workspace's batches are invisible ("Import batch not found").
  - No tool takes a workspace or user id as input.
- **Sign out to revoke the session.** `pnpm mcp:marketing-cost:login --logout` revokes the session with Supabase Auth and deletes the file; copies of the file stop working too. `--status` shows who is signed in.
- **Use one session file per MCP client.** Two clients sharing one file race on refresh-token rotation.

> Before this change, the server minted a session for whatever `TC_MCP_MEMBER_EMAIL` named, using the service-role key. That was impersonation by configuration, and it has been removed. `scripts/import/*` still use the service-role pattern on purpose for operator-run spreadsheet imports. They are not MCP servers.

### Claude Code

```sh
cd /path/to/tile-concept
pnpm install
SUPABASE_URL=https://ewyiiematuuojlhpioqh.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> pnpm mcp:marketing-cost:login

claude mcp add --scope user --transport stdio \
  --env SUPABASE_URL=https://ewyiiematuuojlhpioqh.supabase.co \
  --env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> \
  --env TC_MCP_MEMBER_EMAIL=<your email> \
  tile-marketing-cost -- pnpm --dir /path/to/tile-concept --silent mcp:marketing-cost
```

Options go before the name and `--`. Keep `--silent` so pnpm prints nothing on the protocol channel. Check with `claude mcp list`, or `/mcp` inside Claude Code. The same entry in a project `.mcp.json` would be `{"mcpServers": {"tile-marketing-cost": {"command": "pnpm", "args": ["--dir", "/path/to/tile-concept", "--silent", "mcp:marketing-cost"], "env": {...}}}}`. The publishable key is not a secret, but keep machine-specific paths and emails out of the committed file.

### Codex

Sign in the same way, then add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.tile-marketing-cost]
command = "pnpm"
args = ["--dir", "/path/to/tile-concept", "--silent", "mcp:marketing-cost"]
env = { SUPABASE_URL = "https://ewyiiematuuojlhpioqh.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<publishable key>", TC_MCP_MEMBER_EMAIL = "<your email>" }
startup_timeout_sec = 30
```

Or use the CLI: `codex mcp add tile-marketing-cost --env SUPABASE_URL=… --env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… --env TC_MCP_MEMBER_EMAIL=… -- pnpm --dir /path/to/tile-concept --silent mcp:marketing-cost`. If Codex and Claude Code both run the server, give each its own `TC_MCP_SESSION_FILE` and sign in once per file (`TC_MCP_SESSION_FILE=… pnpm mcp:marketing-cost:login`).

### Windows

The commands above are for macOS/Linux shells. On native Windows (PowerShell), with Node 24 and pnpm installed:

```powershell
cd C:\path\to\tile-concept
pnpm install
$env:SUPABASE_URL = "https://ewyiiematuuojlhpioqh.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<publishable key>"
pnpm mcp:marketing-cost:login
icacls "$env:APPDATA\tile-concept\mcp-session.json"
```

Instead of the two `$env:` lines, you can put these two values in the repository's `.env.local`.

- **How the file is protected.** Windows ignores mode 600, so the server uses `icacls` instead. It removes inherited permissions and grants access only to your account, on the folder (inherited by new files) and on the file after every write.
- **What `icacls` should list.** Your account (`<PC or domain>\<you>:(F)`), and possibly `NT AUTHORITY\SYSTEM` or `BUILTIN\Administrators`. Those two are tolerated because they can read any file anyway.
- **What makes the server refuse to start.** Any other entry, such as `Everyone`, `BUILTIN\Users`, `Authenticated Users` or another account. The error prints the `icacls` command that fixes it.
- **Not yet run on Windows.** This ACL handling is unit-tested against `icacls` output shapes but has not been run on a Windows machine. After the first sign-in, check the `icacls` output yourself.

`pnpm` on Windows is a `.cmd` shim, so MCP clients that start processes directly need `cmd /c` in front of it:

```powershell
claude mcp add --scope user --transport stdio `
  --env SUPABASE_URL=https://ewyiiematuuojlhpioqh.supabase.co `
  --env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key> `
  --env TC_MCP_MEMBER_EMAIL=<your email> `
  tile-marketing-cost -- cmd /c pnpm --dir C:\path\to\tile-concept --silent mcp:marketing-cost
```

```toml
# %USERPROFILE%\.codex\config.toml
[mcp_servers.tile-marketing-cost]
command = "cmd"
args = ["/c", "pnpm", "--dir", "C:\\path\\to\\tile-concept", "--silent", "mcp:marketing-cost"]
env = { SUPABASE_URL = "https://ewyiiematuuojlhpioqh.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "<publishable key>", TC_MCP_MEMBER_EMAIL = "<your email>" }
startup_timeout_sec = 30
```

None of this is needed to use the app's *Import TikTok report* button.

Then ask the agent to preview the report with the expected figures 46 and 3,269.40. Import only after reviewing the preview, then verify.

## Verification evidence (local stack, synthetic data only)

- `supabase/tests/023_marketing_spend_batch_import.sql`: 87 assertions covering permissions (analyst, sales rep, coordinator, anonymous), reconciliation mismatches, tax/currency/mapping refusals, zero/fractional/duplicate/out-of-range/impossible dates, failed batches leaving no rows, duplicate file, same-request retry, overlap with daily totals and with manual campaign detail, provenance, audit, coverage invalidation, funnel MER N/A with unreported tax, correction history, batch void and re-import, and workspace isolation. All 24 DB suites pass (870 assertions), including the unchanged `014_marketing_funnels.sql`.
- Unit tests: parser (a synthetic 50-day, two-campaign report with 4 zero-spend days reconciles to exactly **46 dates / MYR 3,269.40**; Excel serial dates; currency detection; total-row check; bad rows), service (preview, blockers, duplicate retry, refusals, verification compare) and MCP tools over an in-memory transport.
- `pnpm mcp:marketing-cost:smoke` (local only) spawns the real stdio server exactly as documented (`pnpm --silent mcp:marketing-cost`), **without the service-role key in its environment**. Members sign in with their own password, or with a magic link for the demo guest. It checks:
  - start refused for: no session, an email alone, a mismatched email, a forged token, a world-readable file, and a copy of a logged-out session;
  - preview, import and verify-by-file;
  - same-request retry, duplicate and overlap refusal;
  - sales-rep refusal;
  - workspace isolation: the demo workspace imports the same file independently and cannot list or verify the other workspace's batch;
  - then it voids its batches.
- Login CLI checked by hand: password hidden, session file created 600, `--status`, wrong password refused, `--logout` revokes.
- Browser check of the import dialog, duplicate/overlap blockers, the ledger table, stating tax through the popup, verification and the funnel's unreported-tax hints.
- `supabase db lint` reports no finding in the new or changed functions.

**Real report: verified (5 October 2026).** The original export `View Report-Trend-2026-08-01-2026-10-05.xlsx` (12,290 bytes, SHA-256 `325550d2852ac00ba71f22bfd28e4d3fe626a611a870bbe43e5272afd33177ff`) was retrieved from the owner's Drive and checked. It was never committed, and no copy of its rows is in the repository or the tests.

- **First run found a real difference.** The export ends with a **summary row**: `-` in By Day, Campaign ID, Campaign name and Currency, with the report's total Spend. The parser had only recognised "Total…" rows, so it refused the file ("No readable date on row 200"). The parser now treats a final all-dashed row as the report total. It isn't imported, but the dated rows must sum to it exactly. A dashed row anywhere else is still refused.
- **Campaign lists.** The export lists every campaign on every day, including zero spend. A date's campaigns are now the ones that spent; zero rows stay in the date's source rows as provenance.
- **`pnpm marketing-cost:check` result:**
  - **OK:** sheet `Trend`, header row 1, currency MYR (stated by the report);
  - 198 dated rows, 3 campaigns;
  - **46 dates with spend, MYR 3,269.40**, equal to the report's own summary row;
  - 20 zero-spend dates excluded;
  - 17 August is the only date that sums more than one campaign (two campaigns).
- **Through the database (local stack, real MCP server, member session):** the preview was importable with no blockers. The import reconciled 46/46 lines (ledger MYR 3,269.40, tax "not reported" on all 46), verify-by-file matched every date, and a second import was refused (23505). The local database was then reset.
- **Regression test.** `tests/unit/spend-import.test.ts` covers the summary row (accepted at the end, reconciled, refused mid-file) and the spending-campaign list, with synthetic values in the export's shape.

## Before importing live records

1. ~~Run `pnpm marketing-cost:check` on the real report~~: done, OK (see above). Re-run it on any newer export before importing that one.
2. Apply `supabase/migrations/20261004000002_marketing_spend_batch_import.sql` to hosted (dry run first) **before** deploying the code: the spend page reads the new view columns and functions. Never use the local reset command on hosted data.
3. Deploy the app.
4. Preview the real report with the expected figures 46 / 3,269.40, in the app or with the MCP preview tool. Check the currency basis, the excluded zero-spend dates and that there are no blockers.
5. Import, then verify. Spending coverage for those TikTok days is invalidated by design, so re-confirm it after checking the statements.
6. When the TikTok invoice arrives, a reviewer states the tax on each entry. MER becomes available once every cost in the period has a stated tax and coverage is complete.
