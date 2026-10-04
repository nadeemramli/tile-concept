import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  moneyCents, parseTikTokTrendReport, reconcile, reportDate, toBatchPayload,
} from "@/features/marketing/spend-import/tiktok-trend";
import {
  compareFileToBatch, importSpendBatch, previewSpendImport, verifySpendFile, type RpcClient, type Verification,
} from "@/features/marketing/spend-import/service";

// Synthetic data only: campaign names and amounts are invented.
const enc = (s: string) => new TextEncoder().encode(s);
const csv = (rows: (string | number)[][]) => enc(rows.map((r) => r.map((c) => (String(c).includes(",") ? `"${c}"` : c)).join(",")).join("\n"));

/** 50 calendar days, 4 of them zero-spend, two campaigns: 46 dates totalling MYR 3,269.40. */
function syntheticReport() {
  const rows: (string | number)[][] = [["Date", "Campaign name", "Spend", "Currency"]];
  const zero = new Set([5, 17, 30, 44]);
  let cents = 0;
  for (let i = 0; i < 50; i++) {
    const day = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
    if (zero.has(i)) {
      rows.push([day, "Synthetic Awareness", "0.00", "MYR"], [day, "Synthetic Leads", "-", "MYR"]);
      continue;
    }
    // Uneven amounts that do not sum cleanly in binary floating point.
    const a = 4000 + ((i * 37) % 900); const b = 2000 + ((i * 53) % 700);
    rows.push([day, "Synthetic Awareness", (a / 100).toFixed(2), "MYR"], [day, "Synthetic Leads", (b / 100).toFixed(2), "MYR"]);
    cents += a + b;
  }
  // Pad the last real date so the whole report totals exactly MYR 3,269.40.
  const pad = 326940 - cents;
  const last = rows[rows.length - 1];
  last[2] = ((Math.round(Number(last[2]) * 100) + pad) / 100).toFixed(2);
  return rows;
}

