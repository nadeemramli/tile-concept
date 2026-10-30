import { describe, expect, it } from "vitest";
import { parseTesseractTsv } from "@/lib/ocr/tsv";
import { buildOcrRecords, groupEntries, UNREADABLE_PAGE_CONF } from "@/lib/ocr/entries";

const HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

/** Build Tesseract-shaped TSV: one row per word, lines laid out top to bottom. */
function tsv(lines: { words: [string, number][]; y: number }[], page = { w: 1240, h: 1754 }): string {
  const rows = [HEADER, `1\t1\t0\t0\t0\t0\t0\t0\t${page.w}\t${page.h}\t-1\t`];
  lines.forEach((line, li) => {
    rows.push(`4\t1\t1\t1\t${li + 1}\t0\t90\t${line.y}\t900\t30\t-1\t`);
    let x = 90;
    line.words.forEach(([text, conf], wi) => {
      rows.push(`5\t1\t1\t1\t${li + 1}\t${wi + 1}\t${x}\t${line.y}\t${text.length * 14}\t30\t${conf}\t${text}`);
      x += text.length * 14 + 12;
    });
  });
  return rows.join("\n");
}

const W = (s: string, conf = 95): [string, number][] => s.split(" ").map((t) => [t, conf]);

const CATALOGUE = tsv([
  { words: W("SYNTHETIC TILE CO - TEST CATALOGUE"), y: 100 },
  { words: W("Code: SYN-AB-6060G Size: 600 x 600 mm"), y: 200 },
  { words: W("Finish: Matt Colour: Grey"), y: 250 },
  { words: W("Price: RM 45.90 per m2"), y: 300 },
  { words: W("Code: SYN-AB-3060W Size: 300 x 600 mm"), y: 500 },
  { words: [...W("Finish: Gloss Colour: White"), ["|", 10]], y: 550 },
  { words: [...W("Price: RM"), ["32:50", 70], ...W("per m2")], y: 600 },
]);

describe("Tesseract TSV", () => {
  it("groups words into lines with boxes and confidence, ignoring specks", () => {
    const page = parseTesseractTsv(CATALOGUE);
    expect(page.width).toBe(1240);
    expect(page.lines).toHaveLength(7);
    const finish = page.lines[5];
    expect(finish.text).toBe("Finish: Gloss Colour: White |");
    // The "|" speck at 10% does not drag the line down.
    expect(finish.conf).toBe(95);
    expect(finish.minConf).toBe(95);
    expect(finish.y).toBe(550);
  });

  it("refuses output it does not understand rather than guessing", () => {
    expect(() => parseTesseractTsv("nonsense\n1\t2")).toThrow(/Unexpected Tesseract TSV header/);
  });
});

describe("OCR entries", () => {
  it("starts an entry at each product code and keeps the lines beneath it", () => {
    const { preamble, entries } = groupEntries(parseTesseractTsv(CATALOGUE));
    expect(preamble.map((l) => l.text)).toEqual(["SYNTHETIC TILE CO - TEST CATALOGUE"]);
    expect(entries.map((e) => e.length)).toEqual([3, 3]);
  });

  it("proposes fields with the exact source line, page box and engine confidence", () => {
    const [first] = buildOcrRecords(parseTesseractTsv(CATALOGUE), 1, 1, "tesseract 4.1.1");
    expect(first.page_no).toBe(1);
    expect(first.item_type).toBe("price");
    expect(first.normalized).toMatchObject({ code: "SYN-AB-6060G", amount: "45.90", currency: "MYR", unit: "sqm", color: "Grey", finish: "Matte", source_page_or_row: "page 1, line 4" });
    expect(first.normalized.dimensions).toEqual({ width_mm: 600, length_mm: 600 });
    const amount = first.fields.find((f) => f.key === "amount")!;
    expect(amount.source_text).toBe("Price: RM 45.90 per m2");
    expect(amount.region).toMatchObject({ page: 1, line: 3, x: 90, y: 300, page_w: 1240, page_h: 1754, ocr_conf: 95 });
    // Never certain: the mapper's own doubt times the engine's.
    expect(amount.confidence).toBeLessThan(0.8);
    expect(first.issues.map((i) => i.code)).toContain("low_confidence");
  });

  it("does not take digits from a code or a size for the price", () => {
    const page = parseTesseractTsv(tsv([{ words: W("Code: SYN-AB-6060G Size: 600 x 600 mm"), y: 200 }]));
    const [rec] = buildOcrRecords(page, 3, 1, "t");
    expect(rec.normalized.amount).toBeUndefined();
    expect(rec.item_type).toBe("product");
    expect(rec.issues.map((i) => i.code)).toContain("missing_amount");
  });

  it("flags a misread decimal point instead of repairing it", () => {
    const [, second] = buildOcrRecords(parseTesseractTsv(CATALOGUE), 1, 1, "t");
    expect(second.normalized.amount).toBe("32");
    const amount = second.fields.find((f) => f.key === "amount")!;
    expect(amount.confidence).toBeLessThan(0.35);
    expect(second.issues.some((i) => i.detail.includes('"32:50"'))).toBe(true);
  });

  it("turns an unreadable page into one manual-entry row that says why", () => {
    const poor = parseTesseractTsv(tsv([{ words: W("Cnde SYN-AB-9 Pr1ce", UNREADABLE_PAGE_CONF - 20), y: 200 }]));
    const records = buildOcrRecords(poor, 2, 9, "t");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ page_no: 2, row_no: 9, confidence: 0, normalized: {} });
    expect(records[0].issues[0].code).toBe("needs_manual");
    expect(records[0].issues[0].detail).toMatch(/too poor to read reliably/);
  });

  it("never drops a readable page without codes silently", () => {
    const prose = parseTesseractTsv(tsv([{ words: W("Our porcelain range is made for floors and walls"), y: 200 }]));
    const [rec] = buildOcrRecords(prose, 4, 1, "t");
    expect(rec.issues[0].code).toBe("needs_manual");
    expect(rec.issues[0].detail).toMatch(/no product code was found/);
  });

  it("an empty scan is a manual row, not an empty result", () => {
    const [rec] = buildOcrRecords(parseTesseractTsv(tsv([])), 1, 1, "t");
    expect(rec.issues[0].detail).toMatch(/no text was recognised/);
  });
});
