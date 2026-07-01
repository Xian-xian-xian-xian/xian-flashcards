import cors from "cors";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { SqlValue } from "sql.js";
import { all, get, getUserSetting, initDb, lastTableId, nowIso, run, setUserSetting } from "./db.js";
import { nextReviewState, type ReviewRating } from "./ebbinghaus.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../dist");
const templateDir = path.resolve(process.cwd(), "模版");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    appendRecentLog({
      at: nowIso(),
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      source: "request",
      message: `${req.method} ${req.originalUrl} ${res.statusCode}`,
      meta: {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        ip: req.ip
      }
    });
  });
  next();
});

type CardInput = {
  card_type?: CardType;
  front: string;
  back: string;
  phonetic?: string;
  example?: string;
  mnemonic?: string;
  note?: string;
  choices?: string[] | string;
  baseUpdatedAt?: string;
  force?: boolean;
};

type CardType = "basic" | "word" | "choice" | "blank";

const maxDeckDepth = 5;
const sessionCookieName = "flashcards_session";
const sessionDays = 30;
const appVersion = "0.3.7";
const timeZone = "Asia/Shanghai";
const normalizedUsers = new Set<number>();
const recentLogWindowMs = 10 * 60 * 1000;
const maxRecentLogEntries = 2000;

type RecentLogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  source: "server" | "request";
  message: string;
  meta?: Record<string, unknown>;
};

const recentLogs: RecentLogEntry[] = [];
const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

function stringifyLogPart(part: unknown) {
  if (part instanceof Error) return `${part.name}: ${part.message}\n${part.stack ?? ""}`.trim();
  if (typeof part === "string") return part;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

function pruneRecentLogs(now = Date.now()) {
  const cutoff = now - recentLogWindowMs;
  while (recentLogs.length > 0 && new Date(recentLogs[0].at).getTime() < cutoff) recentLogs.shift();
  while (recentLogs.length > maxRecentLogEntries) recentLogs.shift();
}

function appendRecentLog(entry: RecentLogEntry) {
  recentLogs.push(entry);
  pruneRecentLogs(new Date(entry.at).getTime());
}

function captureConsole(level: RecentLogEntry["level"], args: unknown[]) {
  appendRecentLog({
    at: nowIso(),
    level,
    source: "server",
    message: args.map(stringifyLogPart).join(" ")
  });
}

console.log = (...args: unknown[]) => {
  captureConsole("info", args);
  originalConsole.log(...args);
};

console.warn = (...args: unknown[]) => {
  captureConsole("warn", args);
  originalConsole.warn(...args);
};

console.error = (...args: unknown[]) => {
  captureConsole("error", args);
  originalConsole.error(...args);
};

function requireText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}不能为空`);
  return value.trim();
}

function shanghaiDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function sameShanghaiDay(value: string | undefined, dateKey: string) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && shanghaiDateKey(date) === dateKey;
}

function parseJsonArray(value: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

function normalizeCardType(value: unknown): CardType {
  const text = String(value ?? "").trim().toLowerCase();
  if (["word", "单词卡", "单词"].includes(text)) return "word";
  if (["choice", "选择题卡", "选择题", "multiple_choice"].includes(text)) return "choice";
  if (["blank", "填空题卡", "填空题", "cloze"].includes(text)) return "blank";
  return "basic";
}

function hasText(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in row && hasText(row[key])) return row[key];
  }
  return undefined;
}

function hasAnyKey(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => key in row);
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : null;
}

function splitChoiceText(value: string) {
  return value
    .split(/[|\n]+|[；;](?=\s*\S)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChoices(value: unknown, fallback: string[] = []) {
  let raw: unknown[] = fallback;
  if (Array.isArray(value)) raw = value;
  else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      raw = Array.isArray(parsed) ? parsed : fallback;
    } catch {
      raw = fallback;
    }
  } else if (typeof value === "string") {
    raw = splitChoiceText(value);
  }
  return Array.from(new Set(raw.map((item: unknown) => String(item ?? "").trim()).filter(Boolean))).slice(0, 8);
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function optionKey(value: string) {
  const normalized = normalizeAnswer(value);
  const match = normalized.match(/^([a-h])(?:[\s.)、:：-]+|$)/i);
  return match?.[1] ?? normalized;
}

function answersMatch(choice: string, answer: string) {
  return normalizeAnswer(choice) === normalizeAnswer(answer) || optionKey(choice) === optionKey(answer);
}

function dedupeChoiceOptions(choices: string[]) {
  return choices.reduce<string[]>((items, choice) => {
    const existingIndex = items.findIndex((item) => answersMatch(item, choice));
    if (existingIndex === -1) return [...items, choice];
    if (choice.length > items[existingIndex].length) {
      const nextItems = [...items];
      nextItems[existingIndex] = choice;
      return nextItems;
    }
    return items;
  }, []);
}

function addAnswerChoice(choices: string[], answer: string) {
  if (!answer.trim() || choices.some((choice) => answersMatch(choice, answer))) return choices;
  return [...choices, answer.trim()];
}

function importChoiceValues(row: Record<string, unknown>) {
  const optionValues = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return rowValue(row, [`option${number}`, `Option${number}`, `选项${number}`, `选项 ${number}`]);
  });
  const combinedOptions = rowValue(row, ["options", "Options", "选项", "候选项"]);
  return normalizeChoices([
    ...optionValues,
    ...splitChoiceText(String(combinedOptions ?? ""))
  ]);
}

function inferCardType(row: Record<string, unknown>, front: string, choices: string[]): CardType {
  const explicit = rowValue(row, ["card_type", "type", "类型", "卡片类型", "题型"]);
  if (explicit !== undefined) return normalizeCardType(explicit);
  if (choices.length > 0 || hasAnyKey(row, ["option1", "Option1", "选项1", "options", "Options", "选项", "候选项"])) return "choice";
  if (/(\[\s*\]|_{2,}|（\s*）|\(\s*\))/.test(front)) return "blank";
  if (hasAnyKey(row, ["word", "单词", "phonetic", "音标", "meaning", "释义"])) return "word";
  return "basic";
}

function normalizedChoicePayload(cardType: CardType, choices: string[] | string, answer: string) {
  return cardType === "choice" ? addAnswerChoice(dedupeChoiceOptions(normalizeChoices(choices)), answer).slice(0, 8) : [];
}

function clampStudyTextScale(value: unknown) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(1.35, Math.max(0.85, Math.round(scale * 100) / 100));
}

function clampStudyLineHeight(value: unknown) {
  const lineHeight = Number(value);
  if (!Number.isFinite(lineHeight)) return 1.5;
  const options = [1.2, 1.4, 1.5, 1.6, 1.8, 2];
  return options.reduce((closest, option) => Math.abs(option - lineHeight) < Math.abs(closest - lineHeight) ? option : closest, 1.6);
}

function normalizeStudyFontFamily(value: unknown) {
  const fontFamily = String(value ?? "").trim();
  if (!fontFamily) return "system";
  if (fontFamily.length > 80 || /[\u0000-\u001f;]/.test(fontFamily)) return "system";
  return fontFamily;
}

function parseCookies(header: string | undefined) {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.split("=");
        return [decodeURIComponent(name), decodeURIComponent(value.join("="))];
      })
  );
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [scheme, iterationsText, salt, expected] = stored.split(":");
  if (scheme !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterationsText), 32, "sha256");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function createSession(res: express.Response, userId: number) {
  const id = crypto.randomBytes(32).toString("hex");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
  run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [id, userId, expiresAt, createdAt]);
  res.cookie(sessionCookieName, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function clearSession(res: express.Response) {
  res.clearCookie(sessionCookieName, { path: "/" });
}

function userFromRequest(req: express.Request) {
  const sessionId = parseCookies(req.headers.cookie)[sessionCookieName];
  if (!sessionId) return undefined;
  return get<{ id: number; username: string }>(
    `SELECT u.id, u.username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    [sessionId, nowIso()]
  );
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  res.locals.user = user;
  normalizeExistingCards(Number(user.id));
  next();
}

