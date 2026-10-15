import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flashcards-security-audit-"));
process.env.FLASHCARDS_DATA_DIR = directory;
const database = await import("./db.js");
let child: ChildProcess;
let base: string;
const timestamp = "2026-01-01T00:00:00.000Z";
const initialState = { settings: {}, records: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), date: "2026-10-15", no: i + 1, tomatoWeight: 1 })), recentTasks: [], longTermGoals: [], clipboardHistory: [], activePomodoro: null };

beforeAll(async () => {
  await database.initDb();
  database.transaction(() => {
    for (const [id, username] of [[1, "Xian"], [2, "Partner"]]) {
      database.run("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, '', ?, ?)", [id, username, timestamp, timestamp]);
      database.run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', ?)", [`audit-${id}`, id, timestamp]);
      database.run("INSERT INTO decks (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [id, id, `Private deck ${id}`, timestamp, timestamp]);
      database.run("INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at) VALUES (?, ?, ?, ?, 'answer', ?, ?)", [id, id, id, `Private card ${id}`, timestamp, timestamp]);
      database.run("INSERT INTO reviews (card_id, stage, due_at, updated_at) VALUES (?, 0, ?, ?)", [id, timestamp, timestamp]);
    }
    database.setUserSetting(1, "tomatoes.state.v1", JSON.stringify(initialState));
  });
  fs.mkdirSync(path.join(directory, "card-images", "1"), { recursive: true });
  fs.writeFileSync(path.join(directory, "card-images", "1", "123e4567-e89b-42d3-a456-426614174000.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer(); listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address(); const port = typeof address === "object" && address ? address.port : 0;
      listener.close(() => resolve(port));
    });
  });
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    cwd: process.cwd(), env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", FLASHCARDS_DATA_DIR: directory,
      CARD_IMAGES_DIR: path.join(directory, "card-images"), PRONUNCIATION_CACHE_DIR: path.join(directory, "speech"), REGISTRATION_INVITE_CODE: "security-test-code" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API did not start: ${output}`)), 15_000);
    child.on("error", reject);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}: ${output}`)); });
    child.stdout?.on("data", (data) => { output += data; if (output.includes("Flashcards API listening")) { clearTimeout(timer); resolve(); } });
    child.stderr?.on("data", (data) => { output += data; });
  });
}, 20_000);

afterAll(async () => {
  if (child?.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill(); await stopped; }
  fs.rmSync(directory, { recursive: true, force: true }); delete process.env.FLASHCARDS_DATA_DIR;
});

