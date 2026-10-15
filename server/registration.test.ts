import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { pbkdf2Sync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrationEnabled, validRegistrationInvite } from "./registration.js";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "flashcards-registration-"));
process.env.FLASHCARDS_DATA_DIR = path.join(testDir, "invited");
const database = await import("./db.js");
const children: ChildProcess[] = [];
const inviteCode = "test-invite-OnlyForTests";
let invitedUrl: string;
let closedUrl: string;

async function startApi(dataDir: string, code: string) {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
  });
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "test", FLASHCARDS_DATA_DIR: dataDir,
      REGISTRATION_INVITE_CODE: code, ALLOW_REGISTRATION: "true", COOKIE_SECURE: "false", COOKIE_DOMAIN: "",
      CARD_IMAGES_DIR: path.join(dataDir, "images"), PRONUNCIATION_CACHE_DIR: path.join(dataDir, "speech") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`API startup timed out: ${output}`)), 15_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`API exited ${code}: ${output}`)); });
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Flashcards API listening")) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on("data", (chunk) => { output += chunk; });
  });
  return `http://127.0.0.1:${port}`;
}

beforeAll(async () => {
  await database.initDb();
  const now = new Date().toISOString();
  const passwordHash = `pbkdf2:210000:salt:${pbkdf2Sync("existing-password", "salt", 210000, 32, "sha256").toString("hex")}`;
  database.run("INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (1, 'existing', ?, ?, ?)", [passwordHash, now, now]);
  database.run("INSERT INTO decks (user_id, name, created_at, updated_at) VALUES (1, 'Private deck', ?, ?)", [now, now]);
  invitedUrl = await startApi(path.join(testDir, "invited"), inviteCode);
  closedUrl = await startApi(path.join(testDir, "closed"), "");
}, 35_000);

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
  }
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.FLASHCARDS_DATA_DIR;
});

async function post(base: string, route: string, body: unknown) {
  return fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("invitation-only registration", () => {
  it("fails closed without a code, including first-account setup and the legacy open-registration flag", async () => {
    const status = await fetch(closedUrl + "/api/auth/status").then((r) => r.json());
    expect(status.canRegister).toBe(false);
    const result = await post(closedUrl, "/api/auth/register", { username: "first-user", password: "password123", inviteCode });
    expect(result.status).toBe(403);
    expect((await result.json()).error).toContain("暂未开放");
  });

  it("rejects missing and incorrect codes before creating accounts, and permits invited users without sharing owner data", async () => {
    const status = await fetch(invitedUrl + "/api/auth/status").then((r) => r.json());
    expect(status.canRegister).toBe(true);
    expect(JSON.stringify(status)).not.toContain(inviteCode);
    const body = { username: "invited-user", password: "password123" };
    for (const input of [body, { ...body, inviteCode: "wrong-code" }]) {
      const result = await post(invitedUrl, "/api/auth/register", input);
      expect(result.status).toBe(403);
      expect((await result.json()).error).toBe("请输入有效的邀请码");
    }
    const result = await post(invitedUrl, "/api/auth/register", { ...body, inviteCode: ` ${inviteCode} ` });
    expect(result.status).toBe(201);
    expect((await result.json()).user).toMatchObject({ id: 2, username: body.username, isSuperuser: false });
    const cookie = result.headers.get("set-cookie")!.split(";")[0];
    expect(await fetch(invitedUrl + "/api/decks", { headers: { Cookie: cookie } }).then((r) => r.json())).toEqual([]);
    expect((await post(invitedUrl, "/api/auth/login", body)).status).toBe(200);
    expect((await post(invitedUrl, "/api/auth/register", { ...body, inviteCode })).status).toBe(400);
    expect((await post(invitedUrl, "/api/auth/register", { ...body, username: "another-invited-user", inviteCode })).status).toBe(201);
    expect((await post(invitedUrl, "/api/auth/register", { ...body, username: "rate-limited-user", inviteCode })).status).toBe(429);
  });

  it("keeps existing accounts able to log in without an invitation", async () => {
    const result = await post(invitedUrl, "/api/auth/login", { username: "existing", password: "existing-password" });
    expect(result.status).toBe(200);
    expect((await result.json()).user.username).toBe("existing");
  });

  it("rejects malformed and retired codes, and accepts only the configured case-sensitive code", () => {
    expect(registrationEnabled("  ")).toBe(false);
    for (const submitted of [undefined, null, [], {}, 123, "", " ", "x".repeat(257), inviteCode.toLowerCase()]) {
      expect(validRegistrationInvite(submitted, inviteCode)).toBe(false);
    }
    expect(validRegistrationInvite(inviteCode, undefined)).toBe(false);
    expect(validRegistrationInvite(inviteCode, "replacement-code")).toBe(false);
    expect(validRegistrationInvite(inviteCode, inviteCode)).toBe(true);
  });
});