function currentUserId(res: express.Response) {
  return Number((res.locals.user as { id: number }).id);
}

function claimExistingData(userId: number) {
  run("UPDATE decks SET user_id = ? WHERE user_id IS NULL", [userId]);
  run("UPDATE cards SET user_id = ? WHERE user_id IS NULL", [userId]);
  run("UPDATE study_sessions SET user_id = ? WHERE user_id IS NULL", [userId]);
}

function normalizeExistingCards(userId: number) {
  if (normalizedUsers.has(userId)) return;
  normalizedUsers.add(userId);
  const cards = all<{ id: number; card_type: string; front: string; back: string; choices: string; phonetic: string; note: string; updated_at: string }>(
    "SELECT id, card_type, front, back, choices, phonetic, note, updated_at FROM cards WHERE user_id = ?",
    [userId]
  );
  cards.forEach((card) => {
    const currentType = normalizeCardType(card.card_type);
    let nextType: CardType | null = null;
    const parsedChoices = normalizeChoices(card.choices);
    if (currentType !== "choice" && parsedChoices.length > 0) nextType = "choice";
    else if ((currentType === "basic" || currentType === "word") && /(\[\s*\]|_{2,})/.test(String(card.front))) nextType = "blank";
    const finalType = nextType ?? currentType;
    const nextChoices = normalizedChoicePayload(finalType, parsedChoices, String(card.back));
    const shouldUpdateType = nextType !== null && nextType !== currentType;
    const shouldUpdateChoices = finalType === "choice" && JSON.stringify(parsedChoices) !== JSON.stringify(nextChoices);
    if (!shouldUpdateType && !shouldUpdateChoices) return;
    run(
      "UPDATE cards SET card_type = ?, choices = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      [finalType, JSON.stringify(nextChoices), nowIso(), Number(card.id), userId]
    );
  });
}

function getDailyGoal(userId: number) {
  return Math.max(0, Number(getUserSetting(userId, "dailyNewGoal", "20")) || 0);
}

