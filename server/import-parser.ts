import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export const maxImportRows = 5_000;

// Reject oversized ZIP contents before the workbook parser expands an XLSX.
export function checkWorkbookArchive(buffer: Buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) return; // Legacy XLS uses a different container.
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65_557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, buffer.length - 65_557)) throw new Error("无效的 XLSX 文件");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count > 2_048 || offset >= end) throw new Error("表格内容过大");
  let expandedBytes = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("无效的 XLSX 文件");
    const bytes = buffer.readUInt32LE(offset + 24);
    expandedBytes += bytes;
    if (bytes > 16 * 1024 * 1024 || expandedBytes > 32 * 1024 * 1024) throw new Error("表格解压后的内容不能超过 32 MB");
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

export function parseImport(input: { buffer?: Buffer; filename?: string; text?: string }) {
  let rows: Record<string, unknown>[];
  if (input.buffer && /\.xlsx?$/i.test(input.filename ?? "")) {
    if (input.buffer.length < 22) throw new Error("无效的表格文件");
    checkWorkbookArchive(input.buffer);
    const workbook = XLSX.read(input.buffer, { sheetRows: maxImportRows + 2, sheets: 0, bookVBA: false, cellHTML: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("表格没有可导入的工作表");
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
    if (range.e.r - range.s.r > maxImportRows || range.e.c > 100) throw new Error("每次最多导入 5000 行、100 列");
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } else {
    const content = input.buffer ?? input.text ?? "";
    const text = typeof content === "string" ? content : content.toString("utf8");
    rows = parse(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true,
      delimiter: text.includes("\t") ? "\t" : ",", max_record_size: 128 * 1024, to: maxImportRows + 1 });
  }
  if (rows.length > maxImportRows) throw new Error("每次最多导入 5000 行，请拆分文件");
  if (Buffer.byteLength(JSON.stringify(rows)) > 16 * 1024 * 1024) throw new Error("表格内容过大，请拆分文件");
  return rows;
}
