/**
 * Offline check of a TikTok trend report, before any database is involved.
 *
 *   pnpm marketing-cost:check "<report.xlsx>" --expect-dates=46 --expect-total=3269.40 [--declare-myr] [--sheet=Trend]
 *
 * Runs the same parser the app and the MCP tools use and prints what an
 * import would record: dates with spend, the MYR total, excluded zero-spend
 * dates, dates that sum more than one campaign, warnings and errors. It reads
 * the file only: no network, no database, nothing written. Exit code 1 when
 * the report cannot be imported or differs from the expected figures.
 *
 * Campaign names are printed only for multi-campaign dates and only to this
 * terminal; do not paste real report contents into the repository.
 */
import fs from "node:fs";
import path from "node:path";
import { formatCents, parseTikTokTrendReport, reconcile } from "../../src/features/marketing/spend-import/tiktok-trend.ts";

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) throw new Error('Pass the report path: pnpm marketing-cost:check "<report.xlsx>" --expect-dates=46 --expect-total=3269.40');
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const full = path.resolve(file);
  const parse = await parseTikTokTrendReport(new Uint8Array(fs.readFileSync(full)), path.basename(full), {
    declaredCurrency: argv.includes("--declare-myr") ? "MYR" : undefined, sheet: flag("sheet"),
  });
  const expectDates = flag("expect-dates");
  const mismatches = reconcile(parse, { entryCount: expectDates === undefined ? undefined : Number(expectDates), total: flag("expect-total") });

  console.log(`file            ${parse.sourceName}`);
  console.log(`sha256          ${parse.sha256}`);
  console.log(`sheet / header  ${parse.sheet ?? "(csv)"} · row ${parse.headerRow ?? "?"} · ${Object.entries(parse.columns).map(([k, v]) => `${k}="${v}"`).join(" ")}`);
  console.log(`currency        ${parse.currency ?? "not stated"}${parse.currencyBasis ? ` (${parse.currencyBasis})` : ""}`);
  console.log(`report dates    ${parse.dateFrom ?? "?"} – ${parse.dateTo ?? "?"}`);
  console.log(`rows · campaigns ${parse.sourceRowCount} · ${parse.campaignCount}`);
  console.log(`dates w/ spend  ${parse.totals.entryCount}`);
  console.log(`total (MYR)     ${formatCents(parse.totals.cents)}  (before tax; tax is not in the report and is imported as not reported)`);
  if (parse.reportTotal !== null) console.log(`report total    ${parse.reportTotal.toFixed(2)}`);
  console.log(`zero-spend      ${parse.excludedZeroDates.length ? parse.excludedZeroDates.join(", ") : "none"}`);
  const multi = parse.entries.filter((e) => e.campaigns.length > 1);
  console.log(`multi-campaign  ${multi.length ? "" : "none"}`);
  for (const e of multi) console.log(`  ${e.incurred_on}  MYR ${formatCents(e.cents)} = ${e.campaigns.map((c) => `${c.spend.toFixed(2)} (${c.name})`).join(" + ")}  rows ${e.source_rows.join(", ")}`);
  for (const w of parse.warnings) console.log(`warning         ${w}`);
  for (const e of parse.errors) console.log(`ERROR           ${e}`);
  for (const m of mismatches) console.log(`MISMATCH        ${m}`);
  const ok = !parse.errors.length && !mismatches.length;
  console.log(ok ? "\nOK: the report parses and matches the expected figures." : "\nNOT OK: resolve the errors above before importing.");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
