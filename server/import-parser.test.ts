import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { checkWorkbookArchive, parseImport } from "./import-parser.js";

describe("bounded import parsing", () => {
  it("preserves CSV, TSV and XLSX imports", () => {
    expect(parseImport({ text: "front,back\nquestion,answer" })).toEqual([{ front: "question", back: "answer" }]);
    expect(parseImport({ text: "front\tback\nquestion\tanswer" })).toEqual([{ front: "question", back: "answer" }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ front: "问题", back: "答案" }]), "Sheet1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    expect(parseImport({ buffer, filename: "cards.xlsx" })).toEqual([{ front: "问题", back: "答案" }]);
    const oversized = Buffer.from(buffer);
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    oversized.writeUInt32LE(50 * 1024 * 1024, central + 24);
    expect(() => checkWorkbookArchive(oversized)).toThrow("32 MB");
  });
  it("rejects excessively many rows and oversized text records", () => {
    expect(() => parseImport({ text: "front,back\n" + "q,a\n".repeat(5_001) })).toThrow("5000");
    expect(() => parseImport({ text: "front,back\n" + "a".repeat(140_000) + ",b" })).toThrow();
  });
});
