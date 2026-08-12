import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flashcards-db-transaction-"));
process.env.FLASHCARDS_DATA_DIR = testDataDir;

const database = await import("./db.js");

beforeAll(async () => {
  await database.initDb();
});

afterAll(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  delete process.env.FLASHCARDS_DATA_DIR;
});

describe("database transaction", () => {
  it("rolls back every write when an import-like batch fails", () => {
    expect(() => database.transaction(() => {
      database.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["transaction.rollback", "written"]);
      throw new Error("stop batch");
    })).toThrow("stop batch");
    expect(database.get("SELECT value FROM settings WHERE key = ?", ["transaction.rollback"])).toBeUndefined();
  });

  it("commits all writes together after success", () => {
    database.transaction(() => {
      database.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["transaction.commit.a", "a"]);
      database.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["transaction.commit.b", "b"]);
    });
    expect(database.all("SELECT key FROM settings WHERE key LIKE 'transaction.commit.%'")).toHaveLength(2);
  });
});