async function request(route: string, user: number | null = 1, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(base + route, { method, headers: { ...(user ? { Cookie: `flashcards_session=audit-${user}` } : {}), "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("pre-release security and data-safety audit", () => {
  it("requires authentication for personal data, images, game state and speech configuration", async () => {
    for (const route of ["/api/decks", "/api/stats", "/api/settings", "/api/tomatoes/state", "/api/game/state", "/api/logs/recent", "/api/tts/xml", "/api/import/recent", "/api/card-images/1/123e4567-e89b-42d3-a456-426614174000.png"]) {
      expect((await request(route, null)).status, route).toBe(401);
    }
    expect((await request("/api/auth/status", null, "GET", undefined, { Cookie: "flashcards_session=%zz" })).status).toBe(200);
    expect((await request("/api/auth/login", null, "POST", { username: "' OR 1=1 --", password: "incorrect" })).status).toBe(401);
  });

  it("prevents a partner from reading or altering another account's cards, images and data", async () => {
    const partnerDecks = await request("/api/decks?userId=1", 2).then((r) => r.json());
    expect(partnerDecks.map((d: { id: number }) => d.id)).toEqual([2]);
    expect(await request("/api/decks/1/cards", 2).then((r) => r.json())).toEqual([]);
    expect((await request("/api/cards/1", 2, "PATCH", { front: "stolen", force: true })).status).toBe(404);
    expect((await request("/api/decks/1/cards", 2, "POST", { front: "bad", back: "bad" })).status).toBe(400);
    expect((await request("/api/decks/1", 2, "DELETE")).status).toBe(404);
    expect((await request("/api/card-images/1/123e4567-e89b-42d3-a456-426614174000.png", 2)).status).toBe(404);
    expect((await request("/api/card-images/1/123e4567-e89b-42d3-a456-426614174000.png", 1)).status).toBe(200);
    expect((await request("/api/tts/xml", 2)).status).toBe(403);
    expect((await request("/api/logs/recent", 2)).status).toBe(403);
    expect((await request("/api/logs/recent", 1)).status).toBe(200);
    expect((await request("/api/game/init", 2, "POST", {})).status).toBe(201);
    expect((await request("/api/game/harvest/claim", 2, "POST", { recordId: "1" })).status).toBe(404);
    expect((await request("/api/game/state", 1).then((r) => r.json())).initialized).toBe(false);
    expect((await request("/api/tomatoes/state", 2).then((r) => r.json())).state).toBeNull();
    expect((await request("/api/decks/1/cards").then((r) => r.json()))[0].front).toBe("Private card 1");
  });

  it("rejects stale edits, missing versions, malformed state and accidental bulk record loss while preserving a recovery snapshot", async () => {
    const initial = await request("/api/tomatoes/state").then((r) => r.json());
    expect(initial.revision).toBe(0);
    const next = { ...initialState, records: [...initialState.records, { id: "11", date: "2026-10-15", no: 11, tomatoWeight: 1 }] };
    const saved = await request("/api/tomatoes/state", 1, "PUT", { state: next, baseRevision: 0 });
    expect(saved.status).toBe(200); expect((await saved.json()).revision).toBe(1);
    const stale = await request("/api/tomatoes/state", 1, "PUT", { state: initialState, baseRevision: 0 });
    expect(stale.status).toBe(409); expect((await stale.json()).state.records).toHaveLength(11);
    expect((await request("/api/tomatoes/state", 1, "PUT", { state: next })).status).toBe(409);
    expect((await request("/api/tomatoes/state", 1, "PUT", { state: { ...next, records: [] }, baseRevision: 1 })).status).toBe(422);
    for (const state of [null, {}, { records: [null] }, JSON.parse('{"records":[],"settings":{"__proto__":{}}}')]) {
      expect((await request("/api/tomatoes/state", 1, "PUT", { state, baseRevision: 1 })).status).toBe(400);
    }
    expect((await request("/api/tomatoes/state").then((r) => r.json())).revision).toBe(1);
    expect((await request("/api/tomatoes/state", 1, "PUT", { state: { ...next, records: [] }, baseRevision: 1, allowRecordReplacement: true })).status).toBe(200);
    const snapshot = JSON.parse(fs.readFileSync(path.join(directory, "tomato-history", "1", "000000000001.json"), "utf8"));
    expect(snapshot.state.records).toHaveLength(11);
  });

  it("rejects stale and invalid card versions rather than silently overwriting content", async () => {
    expect((await request("/api/cards/1", 1, "PATCH", { front: "new" })).status).toBe(409);
    expect((await request("/api/cards/1", 1, "PATCH", { front: "new", baseUpdatedAt: "2099-01-01T00:00:00.000Z" })).status).toBe(409);
    const saved = await request("/api/cards/1", 1, "PATCH", { front: "new", baseUpdatedAt: timestamp });
    expect(saved.status).toBe(200);
    const card = (await saved.json()).card;
    expect(card.front).toBe("new"); expect(card.updated_at).not.toBe(timestamp);
    expect((await request("/api/cards/1", 1, "PATCH", { front: "stale", baseUpdatedAt: timestamp })).status).toBe(409);
  });

  it("blocks foreign-origin and form-based writes, handles invalid JSON and bounds query sizes", async () => {
    expect((await request("/api/auth/logout", 1, "POST", {}, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await request("/api/auth/logout", 1, "POST", {}, { "Content-Type": "application/x-www-form-urlencoded" })).status).toBe(415);
    const invalid = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" });
    expect(invalid.status).toBe(400); expect(await invalid.text()).not.toMatch(/server\/|node_modules|SyntaxError/);
    for (const value of ["NaN", "-1", "999999999"]) expect((await request(`/api/reviews/due?limit=${value}`)).status).toBe(200);
    expect((await request("/api/not-a-real-endpoint")).status).toBe(404);
    const headers = (await request("/api/tomatoes/state")).headers;
    expect(headers.get("cache-control")).toBe("no-store"); expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("parses imports in a separate process and keeps the API available", async () => {
    const form = new FormData(); form.append("deckId", "2");
    form.append("file", new Blob(["front,back\nimported question,imported answer"], { type: "text/csv" }), "cards.csv");
    const response = await fetch(base + "/api/import", { method: "POST", headers: { Cookie: "flashcards_session=audit-2" }, body: form });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200); expect(result.imported).toBe(1);
    expect((await request("/api/health", null)).status).toBe(200);
    expect((await request("/api/decks/1/cards").then((r) => r.json()))).toHaveLength(1);
  }, 15_000);
});
