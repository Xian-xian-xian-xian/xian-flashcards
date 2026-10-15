import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./atomic-file.js";

export function saveTomatoHistory(userId: number, revision: number, state: unknown) {
  if (!state) return;
  const dataDir = process.env.FLASHCARDS_DATA_DIR ?? path.resolve(process.cwd(), "data");
  const directory = path.join(dataDir, "tomato-history", String(userId));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `${String(revision).padStart(12, "0")}.json`);
  atomicWriteFile(filename, Buffer.from(JSON.stringify({ userId, revision, savedAt: new Date().toISOString(), state })));
  const versions = fs.readdirSync(directory).filter((name) => /^\d{12}\.json$/.test(name)).sort().reverse();
  for (const old of versions.slice(20)) fs.rmSync(path.join(directory, old));
}