describe("TikTok trend report parser", () => {
  it("aggregates campaign spend by date, excludes zero-spend dates and reconciles 46 dates / MYR 3,269.40", async () => {
    const parse = await parseTikTokTrendReport(csv(syntheticReport()), "synthetic-trend.csv");
    expect(parse.errors).toEqual([]);
    expect(parse.totals.entryCount).toBe(46);
    expect(parse.totals.cents).toBe(326940);
    expect(parse.excludedZeroDates).toHaveLength(4);
    expect(parse.currency).toBe("MYR");
    expect(parse.currencyBasis).toBe("report_stated");
    expect(parse.campaignCount).toBe(2);
    expect(parse.sourceRowCount).toBe(100);
    expect(reconcile(parse, { entryCount: 46, total: "3,269.40" })).toEqual([]);
    expect(reconcile(parse, { entryCount: 45, total: 3269.41 })).toEqual([
      "Expected 45 dates with spend; the report has 46.",
      "Expected MYR 3269.41; the report totals MYR 3269.40.",
    ]);
    const entry = parse.entries[0];
    expect(entry.campaigns.map((c) => c.name)).toEqual(["Synthetic Awareness", "Synthetic Leads"]);
    expect(entry.cents).toBe(Math.round(entry.campaigns.reduce((s, c) => s + c.spend, 0) * 100));
    expect(entry.source_rows).toEqual([2, 3]);
  });

  it("builds a payload whose line sums and totals the database can recompute exactly", async () => {
    const parse = await parseTikTokTrendReport(csv(syntheticReport()), "synthetic-trend.csv");
    const payload = toBatchPayload(parse);
    expect(payload.tax_status).toBe("unreported");
    expect(payload).not.toHaveProperty("tax");
    expect(payload.mapping).toEqual({ platform: "tiktok", entry_mode: "daily_total", category: "platform_ads", vendor: "TikTok" });
    expect(payload.totals).toEqual({ entry_count: 46, before_tax: 3269.4 });
    expect(JSON.stringify(payload.totals.before_tax)).toBe("3269.4");
    for (const e of payload.entries) {
      const sen = e.campaigns.reduce((s, c) => s + Math.round(c.spend * 100), 0);
      expect(Math.round(e.before_tax * 100)).toBe(sen);
      expect(String(e.before_tax)).toMatch(/^\d+(\.\d{1,2})?$/);
    }
    expect(payload.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to assume a currency, and records a declared one as declared", async () => {
    const rows = [["Date", "Campaign name", "Spend"], ["2026-08-01", "Synthetic A", "10.00"]];
    const silent = await parseTikTokTrendReport(csv(rows), "no-currency.csv");
    expect(silent.currency).toBeNull();
    expect(silent.errors.join(" ")).toMatch(/does not state its currency/);
    const declared = await parseTikTokTrendReport(csv(rows), "no-currency.csv", { declaredCurrency: "MYR" });
    expect(declared.errors).toEqual([]);
    expect(declared.currencyBasis).toBe("operator_declared");
    const header = await parseTikTokTrendReport(csv([["By Day", "Campaign name", "Cost (MYR)"], ["2026-08-01", "Synthetic A", "10.00"]]), "suffix.csv");
    expect(header.currencyBasis).toBe("report_stated");
    const meta = await parseTikTokTrendReport(csv([["Currency: MYR"], ["Date range: 2026-08-01 ~ 2026-08-31"], ["Date", "Campaign name", "Spend"], ["2026-08-01", "Synthetic A", "10.00"]]), "meta.csv");
    expect(meta.currency).toBe("MYR");
    expect([meta.dateFrom, meta.dateTo]).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("refuses non-MYR and mixed currencies rather than converting", async () => {
    const usd = await parseTikTokTrendReport(csv([["Date", "Campaign name", "Spend", "Currency"], ["2026-08-01", "Synthetic A", "10.00", "USD"]]), "usd.csv", { declaredCurrency: "MYR" });
    expect(usd.currency).toBeNull();
    expect(usd.errors.join(" ")).toMatch(/in USD.*nothing is converted/);
    const mixed = await parseTikTokTrendReport(csv([["Date", "Campaign name", "Spend", "Currency"], ["2026-08-01", "A", "1", "MYR"], ["2026-08-02", "A", "1", "USD"]]), "mixed.csv");
    expect(mixed.errors.join(" ")).toMatch(/more than one currency/);
  });

  it("names every bad row, refuses duplicates and checks the report's own total row", async () => {
    const parse = await parseTikTokTrendReport(csv([
      ["Date", "Campaign name", "Spend", "Currency"],
      ["10/08/2026", "Synthetic A", "1.00", "MYR"],
      ["2026-08-02", "Synthetic A", "1.005", "MYR"],
      ["2026-08-03", "Synthetic A", "-4.00", "MYR"],
      ["2026-08-04", "Synthetic A", "2.00", "MYR"],
      ["2026-08-04", "Synthetic A", "2.00", "MYR"],
    ]), "bad.csv");
    expect(parse.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/No readable date on row 2\..*ambiguous/),
      expect.stringMatching(/The spend on row 3 is not a MYR amount/),
      expect.stringMatching(/Negative spend on row 4;/),
      expect.stringMatching(/same campaign appears twice on one date \(rows 5 and 6\)/),
    ]));
    const total = await parseTikTokTrendReport(csv([
      ["Date", "Campaign name", "Spend", "Currency"],
      ["Total of 2 campaigns", "", "1,000.00", "MYR"],
      ["2026-08-01", "Synthetic A", "600.00", "MYR"],
      ["2026-08-01", "Synthetic B", "300.00", "MYR"],
    ]), "total.csv");
    expect(total.errors).toEqual(["The report's total row says MYR 1000.00, but its dated rows sum to MYR 900.00."]);
    expect(total.sourceRowCount).toBe(2);
  });

  it("reads an Excel export with date-formatted serials and numeric spend", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Report: synthetic"], [], ["Date", "Campaign name", "Campaign ID", "Spend (MYR)"]]);
    XLSX.utils.sheet_add_aoa(ws, [
      [new Date(Date.UTC(2026, 7, 1)), "Synthetic A", "111", 12.3],
      [new Date(Date.UTC(2026, 7, 1)), "Synthetic A", "222", 0.1],
      [new Date(Date.UTC(2026, 7, 2)), "Synthetic B", "333", 0],
      ["Total", "", "", 12.4],
    ], { origin: "A4", cellDates: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trend");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const parse = await parseTikTokTrendReport(bytes, "synthetic-trend.xlsx");
    expect(parse.errors).toEqual([]);
    expect(parse.headerRow).toBe(3);
    expect(parse.entries).toHaveLength(1);
    expect(parse.entries[0]).toMatchObject({ incurred_on: "2026-08-01", cents: 1240 });
    // Two campaigns with the same name but different ids stay separate.
    expect(parse.entries[0].campaigns.map((c) => c.campaign_id)).toEqual(["111", "222"]);
    expect(parse.excludedZeroDates).toEqual(["2026-08-02"]);
    expect(parse.reportTotal).toBe(12.4);
  });

  it("parses money and dates without guessing", () => {
    expect(moneyCents("1,234.5")).toBe(123450);
    expect(moneyCents("RM 10")).toBe(1000);
    expect(moneyCents(0.1 + 0.2)).toBe(30);
    expect(moneyCents("-")).toBeNull();
    expect(moneyCents("1.234")).toBe("invalid");
    expect(moneyCents("12,34")).toBe("invalid");
    expect(reportDate("2026-08-10 00:00:00")).toBe("2026-08-10");
    expect(reportDate("Aug 10, 2026")).toBe("2026-08-10");
    expect(reportDate("10 Aug 2026")).toBe("2026-08-10");
    expect(reportDate("2026-02-30")).toBeNull();
    expect(reportDate("08/10/2026")).toBeNull();
    expect(reportDate(46244)).toBeNull();
  });
});

// A fake api client: records calls and answers like the database would.
function fakeDb(answers: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: RpcClient = {
    rpc(fn, args = {}) {
      calls.push({ fn, args });
      const a = answers[fn]?.(args) ?? { error: { message: `unexpected ${fn}` } };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  };
  return { db, calls };
}
const cleanPreview = { importable: true, can_import: true, issues: [], duplicate_batch: null, conflicts: [] };
const file = () => ({ fileName: "synthetic-trend.csv", bytes: csv(syntheticReport()) });

function verificationFor(parse: Awaited<ReturnType<typeof parseTikTokTrendReport>>, batchId: string): Verification {
  return {
    batch: {
      id: batchId, status: "imported", source_name: parse.sourceName, source_sha256: parse.sha256, source_format: "tiktok_trend_report", parser_version: parse.parserVersion,
      currency: "MYR", currency_basis: "report_stated", tax_status: "unreported", vendor: "TikTok", report_date_from: parse.dateFrom!, report_date_to: parse.dateTo!,
      entry_count: parse.totals.entryCount, total_before_tax: parse.totals.beforeTax, excluded_zero_dates: parse.excludedZeroDates,
      imported_at: "2026-10-04T00:00:00Z", imported_by: "u", voided_at: null, void_reason: null,
    },
    lines: parse.entries.map((e, i) => ({
      incurred_on: e.incurred_on, imported_before_tax: e.before_tax, campaign_count: e.campaigns.length, source_rows: e.source_rows, entry_id: `e${i}`,
      ledger_status: "recorded", ledger_before_tax: e.before_tax, ledger_tax: null, ledger_tax_status: "unreported", version: 1, state: "matches" as const,
    })),
    overlaps: [], issues: [],
    summary: { entries: parse.totals.entryCount, imported_before_tax: parse.totals.beforeTax, matching: parse.totals.entryCount, edited: 0, corrected: 0, voided: 0, ledger_before_tax: parse.totals.beforeTax, tax_unreported: parse.totals.entryCount },
    reconciled: true,
  };
}

describe("marketing-cost batch service", () => {
  it("previews through the database and reports it importable", async () => {
    const { db, calls } = fakeDb({ preview_marketing_spend_batch: () => ({ data: cleanPreview }) });
    const preview = await previewSpendImport(db, file(), { entryCount: 46, total: "3269.40" });
    expect(preview.ok && preview.importable).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["preview_marketing_spend_batch"]);
    expect((calls[0].args.p_input as { totals: unknown }).totals).toEqual({ entry_count: 46, before_tax: 3269.4 });
  });

  it("does not call the database for a report that fails to parse", async () => {
    const { db, calls } = fakeDb({});
    const preview = await previewSpendImport(db, { fileName: "x.csv", bytes: csv([["Date", "Campaign name", "Spend"], ["2026-08-01", "A", "1"]]) });
    expect(preview.ok && preview.importable).toBe(false);
    expect(preview.ok && preview.blockers[0]).toMatch(/does not state its currency/);
    expect(calls).toEqual([]);
  });

  it("refuses to import without restated expectations, or when they disagree with the report", async () => {
    const { db, calls } = fakeDb({ preview_marketing_spend_batch: () => ({ data: cleanPreview }) });
    expect(await importSpendBatch(db, file(), { entryCount: Number.NaN, total: "" }, "r")).toMatchObject({ ok: false, error: expect.stringMatching(/expected number of dates/) });
    const wrong = await importSpendBatch(db, file(), { entryCount: 46, total: "3269.00" }, "r");
    expect(wrong).toMatchObject({ ok: false, error: "Expected MYR 3269.00; the report totals MYR 3269.40." });
    expect(calls.some((c) => c.fn === "import_marketing_spend_batch")).toBe(false);
  });

  it("surfaces duplicate imports and overlapping dates as blockers before importing", async () => {
    const { db, calls } = fakeDb({
      preview_marketing_spend_batch: () => ({ data: { ...cleanPreview, importable: false, duplicate_batch: { id: "b1", imported_at: "2026-09-30T20:00:00Z", source_name: "synthetic-trend.csv", entry_count: 46, total_before_tax: 3269.4 },
        conflicts: [{ incurred_on: "2026-07-01", entry_id: "e1", entry_mode: "campaign", entry_key: "k", before_tax: 1, tax: 0, tax_status: "stated", import_batch_id: null, reference: "r", report_before_tax: 2, same_amount: false }] } }),
    });
    const result = await importSpendBatch(db, file(), { entryCount: 46, total: "3269.40" }, "r");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.blockers).toEqual([
      "This file was already imported on 2026-10-01 as batch b1.",
      "TikTok costs are already recorded on 2026-07-01; a day takes one daily total or campaign detail, never both.",
    ]);
    expect(calls.some((c) => c.fn === "import_marketing_spend_batch")).toBe(false);
  });

  it("lets the database answer a retry of an already-imported file: same request returns the batch, another is refused", async () => {
    const parse = await parseTikTokTrendReport(file().bytes, "synthetic-trend.csv");
    const earlier = { id: "batch-1", imported_at: "2026-10-01T02:00:00Z", source_name: "synthetic-trend.csv", entry_count: 46, total_before_tax: 3269.4 };
    const own = parse.entries.map((e, i) => ({ incurred_on: e.incurred_on, entry_id: `e${i}`, entry_mode: "daily_total", entry_key: "daily-total", before_tax: e.before_tax, tax: null, tax_status: "unreported", import_batch_id: "batch-1", reference: "r", report_before_tax: e.before_tax, same_amount: true }));
    const { db } = fakeDb({
      preview_marketing_spend_batch: () => ({ data: { ...cleanPreview, importable: false, duplicate_batch: earlier, conflicts: own } }),
      import_marketing_spend_batch: (args) => args.p_request_id === "req-1" ? { data: "batch-1" } : { error: { message: "This report was already imported on 2026-10-01 10:00 (batch batch-1).", code: "23505" } },
      verify_marketing_spend_batch: () => ({ data: verificationFor(parse, "batch-1") }),
    });
    expect(await importSpendBatch(db, file(), { entryCount: 46, total: "3269.40" }, "req-1")).toMatchObject({ ok: true, batchId: "batch-1" });
    expect(await importSpendBatch(db, file(), { entryCount: 46, total: "3269.40" }, "req-2")).toMatchObject({ ok: false, code: "23505" });
  });

  it("passes a database refusal through unchanged (permissions, race with another import)", async () => {
    const { db } = fakeDb({
      preview_marketing_spend_batch: () => ({ data: cleanPreview }),
      import_marketing_spend_batch: () => ({ error: { message: "Permission denied: marketing.spend.write", code: "42501" } }),
    });
    expect(await importSpendBatch(db, file(), { entryCount: 46, total: 3269.4 }, "r")).toEqual({ ok: false, error: "Permission denied: marketing.spend.write", code: "42501" });
  });

  it("imports, then verifies the batch it created", async () => {
    const parse = await parseTikTokTrendReport(file().bytes, "synthetic-trend.csv");
    const { db, calls } = fakeDb({
      preview_marketing_spend_batch: () => ({ data: cleanPreview }),
      import_marketing_spend_batch: (args) => ({ data: args.p_request_id === "req-1" ? "batch-1" : null }),
      verify_marketing_spend_batch: (args) => ({ data: verificationFor(parse, String(args.p_batch_id)) }),
    });
    const result = await importSpendBatch(db, file(), { entryCount: 46, total: "3,269.40" }, "req-1");
    expect(result).toMatchObject({ ok: true, batchId: "batch-1", verification: { reconciled: true, summary: { matching: 46 } } });
    expect(calls.map((c) => c.fn)).toEqual(["preview_marketing_spend_batch", "import_marketing_spend_batch", "verify_marketing_spend_batch"]);
  });

  it("verifies a file against its batch and the current ledger, date by date", async () => {
    const parse = await parseTikTokTrendReport(file().bytes, "synthetic-trend.csv");
    const verification = verificationFor(parse, "batch-1");
    expect(compareFileToBatch(parse, verification)).toMatchObject({ sameFile: true, matches: true });
    const corrected = structuredClone(verification);
    corrected.lines[3].ledger_before_tax += 1;
    corrected.lines.pop();
    const cmp = compareFileToBatch(parse, corrected);
    expect(cmp.matches).toBe(false);
    expect(cmp.amountDiffers).toEqual([expect.objectContaining({ incurred_on: parse.entries[3].incurred_on })]);
    expect(cmp.missingInBatch).toEqual([parse.entries[45].incurred_on]);

    const { db } = fakeDb({
      preview_marketing_spend_batch: () => ({ data: { ...cleanPreview, importable: false, duplicate_batch: { id: "batch-1", imported_at: "2026-10-01T00:00:00Z", source_name: "x", entry_count: 46, total_before_tax: 3269.4 } } }),
      verify_marketing_spend_batch: () => ({ data: verification }),
    });
    expect(await verifySpendFile(db, file())).toMatchObject({ ok: true, imported: true, reconciled: true });
    const { db: none } = fakeDb({ preview_marketing_spend_batch: () => ({ data: cleanPreview }) });
    expect(await verifySpendFile(none, file())).toMatchObject({ ok: true, imported: false });
  });
});
