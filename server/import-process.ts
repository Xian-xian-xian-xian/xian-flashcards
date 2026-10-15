import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { parseImport } from "./import-parser.js";

let parsing = false;

export async function parseImportSafely(input: Parameters<typeof parseImport>[0]) {
  if (parsing) throw new Error("已有表格正在处理，请稍后再试");
  parsing = true;
  try {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
      const child = fork(fileURLToPath(new URL(`./import-worker.${extension}`, import.meta.url)), [], {
        execArgv: [...process.execArgv, "--max-old-space-size=128"], serialization: "advanced",
        env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV }, stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
      let settled = false;
      const finish = (error?: Error, rows?: Record<string, unknown>[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) { child.kill("SIGKILL"); reject(error); }
        else resolve(rows!);
      };
      const timeout = setTimeout(() => finish(new Error("表格处理超时，请缩小文件后重试")), 10_000);
      child.once("error", (error) => finish(error));
      child.once("exit", () => { if (!settled) finish(new Error("表格内容过大或格式无效")); });
      child.once("message", (message: { rows?: Record<string, unknown>[]; error?: string }) => {
        if (message.error) finish(new Error(message.error));
        else if (!Array.isArray(message.rows)) finish(new Error("无法解析表格"));
        else finish(undefined, message.rows);
      });
      child.send(input, (error) => { if (error) finish(error); });
    });
  } finally { parsing = false; }
}
