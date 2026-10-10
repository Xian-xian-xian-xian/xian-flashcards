import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "flashcards-review-api-"));
process.env.FLASHCARDS_DATA_DIR = testDir;
const database = await import("./db.js");
const { createServer } = await import("node:net");
let child: ChildProcess;
let baseUrl: string;
const dueAt = new Date(Date.now() - 1000).toISOString();
const grindStartedAt = new Date(Date.now() - 2000).toISOString();
const oldUpdatedAt = "2020-01-01T00:00:00.000Z";

beforeAll(async () => {
  await database.initDb();
  database.transaction(() => {
    for (const id of [1, 2]) {
      database.run("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, '', ?, ?)", [id, `test-${id}`, oldUpdatedAt, oldUpdatedAt]);
    }
    database.run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('test-session', 1, '2099-01-01T00:00:00.000Z', ?)", [oldUpdatedAt]);
    for (const [id, user, parent] of [[1, 1, null], [2, 1, 1], [3, 1, null], [4, 2, null]]) {
      database.run("INSERT INTO decks (id, user_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [id, user, parent, `deck-${id}`, oldUpdatedAt, oldUpdatedAt]);
    }
    for (const [id, user, deck, stage, paused] of [[1, 1, 1, 1, 0], [2, 1, 2, 1, 0], [3, 1, 1, 1, 0], [4, 1, 3, 1, 0], [5, 2, 4, 1, 0], [6, 1, 1, 1, 1], [7, 1, 1, 0, 0]]) {
      database.run("INSERT INTO cards (id, user_id, deck_id, card_type, front, back, paused, created_at, updated_at) VALUES (?, ?, ?, 'basic', ?, 'answer', ?, ?, ?)", [id, user, deck, `card-${id}`, paused, oldUpdatedAt, oldUpdatedAt]);
      database.run("INSERT INTO reviews (card_id, stage, due_at, updated_at) VALUES (?, ?, ?, ?)", [id, stage, dueAt, oldUpdatedAt]);
    }
    database.setUserSetting(1, "tomatoes.state.v1", JSON.stringify({ activePomodoro: { no: 9, taskGoal: "Study", status: "running", phase: "focus", endAt: "2099-01-01T00:00:00.000Z", durationSeconds: 1500 }, records: [{ attachment: "x".repeat(400_000) }] }));
  });
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", FLASHCARDS_DATA_DIR: testDir, CARD_IMAGES_DIR: path.join(testDir, "images"), PRONUNCIATION_CACHE_DIR: path.join(testDir, "speech") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`Test API exited ${code}: ${output}`)));
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Flashcards API listening")) resolve();
    });
    child.stderr?.on("data", (chunk) => { output += chunk; });
  });
}, 15_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.FLASHCARDS_DATA_DIR;
});

async function request(route: string, body?: unknown) {
  const response = await fetch(baseUrl + route, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: "flashcards_session=test-session", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

describe("review submission API", () => {
  it("returns committed progress, scoped remaining counts and only newly due grind interrupts", async () => {
    const result = await request("/api/reviews/1/answer", { rating: "unknown", studyContext: { deckId: 1, grindStartedAt, excludeIds: [1, 3] } });
    expect(result.status).toBe(200);
    expect(result.body.dailyTask.review_completed).toBe(1);
    expect(result.body.study.remaining).toEqual({ newRemaining: 1, reviewRemaining: 2 });
    expect(result.body.study.dueReviews.map((card: { id: number }) => card.id)).toEqual([2]);
    expect(result.body.dailyTask).toEqual((await request("/api/daily-task")).body);
    expect(result.body.previous.undoToken).toEqual(expect.any(String));

    const tooEarly = await request("/api/reviews/1/answer", { rating: "known" });
    expect(tooEarly.status).toBe(409);
    const practice = await request("/api/reviews/1/practice", { rating: "known", studyContext: { deckId: 1 } });
    expect(practice.status).toBe(200);
    expect(practice.body.stage).toBe(result.body.stage);
    expect(practice.body.dueAt).toBe(result.body.dueAt);
    expect(practice.body.dailyTask.review_mastered).toBe(1);
    expect(practice.body.study.dueReviews).toEqual([]);
    expect(practice.body.dailyTask).toEqual((await request("/api/daily-task")).body);

    expect((await request("/api/reviews/1/practice/restore", { undoToken: practice.body.previous.undoToken })).status).toBe(200);
    expect((await request("/api/daily-task")).body.review_mastered).toBe(0);
    expect((await request("/api/reviews/1/restore", { undoToken: result.body.previous.undoToken })).status).toBe(200);
    expect((await request("/api/reviews/remaining?deckId=1")).body).toEqual({ newRemaining: 1, reviewRemaining: 3 });
    expect((await request("/api/reviews/1/restore", { undoToken: result.body.previous.undoToken })).status).toBe(409);
  });

  it("does not expose another owner's cards through supplied study context", async () => {
    const result = await request("/api/reviews/7/answer", { rating: "known", studyContext: { deckId: 4, grindStartedAt } });
    expect(result.status).toBe(200);
    expect(result.body.study).toEqual({ remaining: { newRemaining: 0, reviewRemaining: 0 }, dueReviews: [] });
    expect((await request("/api/reviews/5/answer", { rating: "known", studyContext: { deckId: 4 } })).status).toBe(404);
  });

  it("keeps old clients working without a study context", async () => {
    const result = await request("/api/reviews/3/answer", { rating: "fuzzy" });
    expect(result.status).toBe(200);
    expect(result.body.study).toBeUndefined();
    expect(result.body.previous.undoToken).toEqual(expect.any(String));
    expect(result.body.dailyTask).toEqual((await request("/api/daily-task")).body);
  });

  it("returns a small authenticated timer while preserving full state for the tomato app", async () => {
    const active = await request("/api/tomatoes/active");
    expect(active.status).toBe(200);
    expect(active.body.state.activePomodoro.taskGoal).toBe("Study");
    expect(JSON.stringify(active.body).length).toBeLessThan(300);
    expect((await request("/api/tomatoes/state")).body.state.records[0].attachment).toHaveLength(400_000);
    expect((await fetch(baseUrl + "/api/tomatoes/active")).status).toBe(401);
  });
});
