import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { toIsoDate, WORKBOOK_READ_OPTIONS } from "./import-dates";

// The coordinator's synthetic TILE-80 reproduction, verbatim.
const DECLARED_CSV = `TILE80 declared dates DD/MM/YYYY
Date (DD/MM/YYYY),Name,Phone,Notes
05/10/2026,QC80 Date fifth October,+60100008001,Synthetic fixture only
25/10/2026,QC80 Date twenty fifth October,+60100008002,Synthetic fixture only
`;

function rowsOf(data: Uint8Array | ArrayBuffer) {
  const wb = XLSX.read(data, WORKBOOK_READ_OPTIONS);
  return { wb, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: "" }) };
}
function typedWorkbook(bookType: XLSX.BookType, date1904 = false) {
  const offset = date1904 ? 1462 : 0;
  const ws: XLSX.WorkSheet = {
    "!ref": "A1:A4",
    A1: { t: "s", v: "Date" },
    A2: { t: "n", v: 46300 - offset, z: "dd/mm/yyyy" },
    A3: { t: "n", v: 46320.6041666667 - offset, z: "dd/mm/yyyy hh:mm" },
    A4: { t: "n", v: 46300 - offset },
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "October");
  if (date1904) wb.Workbook = { WBProps: { date1904: true } };
  return XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer;
}

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe.each([
  ["UTC", 0, ["2026-10-05T14:30:45.000Z", "2026-10-05T20:30:45.000Z"]],
  ["Asia/Kuala_Lumpur", -480, ["2026-10-05T06:30:45.000Z", "2026-10-05T12:30:45.000Z"]],
] as const)("walk-in import dates with the clock in %s", (tz, offsetMinutes, localDateTimes) => {
  const at = (fn: () => void) => () => {
    process.env.TZ = tz;
    expect(new Date(2026, 9, 5).getTimezoneOffset(), "timezone switch took effect").toBe(offsetMinutes);
    fn();
  };

  it("keeps declared DD/MM/YYYY CSV rows on the stated day, ambiguous or not", at(() => {
    const { rows } = rowsOf(new TextEncoder().encode(DECLARED_CSV));
    expect(rows[2]).toEqual(["05/10/2026", "QC80 Date fifth October", "+60100008001", "Synthetic fixture only"]);
    expect(rows.slice(2).map((r) => toIsoDate(r[0]))).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-25T00:00:00.000Z"]);
  }));

  it("keeps typed .xlsx and .xls date cells, date-times and serials on their day", at(() => {
    for (const bookType of ["xlsx", "biff8"] as const) {
      const { rows } = rowsOf(typedWorkbook(bookType));
      expect(rows.slice(1).map((r) => toIsoDate(r[0])), bookType).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-25T14:30:00.000Z", "2026-10-05T00:00:00.000Z"]);
    }
  }));

  it("reads 1904-based workbooks with their own epoch", at(() => {
    const { wb, rows } = rowsOf(typedWorkbook("xlsx", true));
    const date1904 = !!wb.Workbook?.WBProps?.date1904;
    expect(date1904).toBe(true);
    expect(rows.slice(1).map((r) => toIsoDate(r[0], date1904))).toEqual(["2026-10-05T00:00:00.000Z", "2026-10-25T14:30:00.000Z", "2026-10-05T00:00:00.000Z"]);
  }));

  it("reads ISO, day-first variants, serial text and written dates without shifting the day", at(() => {
    expect(toIsoDate("2026-10-05")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("5/10/2026")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("05.10.2026")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("05-10-26")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate(" 05/10/2026 ")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("46300")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("5 Oct 2026")).toBe("2026-10-05T00:00:00.000Z");
    expect(toIsoDate("2026-10-05T14:30:00+08:00")).toBe("2026-10-05T06:30:00.000Z");
    expect(toIsoDate("29/02/2024")).toBe("2024-02-29T00:00:00.000Z");
  }));

  it("keeps full ISO date-times to the second, as before: their offset, or the browser's timezone without one", at(() => {
    expect(toIsoDate("2026-10-05T14:30:45Z")).toBe("2026-10-05T14:30:45.000Z");
    expect(toIsoDate("2026-10-05T14:30:45+08:00")).toBe("2026-10-05T06:30:45.000Z");
    expect(toIsoDate("2026-10-05T14:30:45")).toBe(localDateTimes[0]);
    expect(toIsoDate("2026-10-05 14:30:45")).toBe(localDateTimes[0]);
    expect(toIsoDate("2026-10-05T20:30:45")).toBe(localDateTimes[1]);
  }));

  it("refuses dates that do not exist instead of rolling them over", at(() => {
    for (const v of ["31/02/2026", "29/02/2026", "00/10/2026", "05/13/2026", "32/01/2026", "2026-02-30", "2026-13-01", "2026-02-30T14:30:00Z", "2026-02-30T14:30:00+08:00", "2026-02-30T14:30:00", "2026-02-30 14:30", "2026-04-31T00:00:00.000Z", "not a date", "", null, undefined, 1e12]) {
      expect(toIsoDate(v), String(v)).toBeNull();
    }
  }));
});