function deckRows(userId: number) {
  type DeckRow = Record<string, SqlValue | number>;
  type DeckTotals = { cards: number; due: number };
  const decks = all<Record<string, SqlValue>>(
    `SELECT d.*,
      COUNT(c.id) AS card_count,
      COALESCE(SUM(CASE WHEN r.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_count,
      (SELECT COUNT(*) FROM decks child WHERE child.parent_id = d.id) AS child_count
     FROM decks d
     LEFT JOIN cards c ON c.deck_id = d.id AND c.user_id = d.user_id
     LEFT JOIN reviews r ON r.card_id = c.id
     WHERE d.user_id = ?
     GROUP BY d.id
     ORDER BY d.updated_at DESC`,
    [nowIso(), userId]
  );
  const childrenByParent = new Map<number | null, Record<string, SqlValue>[]>();
  decks.forEach((deck) => {
    const parentId = deck.parent_id === null ? null : Number(deck.parent_id);
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(deck);
    childrenByParent.set(parentId, siblings);
  });

  const rows: DeckRow[] = [];
  const visit = (deck: Record<string, SqlValue>, depth: number): DeckTotals => {
    const row: DeckRow = { ...deck, depth, total_card_count: Number(deck.card_count ?? 0) };
    rows.push(row);
    const descendants = childrenByParent.get(Number(deck.id)) ?? [];
    const totals = descendants.reduce<DeckTotals>(
      (sum, child) => {
        const childTotals = visit(child, depth + 1);
        return {
          cards: sum.cards + childTotals.cards,
          due: sum.due + childTotals.due
        };
      },
      { cards: Number(deck.card_count ?? 0), due: Number(deck.due_count ?? 0) }
    );
    row.total_card_count = totals.cards;
    row.due_count = totals.due;
    return totals;
  };
  (childrenByParent.get(null) ?? []).forEach((deck) => visit(deck, 1));
  return rows;
}

function getDeckDepth(userId: number, deckId: number | null): number {
  if (!deckId) return 0;
  const deck = get<{ parent_id: number | null }>("SELECT parent_id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
  if (!deck) throw new Error("父级卡组不存在");
  return 1 + getDeckDepth(userId, deck.parent_id === null ? null : Number(deck.parent_id));
}

function descendantDeckIds(userId: number, deckId: number): number[] {
  const deck = get<{ id: number }>("SELECT id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
  if (!deck) return [];
  const children = all<{ id: number }>("SELECT id FROM decks WHERE parent_id = ? AND user_id = ?", [deckId, userId]).map((row) => Number(row.id));
  return [deckId, ...children.flatMap((id) => descendantDeckIds(userId, id))];
}

function reviewRemainingCounts(userId: number, deckId?: number) {
  const deckIds = deckId ? descendantDeckIds(userId, deckId) : [];
  if (deckId && deckIds.length === 0) return { newRemaining: 0, reviewRemaining: 0 };
  const now = nowIso();
  const deckFilter = deckId && deckIds.length ? `AND c.deck_id IN (${deckIds.map(() => "?").join(",")})` : "";
  const params = deckId && deckIds.length ? [userId, now, ...deckIds] : [userId, now];
  const row = get<{ new_remaining: number; review_remaining: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN r.stage = 0 THEN 1 ELSE 0 END), 0) AS new_remaining,
       COALESCE(SUM(CASE WHEN r.stage > 0 THEN 1 ELSE 0 END), 0) AS review_remaining
     FROM cards c
     JOIN reviews r ON r.card_id = c.id
     WHERE c.user_id = ? AND r.due_at <= ? ${deckFilter}`,
    params
  );
  return {
    newRemaining: Number(row?.new_remaining ?? 0),
    reviewRemaining: Number(row?.review_remaining ?? 0)
  };
}

function cardRow(userId: number, cardId: number) {
  return get<Record<string, SqlValue>>(
    `SELECT c.*, d.language, r.stage, r.due_at, r.last_rating, r.known_count, r.fuzzy_count, r.unknown_count
     FROM cards c
     JOIN decks d ON d.id = c.deck_id
     JOIN reviews r ON r.card_id = c.id
     WHERE c.user_id = ? AND c.id = ?`,
    [userId, cardId]
  );
}

function createCard(userId: number, deckId: number, input: CardInput) {
  const deck = get<{ id: number }>("SELECT id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
  if (!deck) throw new Error("卡组不存在");
  const createdAt = nowIso();
  const cardType = normalizeCardType(input.card_type);
  const choices = normalizedChoicePayload(cardType, input.choices ?? [], input.back);
  const front = requireText(input.front, "题目");
  const back = requireText(input.back, "答案");
  run(
    `INSERT INTO cards (user_id, deck_id, card_type, front, back, phonetic, example, mnemonic, note, choices, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      deckId,
      cardType,
      front,
      back,
      input.phonetic?.trim() ?? "",
      input.example?.trim() ?? "",
      input.mnemonic?.trim() ?? "",
      input.note?.trim() ?? "",
      JSON.stringify(normalizeChoices(choices)),
      createdAt,
      createdAt
    ]
  );
  const id = lastTableId("cards");
  run(`INSERT INTO reviews (card_id, stage, due_at, updated_at) VALUES (?, 0, ?, ?)`, [
    id,
    createdAt,
    createdAt
  ]);
  return id;
}

