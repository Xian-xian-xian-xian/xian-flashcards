import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  it("keeps the last durable database and rolls back memory when an atomic replacement fails", () => {
    const filename = path.join(testDataDir, "flashcards.sqlite");
    const before = fs.readFileSync(filename);
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("simulated disk failure"); });
    try {
      expect(() => database.transaction(() => {
        database.run("INSERT INTO settings (key, value) VALUES ('failed-save', 'must not leak')");
      })).toThrow("simulated disk failure");
    } finally { rename.mockRestore(); }
    expect(fs.readFileSync(filename)).toEqual(before);
    expect(database.get("SELECT * FROM settings WHERE key = 'failed-save'")).toBeUndefined();
    expect(fs.readdirSync(testDataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    database.run("INSERT INTO settings (key, value) VALUES ('after-failure', 'saved')");
    expect(database.get("SELECT * FROM settings WHERE key = 'failed-save'")).toBeUndefined();
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });

  it("preserves the original file if syncing the temporary file fails", () => {
    const filename = path.join(testDataDir, "flashcards.sqlite");
    const before = fs.readFileSync(filename);
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error("sync failed"); });
    try { expect(() => database.run("INSERT INTO settings (key, value) VALUES ('sync-failure', 'no')")).toThrow("sync failed"); }
    finally { sync.mockRestore(); }
    expect(fs.readFileSync(filename)).toEqual(before);
    expect(database.get("SELECT * FROM settings WHERE key = 'sync-failure'")).toBeUndefined();
  });
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
