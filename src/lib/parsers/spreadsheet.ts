/**
 * Spreadsheet and CSV extraction (PRD §7.8).
 *
 * Stored values only — formulas are never evaluated. A cell whose value came
 * from a formula is flagged as ambiguous so the reviewer knows the number was
 * computed elsewhere and may not survive a recalculation.
 */
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { averageConfidence, coerceCell, mapHeader, parseDimensions } from "./mapper";
import type { ParseResult, ParsedField, ParsedIssue, ParsedRecord } from "./types";

const PARSER_VERSION = "sheet@1";

interface Grid {
  sheetName: string;
  /** rows[r][c] -> display value */
  rows: string[][];
  /** "r,c" of cells whose value came from a formula */
  formulaCells: Set<string>;
  ref: (r: number, c: number) => string;
}

function gridFromWorkbook(buf: ArrayBuffer): Grid[] {
  // cellFormula keeps `.f` on the cell so we can detect computed values;
  // xlsx does not evaluate formulas on read, it reads the cached result.
  const wb = XLSX.read(buf, { type: "array", cellFormula: true, cellDates: true, cellText: false });
  return wb.SheetNames.map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    const rows: string[][] = [];
    const formulaCells = new Set<string>();
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr] as XLSX.CellObject | undefined;
        if (cell?.f) formulaCells.add(`${r - range.s.r},${c - range.s.c}`);
        const v = cell?.v;
        row.push(v === undefined || v === null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
      }
      rows.push(row);
    }
    return {
      sheetName,
      rows,
      formulaCells,
      ref: (r: number, c: number) => XLSX.utils.encode_cell({ r: r + range.s.r, c: c + range.s.c }),
    };
  });
}

function gridFromCsv(text: string): Grid[] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const rows = (parsed.data ?? []).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []));
  return [
    {
      sheetName: "CSV",
      rows,
      formulaCells: new Set<string>(),
      ref: (r: number, c: number) => `${XLSX.utils.encode_col(c)}${r + 1}`,
    },
  ];
}

/** The header row is the first row where at least two cells are recognisable. */
function findHeaderRow(rows: string[][]): { index: number; mapped: Map<number, { key: string; kind: "canonical" | "dimension" }> } | null {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const mapped = new Map<number, { key: string; kind: "canonical" | "dimension" }>();
    rows[r].forEach((cell, c) => {
      const m = cell ? mapHeader(cell) : null;
      if (m) mapped.set(c, m);
    });
    const keys = new Set([...mapped.values()].map((m) => m.key));
    if (keys.size >= 2 && (keys.has("code") || keys.has("name") || keys.has("amount"))) return { index: r, mapped };
  }
  return null;
}

export function parseSpreadsheet(input: { data: ArrayBuffer; text?: string; isCsv: boolean }): ParseResult {
  let grids: Grid[];
  try {
    grids = input.isCsv ? gridFromCsv(input.text ?? new TextDecoder().decode(input.data)) : gridFromWorkbook(input.data);
  } catch (e) {
    return { records: [], stats: {}, parserVersion: PARSER_VERSION, jobType: "parse_sheet", error: e instanceof Error ? e.message : "The file could not be read as a spreadsheet" };
  }

  const records: ParsedRecord[] = [];
  let rowNo = 0;
  let sheetsWithoutHeader = 0;
  let formulaFlagged = 0;

  for (const grid of grids) {
    const header = findHeaderRow(grid.rows);
    if (!header) {
      sheetsWithoutHeader += 1;
      continue;
    }
    for (let r = header.index + 1; r < grid.rows.length; r++) {
      const cells = grid.rows[r];
      if (!cells.some((c) => c !== "")) continue;

      const raw: Record<string, unknown> = {};
      cells.forEach((cell, c) => {
        const label = grid.rows[header.index][c] || `col_${c + 1}`;
        if (cell !== "") raw[label] = cell;
      });

      const normalized: Record<string, unknown> = {};
      const fields: ParsedField[] = [];
      const issues: ParsedIssue[] = [];
      const dims: Record<string, number> = {};

      for (const [c, m] of header.mapped) {
        const cell = cells[c];
        if (!cell) continue;
        const isFormula = grid.formulaCells.has(`${r},${c}`);
        const region = { sheet: grid.sheetName, ref: grid.ref(r, c), row: r + 1, col: c + 1 };

        if (m.kind === "dimension") {
          const n = Number(String(cell).replace(/[^\d.]/g, ""));
          if (!Number.isNaN(n) && n > 0) {
            dims[m.key] = n;
            fields.push({ key: m.key, value: String(n), confidence: isFormula ? 0.6 : 0.9, source_text: cell, region });
          }
          continue;
        }

        const value = coerceCell(m.key, cell);
        if (value === null) continue;
        normalized[m.key] = value;
        // A header match is strong evidence; a computed cell is weaker because
        // the stored value may be stale.
        fields.push({ key: m.key, value, confidence: isFormula ? 0.65 : 0.95, source_text: cell, region });
        if (isFormula) {
          formulaFlagged += 1;
          issues.push({ code: "ambiguous_formula", detail: `${m.key} came from a formula in ${region.ref}; the stored value was imported, not recalculated.` });
        }
      }

      // Dimensions can also arrive as one "300x600" cell.
      if (Object.keys(dims).length === 0) {
        for (const [label, value] of Object.entries(raw)) {
          const d = parseDimensions(String(value));
          if (d) {
            Object.assign(dims, d);
            fields.push({ key: "dimensions", value: Object.entries(d).map(([k, v]) => `${k}=${v}`).join(" "), confidence: 0.7, source_text: `${label}: ${value}` });
            break;
          }
        }
      }
      if (Object.keys(dims).length) normalized.dimensions = dims;

      if (!normalized.code && !normalized.name) continue; // not a data row
      if (!normalized.code) issues.push({ code: "missing_code", detail: "No product code in this row — set one before approving." });
      const itemType: "product" | "price" = normalized.amount ? "price" : "product";
      if (itemType === "product" && !normalized.name) issues.push({ code: "missing_amount", detail: "No price found in this row; it will publish as a product only." });

      rowNo += 1;
      const confidence = averageConfidence(fields);
      if (confidence < 0.8) issues.push({ code: "low_confidence", detail: "Some fields were matched loosely — check them against the source." });
      records.push({ row_no: rowNo, raw, normalized, confidence, item_type: itemType, issues, fields });
    }
  }

  return {
    records,
    stats: { sheets: grids.length, sheets_without_header: sheetsWithoutHeader, formula_cells_flagged: formulaFlagged, rows: records.length },
    parserVersion: PARSER_VERSION,
    jobType: "parse_sheet",
    error: records.length === 0 ? "No rows with a recognisable product code, name or price were found" : undefined,
  };
}