function cardRows(userId: number, where = "", params: SqlValue[] = []) {
  return all(
    `SELECT c.*, r.stage, r.due_at, r.last_rating, r.known_count, r.fuzzy_count, r.unknown_count
     FROM cards c
     JOIN reviews r ON r.card_id = c.id
     WHERE c.user_id = ? ${where}
     ORDER BY r.due_at ASC, c.id DESC`,
    [userId, ...params]
  );
}

function dueReviewIdsForToday(userId: number, now = nowIso()) {
  return all<{ id: number }>(
    `SELECT c.id
     FROM cards c
     JOIN reviews r ON r.card_id = c.id
     WHERE c.user_id = ? AND r.due_at <= ? AND r.stage > 0`,
    [userId, now]
  ).map((row) => Number(row.id));
}

function ensureDailyTask(userId: number) {
  const date = shanghaiDateKey();
  const existing = get<{ date: string }>("SELECT date FROM daily_tasks WHERE user_id = ? AND date = ?", [userId, date]);
  if (!existing) {
    const now = nowIso();
    run(
      `INSERT INTO daily_tasks (user_id, date, daily_new_goal, review_card_ids, new_card_ids, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
      [userId, date, getDailyGoal(userId), JSON.stringify(dueReviewIdsForToday(userId, now)), "[]", now, now]
    );
  }
  return get<{ date: string; daily_new_goal: number; review_card_ids: string; new_card_ids: string; completed_at: string }>(
    "SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?",
    [userId, date]
  )!;
}

function updateDailyNewCard(userId: number, cardId: number, action: "add" | "remove") {
  const task = ensureDailyTask(userId);
  const ids = new Set(parseJsonArray(task.new_card_ids));
  if (action === "add") ids.add(cardId);
  else ids.delete(cardId);
  const now = nowIso();
  run("UPDATE daily_tasks SET new_card_ids = ?, completed_at = '', updated_at = ? WHERE user_id = ? AND date = ?", [
    JSON.stringify([...ids]),
    now,
    userId,
    task.date
  ]);
}

function dailyTaskSummary(userId: number) {
  const task = ensureDailyTask(userId);
  const date = String(task.date);
  const reviewIds = parseJsonArray(task.review_card_ids);
  const newIds = parseJsonArray(task.new_card_ids);
  const reviewRows = reviewIds.length
    ? all<{ card_id: number; updated_at: string }>(
        `SELECT card_id, updated_at FROM reviews WHERE card_id IN (${reviewIds.map(() => "?").join(",")})`,
        reviewIds
      )
    : [];
  const reviewCompleted = reviewRows.filter((row) => sameShanghaiDay(String(row.updated_at), date)).length;
  const newCompleted = newIds.length;
  const completed = Boolean(task.completed_at) || (newCompleted >= Number(task.daily_new_goal) && reviewCompleted >= reviewIds.length);
  if (completed && !task.completed_at) {
    const now = nowIso();
    run("UPDATE daily_tasks SET completed_at = ?, updated_at = ? WHERE user_id = ? AND date = ?", [now, now, userId, date]);
    task.completed_at = now;
  }
  const completedDates = all<{ date: string }>(
    "SELECT date FROM daily_tasks WHERE user_id = ? AND completed_at <> '' ORDER BY date DESC",
    [userId]
  ).map((row) => String(row.date));
  let streak = 0;
  let cursor = new Date(`${shanghaiDateKey()}T00:00:00+08:00`);
  const completedSet = new Set(completedDates);
  while (completedSet.has(shanghaiDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return {
    date,
    daily_new_goal: Number(task.daily_new_goal),
    new_completed: newCompleted,
    review_total: reviewIds.length,
    review_completed: reviewCompleted,
    completed,
    completed_at: String(task.completed_at ?? ""),
    streak
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: nowIso(), version: appVersion });
});

app.get("/api/logs/recent", requireUser, (req, res) => {
  const minutes = Math.min(60, Math.max(1, Number(req.query.minutes ?? 10) || 10));
  const cutoff = Date.now() - minutes * 60 * 1000;
  pruneRecentLogs();
  const lines = recentLogs
    .filter((entry) => new Date(entry.at).getTime() >= cutoff)
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  const filename = `flashcards-recent-${minutes}m-${shanghaiDateKey()}-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.ndjson`;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(lines ? `${lines}\n` : "");
});

app.get("/api/auth/status", (req, res) => {
  const user = userFromRequest(req);
  const hasUsers = Boolean(get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count);
  res.json({
    authenticated: Boolean(user),
    user: user ?? null,
    canRegister: !hasUsers || process.env.ALLOW_REGISTRATION === "true"
  });
});

app.post("/api/auth/register", (req, res) => {
  try {
    const username = requireText(req.body.username, "username");
    const password = requireText(req.body.password, "password");
    if (username.length < 3) throw new Error("用户名至少 3 个字符");
    if (password.length < 8) throw new Error("密码至少 8 个字符");
    const userCount = Number(get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0);
    if (userCount > 0 && process.env.ALLOW_REGISTRATION !== "true") {
      throw new Error("注册已关闭，请联系管理员");
    }
    const createdAt = nowIso();
    run("INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)", [
      username,
      hashPassword(password),
      createdAt,
      createdAt
    ]);
    const userId = lastTableId("users");
    if (userCount === 0) claimExistingData(userId);
    createSession(res, userId);
    res.status(201).json({ user: { id: userId, username } });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "");
  const user = get<{ id: number; username: string; password_hash: string }>("SELECT * FROM users WHERE username = ?", [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "用户名或密码不正确" });
    return;
  }
  createSession(res, Number(user.id));
  res.json({ user: { id: Number(user.id), username: user.username } });
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = parseCookies(req.headers.cookie)[sessionCookieName];
  if (sessionId) run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  clearSession(res);
  res.json({ ok: true });
});

app.use("/api", requireUser);

app.get("/api/templates/:name", (req, res) => {
  const allowed = new Set(["普通卡导入模板.xlsx", "单词卡导入模板.xlsx", "选择题卡导入模板.xlsx", "填空题卡导入模板.xlsx"]);
  const name = path.basename(req.params.name);
  if (!allowed.has(name)) {
    res.status(404).json({ error: "模板不存在" });
    return;
  }
  res.download(path.join(templateDir, name), name);
});

app.get("/api/decks", (_req, res) => {
  res.json(deckRows(currentUserId(res)));
});

app.post("/api/decks", (req, res) => {
  try {
    const userId = currentUserId(res);
    const createdAt = nowIso();
    const parentId = req.body.parentId === undefined || req.body.parentId === null || req.body.parentId === ""
      ? null
      : Number(req.body.parentId);
    const depth = getDeckDepth(userId, parentId) + 1;
    if (depth > maxDeckDepth) throw new Error(`卡组最多支持 ${maxDeckDepth} 层`);
    run(
      `INSERT INTO decks (user_id, parent_id, name, description, language, daily_goal, reminder_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        parentId,
        requireText(req.body.name, "name"),
        req.body.description?.trim() ?? "",
        req.body.language?.trim() ?? "en-US",
        Number(req.body.dailyGoal ?? 20),
        req.body.reminderTime?.trim() ?? "20:00",
        createdAt,
        createdAt
      ]
    );
    res.status(201).json({ id: lastTableId("decks") });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.patch("/api/decks/:id", (req, res) => {
  try {
    const userId = currentUserId(res);
    const deckId = Number(req.params.id);
    const parentId =
      req.body.parentId === undefined
        ? undefined
        : req.body.parentId === null || req.body.parentId === ""
          ? null
          : Number(req.body.parentId);
    if (parentId !== undefined) {
      if (parentId === deckId || descendantDeckIds(userId, deckId).includes(Number(parentId))) {
        throw new Error("卡组不能移动到自己或自己的子卡组内");
      }
      if (getDeckDepth(userId, parentId) + 1 > maxDeckDepth) {
        throw new Error(`卡组最多支持 ${maxDeckDepth} 层`);
      }
    }
    run(
      `UPDATE decks
       SET parent_id = COALESCE(?, parent_id),
           name = COALESCE(?, name),
           description = COALESCE(?, description),
           language = COALESCE(?, language),
           daily_goal = COALESCE(?, daily_goal),
           reminder_time = COALESCE(?, reminder_time),
           updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        parentId === undefined ? null : parentId,
        req.body.name?.trim() || null,
        req.body.description?.trim() ?? null,
        req.body.language?.trim() ?? null,
        req.body.dailyGoal ?? null,
        req.body.reminderTime?.trim() ?? null,
        nowIso(),
        deckId,
        userId
      ]
    );
    if (parentId === null) run("UPDATE decks SET parent_id = NULL WHERE id = ? AND user_id = ?", [deckId, userId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/decks/:id", (req, res) => {
  const userId = currentUserId(res);
  const ids = descendantDeckIds(userId, Number(req.params.id));
  if (ids.length === 0) {
    res.status(404).json({ error: "卡组不存在" });
    return;
  }
  const placeholders = ids.map(() => "?").join(",");
  run(`DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE user_id = ? AND deck_id IN (${placeholders}))`, [userId, ...ids]);
  run(`DELETE FROM cards WHERE user_id = ? AND deck_id IN (${placeholders})`, [userId, ...ids]);
  run(`DELETE FROM decks WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]);
  res.json({ ok: true });
});

app.get("/api/decks/:id/cards", (req, res) => {
  res.json(cardRows(currentUserId(res), "AND c.deck_id = ?", [Number(req.params.id)]));
});

app.post("/api/decks/:id/cards", (req, res) => {
  try {
    res.status(201).json({ id: createCard(currentUserId(res), Number(req.params.id), req.body) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.patch("/api/cards/:id", (req, res) => {
  const userId = currentUserId(res);
  const cardId = Number(req.params.id);
  const current = cardRow(userId, cardId);
  if (!current) {
    res.status(404).json({ error: "卡片不存在" });
    return;
  }
  const baseUpdatedAt = typeof req.body.baseUpdatedAt === "string" ? req.body.baseUpdatedAt : "";
  if (!req.body.force && baseUpdatedAt && new Date(baseUpdatedAt).getTime() < new Date(String(current.updated_at)).getTime()) {
    res.status(409).json({ error: "这张卡片已在其他设备更新", serverCard: current });
    return;
  }
  const cardType = req.body.card_type === undefined ? null : normalizeCardType(req.body.card_type);
  const effectiveType = cardType ?? normalizeCardType(current.card_type);
  const effectiveBack = typeof req.body.back === "string" && req.body.back.trim() ? req.body.back.trim() : String(current.back ?? "");
  const nextChoices = req.body.choices === undefined && req.body.card_type === undefined && req.body.back === undefined
    ? null
    : JSON.stringify(normalizedChoicePayload(effectiveType, req.body.choices ?? String(current.choices ?? ""), effectiveBack));
  run(
    `UPDATE cards
     SET card_type = COALESCE(?, card_type),
         front = COALESCE(?, front),
         back = COALESCE(?, back),
         phonetic = COALESCE(?, phonetic),
         example = COALESCE(?, example),
         mnemonic = COALESCE(?, mnemonic),
         note = COALESCE(?, note),
         choices = COALESCE(?, choices),
         favorite = COALESCE(?, favorite),
         updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      cardType,
      req.body.front?.trim() || null,
      req.body.back?.trim() || null,
      "phonetic" in req.body ? optionalText(req.body.phonetic) : null,
      "example" in req.body ? optionalText(req.body.example) : null,
      "mnemonic" in req.body ? optionalText(req.body.mnemonic) : null,
      "note" in req.body ? optionalText(req.body.note) : null,
      nextChoices,
      typeof req.body.favorite === "boolean" || typeof req.body.favorite === "number"
        ? Number(req.body.favorite)
        : null,
      nowIso(),
      cardId,
      userId
    ]
  );
  res.json({ ok: true, card: cardRow(userId, cardId) });
});

app.delete("/api/cards/:id", (req, res) => {
  const userId = currentUserId(res);
  run("DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE id = ? AND user_id = ?)", [Number(req.params.id), userId]);
  run("DELETE FROM cards WHERE id = ? AND user_id = ?", [Number(req.params.id), userId]);
  res.json({ ok: true });
});

app.post("/api/cards/batch", (req, res) => {
  try {
    const userId = currentUserId(res);
    const cardIds: number[] = Array.isArray(req.body.cardIds)
      ? Array.from(new Set(req.body.cardIds.map(Number).filter((id: number) => Number.isFinite(id))))
      : [];
    const action = String(req.body.action ?? "");
    if (cardIds.length === 0) throw new Error("请选择卡片");
    const placeholders = cardIds.map(() => "?").join(",");
    const ownedCards = all<{ id: number }>(
      `SELECT id FROM cards WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...cardIds]
    ).map((row) => Number(row.id));
    if (ownedCards.length === 0) throw new Error("没有可操作的卡片");
    const ownedPlaceholders = ownedCards.map(() => "?").join(",");

    if (action === "delete") {
      run(`DELETE FROM reviews WHERE card_id IN (${ownedPlaceholders})`, ownedCards);
      run(`DELETE FROM cards WHERE user_id = ? AND id IN (${ownedPlaceholders})`, [userId, ...ownedCards]);
      res.json({ ok: true, affected: ownedCards.length });
      return;
    }

    if (action === "move") {
      const deckId = Number(req.body.deckId);
      const deck = get<{ id: number }>("SELECT id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
      if (!deck) throw new Error("目标卡组不存在");
      run(
        `UPDATE cards SET deck_id = ?, updated_at = ? WHERE user_id = ? AND id IN (${ownedPlaceholders})`,
        [deckId, nowIso(), userId, ...ownedCards]
      );
      res.json({ ok: true, affected: ownedCards.length });
      return;
    }

    throw new Error("未知批量操作");
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

function normalizeImportRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const values = Object.values(row).map((value) => String(value ?? "").trim());
      const choices = importChoiceValues(row);
      const front = String(rowValue(row, ["front", "question", "word", "题目", "正面", "单词"]) ?? values[0] ?? "").trim();
      const back = String(rowValue(row, ["back", "answer", "meaning", "答案", "背面", "释义"]) ?? values[1] ?? "").trim();
      const cardType = inferCardType(row, front, choices);
      const positionalExample = cardType === "choice" ? "" : values[2];
      return {
        card_type: cardType,
        front,
        back,
        phonetic: String(rowValue(row, ["phonetic", "音标"]) ?? "").trim(),
        example: String(rowValue(row, ["example", "解析", "例句", "说明"]) ?? positionalExample ?? "").trim(),
        mnemonic: String(rowValue(row, ["mnemonic", "助记"]) ?? "").trim(),
        note: String(rowValue(row, ["note", "备注", "注记"]) ?? "").trim(),
        choices: normalizedChoicePayload(cardType, choices, back)
      };
    })
    .filter((row) => row.front && row.back);
}

app.post("/api/import", upload.single("file"), (req, res) => {
  try {
    const userId = currentUserId(res);
    const deckId = Number(req.body.deckId);
    const deck = get<{ id: number }>("SELECT id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
    if (!deck) throw new Error("卡组不存在");
    const text = req.body.text as string | undefined;
    let rows: Record<string, unknown>[] = [];

    if (req.file) {
      if (req.file.originalname.endsWith(".xlsx") || req.file.originalname.endsWith(".xls")) {
        const workbook = XLSX.read(req.file.buffer);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      } else {
        rows = parse(req.file.buffer, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_column_count: true
        });
      }
    } else if (text) {
      rows = parse(text, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        delimiter: text.includes("\t") ? "\t" : ",",
        relax_column_count: true
      });
    }

    const cards = normalizeImportRows(rows);
    cards.forEach((card) => createCard(userId, deckId, card));
    res.json({ imported: cards.length, skipped: rows.length - cards.length });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/reviews/due", (req, res) => {
  const userId = currentUserId(res);
  const deckId = req.query.deckId ? Number(req.query.deckId) : undefined;
  const limit = Number(req.query.limit ?? 50);
  const kind = String(req.query.kind ?? "all");
  const now = nowIso();
  const deckIds = deckId ? descendantDeckIds(userId, deckId) : [];
  if (deckId && deckIds.length === 0) {
    res.json([]);
    return;
  }
  const stageFilter = kind === "review" ? "AND r.stage > 0" : kind === "new" ? "AND r.stage = 0" : "";
  const where = deckId && deckIds.length
    ? `WHERE c.user_id = ? AND c.deck_id IN (${deckIds.map(() => "?").join(",")}) AND r.due_at <= ? ${stageFilter}`
    : `WHERE c.user_id = ? AND r.due_at <= ? ${stageFilter}`;
  const params = deckId && deckIds.length ? [userId, ...deckIds, now, limit] : [userId, now, limit];
  const cards = all(
    `SELECT c.*, d.language, r.stage, r.due_at, r.last_rating, r.known_count, r.fuzzy_count, r.unknown_count
     FROM cards c
     JOIN decks d ON d.id = c.deck_id
     JOIN reviews r ON r.card_id = c.id
     ${where}
     ORDER BY r.due_at ASC
     LIMIT ?`,
    params
  );
  res.json(cards);
});

app.get("/api/reviews/remaining", (req, res) => {
  const userId = currentUserId(res);
  const deckId = req.query.deckId ? Number(req.query.deckId) : undefined;
  res.json(reviewRemainingCounts(userId, deckId));
});

app.post("/api/reviews/:cardId/answer", (req, res) => {
  const userId = currentUserId(res);
  const rating = req.body.rating as ReviewRating;
  if (!["known", "fuzzy", "unknown"].includes(rating)) {
    res.status(400).json({ error: "请选择认识、模糊或不认识" });
    return;
  }

  const current = get<{ stage: number; due_at: string; last_rating: string; known_count: number; fuzzy_count: number; unknown_count: number; updated_at: string }>(
    `SELECT r.stage, r.due_at, r.last_rating, r.known_count, r.fuzzy_count, r.unknown_count, r.updated_at
     FROM reviews r
     JOIN cards c ON c.id = r.card_id
     WHERE r.card_id = ? AND c.user_id = ?`,
    [Number(req.params.cardId), userId]
  );
  if (!current) {
    res.status(404).json({ error: "复习记录不存在" });
    return;
  }

  const next = nextReviewState(Number(current.stage), rating);
  const cardId = Number(req.params.cardId);
  if (Number(current.stage) === 0) updateDailyNewCard(userId, cardId, "add");
  run(
    `UPDATE reviews
     SET stage = ?,
         due_at = ?,
         last_rating = ?,
         known_count = known_count + ?,
         fuzzy_count = fuzzy_count + ?,
         unknown_count = unknown_count + ?,
         updated_at = ?
     WHERE card_id IN (SELECT id FROM cards WHERE id = ? AND user_id = ?)`,
    [
      next.stage,
      next.dueAt,
      rating,
      rating === "known" ? 1 : 0,
      rating === "fuzzy" ? 1 : 0,
      rating === "unknown" ? 1 : 0,
      nowIso(),
      cardId,
      userId
    ]
  );

  dailyTaskSummary(userId);
  res.json({ ...next, previous: current });
});

app.post("/api/reviews/:cardId/restore", (req, res) => {
  const userId = currentUserId(res);
  const cardId = Number(req.params.cardId);
  const card = get<{ id: number }>("SELECT id FROM cards WHERE id = ? AND user_id = ?", [cardId, userId]);
  if (!card) {
    res.status(404).json({ error: "复习记录不存在" });
    return;
  }
  if (Math.max(0, Number(req.body.stage ?? 0)) === 0) updateDailyNewCard(userId, cardId, "remove");
  run(
    `UPDATE reviews
     SET stage = ?,
         due_at = ?,
         last_rating = ?,
         known_count = ?,
         fuzzy_count = ?,
         unknown_count = ?,
         updated_at = ?
     WHERE card_id = ?`,
    [
      Math.max(0, Number(req.body.stage ?? 0)),
      String(req.body.due_at ?? nowIso()),
      String(req.body.last_rating ?? ""),
      Math.max(0, Number(req.body.known_count ?? 0)),
      Math.max(0, Number(req.body.fuzzy_count ?? 0)),
      Math.max(0, Number(req.body.unknown_count ?? 0)),
      String(req.body.updated_at ?? nowIso()),
      cardId
    ]
  );
  dailyTaskSummary(userId);
  res.json({ ok: true });
});

app.get("/api/daily-task", (_req, res) => {
  res.json(dailyTaskSummary(currentUserId(res)));
});

app.put("/api/daily-task/settings", (req, res) => {
  const userId = currentUserId(res);
  const goal = Math.max(0, Math.floor(Number(req.body.dailyNewGoal ?? 0)));
  setUserSetting(userId, "dailyNewGoal", String(goal));
  const task = ensureDailyTask(userId);
  const now = nowIso();
  run("UPDATE daily_tasks SET daily_new_goal = ?, updated_at = ? WHERE user_id = ? AND date = ?", [
    goal,
    now,
    userId,
    task.date
  ]);
  dailyTaskSummary(userId);
  res.json({ ok: true });
});

app.get("/api/sync/status", (_req, res) => {
  const userId = currentUserId(res);
  const rows = all<{ updated_at: string }>(
    `SELECT updated_at FROM decks WHERE user_id = ?
     UNION ALL SELECT updated_at FROM cards WHERE user_id = ?
     UNION ALL SELECT r.updated_at FROM reviews r JOIN cards c ON c.id = r.card_id WHERE c.user_id = ?
     UNION ALL SELECT updated_at FROM daily_tasks WHERE user_id = ?`,
    [userId, userId, userId, userId]
  );
  const dataUpdatedAt = rows
    .map((row) => String(row.updated_at))
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
  res.json({ serverTime: nowIso(), lastSyncAt: nowIso(), dataUpdatedAt });
});

app.get("/api/stats", (_req, res) => {
  const row = get("SELECT COUNT(c.id) AS total_cards, COALESCE(SUM(CASE WHEN r.stage >= 10 THEN 1 ELSE 0 END), 0) AS mastered_cards, COALESCE(SUM(CASE WHEN r.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_cards FROM cards c JOIN reviews r ON r.card_id = c.id WHERE c.user_id = ?", [
    nowIso(),
    currentUserId(res)
  ]);
  res.json(row ?? { total_cards: 0, mastered_cards: 0, due_cards: 0 });
});

app.get("/api/settings", (_req, res) => {
  const userId = currentUserId(res);
  res.json({
    theme: getUserSetting(userId, "theme", "system"),
    voiceLanguage: getUserSetting(userId, "voiceLanguage", "en-US"),
    notifications: getUserSetting(userId, "notifications", "off"),
    autoSpeak: getUserSetting(userId, "autoSpeak", "off"),
    dailyNewGoal: getDailyGoal(userId),
    studyTextScale: clampStudyTextScale(getUserSetting(userId, "studyTextScale", "1")),
    studyTextAlign: getUserSetting(userId, "studyTextAlign", "center") === "left" ? "left" : "center",
    studyChoiceLayout: ["one", "two"].includes(getUserSetting(userId, "studyChoiceLayout", "auto")) ? getUserSetting(userId, "studyChoiceLayout", "auto") : "auto",
    studyLineHeight: clampStudyLineHeight(getUserSetting(userId, "studyLineHeight", "1.5")),
    studyFontFamily: normalizeStudyFontFamily(getUserSetting(userId, "studyFontFamily", "system"))
  });
});

app.put("/api/settings", (req, res) => {
  const userId = currentUserId(res);
  for (const key of ["theme", "voiceLanguage", "notifications", "autoSpeak", "dailyNewGoal", "studyTextScale", "studyTextAlign", "studyChoiceLayout", "studyLineHeight", "studyFontFamily"]) {
    if (key === "studyTextScale" && (typeof req.body[key] === "string" || typeof req.body[key] === "number")) {
      setUserSetting(userId, key, String(clampStudyTextScale(req.body[key])));
      continue;
    }
    if (key === "studyLineHeight" && (typeof req.body[key] === "string" || typeof req.body[key] === "number")) {
      setUserSetting(userId, key, String(clampStudyLineHeight(req.body[key])));
      continue;
    }
    if (key === "studyTextAlign" && (req.body[key] === "left" || req.body[key] === "center")) {
      setUserSetting(userId, key, req.body[key]);
      continue;
    }
    if (key === "studyChoiceLayout" && ["auto", "one", "two"].includes(req.body[key])) {
      setUserSetting(userId, key, req.body[key]);
      continue;
    }
    if (key === "studyFontFamily" && typeof req.body[key] === "string") {
      setUserSetting(userId, key, req.body[key]);
      continue;
    }
    if (typeof req.body[key] === "string") setUserSetting(userId, key, req.body[key]);
    if (key === "dailyNewGoal" && typeof req.body[key] === "number") setUserSetting(userId, key, String(req.body[key]));
  }
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

initDb().then(() => {
  app.listen(port, host, () => {
    console.log(`Flashcards API listening on http://${host}:${port}`);
  });
});
