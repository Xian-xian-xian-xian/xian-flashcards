import { parseImport } from "./import-parser.js";

process.once("message", (input: Parameters<typeof parseImport>[0]) => {
  try {
    const rows = parseImport(input);
    process.send?.({ rows }, () => process.exit(0));
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "无法解析表格" }, () => process.exit(0));
  }
});
