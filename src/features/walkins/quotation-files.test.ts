import { describe, expect, it } from "vitest";
import { quotationContentType, quotationFileError, QUOTATION_MAX_BYTES } from "./quotation-files";

describe("quotation file validation", () => {
  it("accepts original Excel and PDF files regardless of browser MIME or filename case", () => {
    for (const name of ["Quotation.XLSX", "QT.xls", "Quotation 客户.pdf"]) expect(quotationFileError({ name, size: 123 })).toBeNull();
    expect(quotationContentType("QT.XLSX")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
  it("rejects unsupported, empty, oversize and unsafe filenames", () => {
    for (const name of ["QT.xlsm", "QT.xlsx.exe", "QT", "constructor", "../QT.pdf", "a\\QT.xls", "bad\n.pdf", "a".repeat(252) + ".pdf"]) {
      expect(quotationFileError({ name, size: 123 })).not.toBeNull();
    }
    for (const size of [0, -1, 1.5, QUOTATION_MAX_BYTES + 1]) expect(quotationFileError({ name: "QT.pdf", size })).not.toBeNull();
    expect(quotationFileError({ name: "QT.pdf", size: QUOTATION_MAX_BYTES })).toBeNull();
  });
});
