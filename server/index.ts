import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { SqlValue } from "sql.js";
import { all, get, getUserSetting, initDb, lastTableId, nowIso, run, setUserSetting } from "./db.js";
import { isSuperuserUsername, publicAuthUser, type AuthUser } from "./auth.js";
import { cardImagePath, cardImageTypeFromFilename, maxCardImageBytes, storeCardImage } from "./card-images.js";
import { nextReviewState, type ReviewRating } from "./ebbinghaus.js";
import { normalizeImportRows } from "./import-utils.js";
import { buildDoubaoRequestBody, buildWordPronunciation, doubaoTtsEndpoint, doubaoTtsPrompt, doubaoTtsResourceId, doubaoTtsVoice, maxDoubaoPromptLength, maxDoubaoSsmlLength, normalizeCustomSsml, normalizeDoubaoPrompt, parseDoubaoAudioChunks } from "./doubao-tts.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const cardImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxCardImageBytes, files: 1 } });
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../dist");
const templateDir = path.resolve(process.cwd(), "模版");
const cardImagesDir = process.env.CARD_IMAGES_DIR ?? path.resolve(process.cwd(), "data/card-images");

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
  choices?: string[] | string | BlankAnswerConfig;
  baseUpdatedAt?: string;
  force?: boolean;
};

type CardType = "basic" | "word" | "choice" | "blank";
type BlankAnswerConfig = { version: 1; orderless: boolean; answers: string[][] };

const maxDeckDepth = 5;
const sessionCookieName = "flashcards_session";
const sessionDays = 30;
const appVersion = "0.6.7";
const timeZone = "Asia/Shanghai";
const pronunciationCacheDir = process.env.PRONUNCIATION_CACHE_DIR ?? path.resolve(process.cwd(), "runtime/pronunciations");
const doubaoTtsApiKey = process.env.DOUBAO_TTS_API_KEY ?? "";
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

function shanghaiWeekId(value = new Date()) {
  const [year, month, day] = shanghaiDateKey(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-${String(week).padStart(2, "0")}`;
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

const blankMarkerPattern = /(\[\s*\]|_{2,}|（\s*）|\(\s*\))/g;

function effectiveBlankCount(front: string) {
  return Math.max(1, Array.from(front.matchAll(blankMarkerPattern)).length);
}

function normalizeBlankAnswerGroup(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => {
      const normalized = normalizeAnswer(item);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 8);
}

function normalizeBlankAnswerConfig(value: unknown): BlankAnswerConfig | null {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const candidate = source as Partial<BlankAnswerConfig>;
  if (candidate.version !== 1 || !Array.isArray(candidate.answers)) return null;
  const answers = candidate.answers.map(normalizeBlankAnswerGroup);
  if (answers.length === 0 || answers.some((group) => group.length === 0)) return null;
  return { version: 1, orderless: Boolean(candidate.orderless) && answers.length > 1, answers };
}

function splitLegacyBlankAnswers(value: string) {
  return value
    .split(/[\n|/／、，,；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLegacyBlankAlternatives(value: string) {
  return value
    .split(/\s*(?:或者|或|\bor\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function legacyBlankConfig(front: string, back: string): BlankAnswerConfig | [] {
  const count = effectiveBlankCount(front);
  if (count === 1) {
    const answers = splitLegacyBlankAlternatives(back);
    return answers.length ? { version: 1, orderless: false, answers: [answers] } : [];
  }
  const parts = splitLegacyBlankAnswers(back);
  if (parts.length !== count) return [];
  const frontParts = front.split(blankMarkerPattern);
  const separators = Array.from({ length: count - 1 }, (_, index) => frontParts[index * 2 + 2] ?? "");
  const connectorMatches = separators.map((separator) => /[和与及、，,；;\/／]/.test(separator));
  if (connectorMatches.some(Boolean) && !connectorMatches.every(Boolean)) return [];
  return {
    version: 1,
    orderless: connectorMatches.length > 0 && connectorMatches.every(Boolean),
    answers: parts.map((part) => {
      const alternatives = splitLegacyBlankAlternatives(part);
      return alternatives.length ? alternatives : [part];
    })
  };
}

function normalizedCardOptionsPayload(cardType: CardType, choices: unknown, back: string, front: string) {
  if (cardType === "choice") return normalizedChoicePayload(cardType, choices as string[] | string, back);
  if (cardType !== "blank") return [];
  const config = normalizeBlankAnswerConfig(choices);
  if (!config) return legacyBlankConfig(front, back);
  const count = effectiveBlankCount(front);
  if (config.answers.length !== count) throw new Error(`题干有 ${count} 个空，但提供了 ${config.answers.length} 组答案`);
  return { ...config, orderless: config.orderless && count > 1 };
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

function normalizeVoiceLanguage(value: unknown) {
  const text = String(value ?? "").trim();
  if (text.toLowerCase().startsWith("en")) return "en-GB";
  return text || "en-GB";
}

function isEnglishVoiceLanguage(language: unknown) {
  return normalizeVoiceLanguage(language).toLowerCase().startsWith("en");
}

function normalizePronunciationText(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/^[/\[]+|[/\]]+$/g, "")
    .replace(/\s+/g, "");
  if (!text || text.length > 160 || /[\u0000-\u001f<>&"]/.test(text)) return null;
  return text;
}

function normalizePronunciationFallback(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
  if (!text || text.length > 120 || /[\u0000-\u001f<>&"]/.test(text)) return "pronunciation";
  return text;
}

function cacheKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

type PronunciationXmlOverride = {
  cache_key: string;
  word: string;
  phoneme: string;
  ssml: string;
  prompt?: string;
  updated_by: number;
  updated_at: string;
};

function pronunciationOverrideKey(phoneme: string, fallback: string) {
  return cacheKey(`${phoneme}\n${fallback}`);
}

function pronunciationXmlOverride(phoneme: string, fallback: string) {
  return get<PronunciationXmlOverride>("SELECT * FROM pronunciation_ssml_overrides WHERE cache_key = ?", [pronunciationOverrideKey(phoneme, fallback)]);
}

function setPronunciationXmlOverride(userId: number, phoneme: string, fallback: string, ssml: string, prompt: string) {
  run(
    `INSERT INTO pronunciation_ssml_overrides (cache_key, word, phoneme, ssml, prompt, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET word = excluded.word, phoneme = excluded.phoneme, ssml = excluded.ssml, prompt = excluded.prompt, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [pronunciationOverrideKey(phoneme, fallback), fallback, phoneme, ssml, prompt, userId, nowIso()]
  );
}

function restorePronunciationXmlOverride(previous: PronunciationXmlOverride | undefined, phoneme: string, fallback: string) {
  if (!previous) {
    run("DELETE FROM pronunciation_ssml_overrides WHERE cache_key = ?", [pronunciationOverrideKey(phoneme, fallback)]);
    return;
  }
  run(
    `INSERT INTO pronunciation_ssml_overrides (cache_key, word, phoneme, ssml, prompt, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET word = excluded.word, phoneme = excluded.phoneme, ssml = excluded.ssml, prompt = excluded.prompt, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [previous.cache_key, previous.word, previous.phoneme, previous.ssml, previous.prompt ?? "", previous.updated_by, previous.updated_at]
  );
}

function doubaoTtsCacheName(phoneme: string, fallback: string, prompt = doubaoTtsPrompt) {
  return `doubao-${doubaoTtsResourceId}-${doubaoTtsVoice}-${cacheKey(`${phoneme}\n${fallback}\n${prompt}\ncmudict-ipa-match-v5-non-rhotic`)}.mp3`;
}

async function cachedDoubaoTtsPath(phoneme: string, fallback: string, prompt = doubaoTtsPrompt) {
  await fs.promises.mkdir(pronunciationCacheDir, { recursive: true });
  const filePath = path.join(pronunciationCacheDir, doubaoTtsCacheName(phoneme, fallback, prompt));
  return fs.existsSync(filePath) ? filePath : null;
}

async function writeDoubaoTtsCache(phoneme: string, fallback: string, audio: Buffer, prompt = doubaoTtsPrompt) {
  await fs.promises.mkdir(pronunciationCacheDir, { recursive: true });
  const filePath = path.join(pronunciationCacheDir, doubaoTtsCacheName(phoneme, fallback, prompt));
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(tempPath, audio);
  await fs.promises.rename(tempPath, filePath);
  return filePath;
}

async function synthesizeWithDoubao(phoneme: string, fallback: string, ssmlOverride?: string, promptOverride?: string) {
  if (!doubaoTtsApiKey) throw new Error("缺少 DOUBAO_TTS_API_KEY");
  const pronunciation = buildWordPronunciation(fallback, phoneme || undefined);
  const ssml = ssmlOverride ?? pronunciation.ssml;
  console.info("Pronunciation selected", {
    word: pronunciation.word,
    ipa: pronunciation.normalizedIpa,
    selectedCmu: pronunciation.selectedCmu,
    finalCmu: pronunciation.cmu,
    rhoticConflict: pronunciation.rhoticConflict,
    finalSource: pronunciation.source,
    confidence: pronunciation.confidence,
    finalSsmlMode: ssmlOverride ? "custom" : pronunciation.finalSsmlMode
  });
  if (ssml.length > maxDoubaoSsmlLength) throw new Error(`单词及音标生成的 SSML 超过 ${maxDoubaoSsmlLength} 个字符`);
  const response = await fetch(doubaoTtsEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": doubaoTtsApiKey,
      "X-Api-Resource-Id": doubaoTtsResourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Control-Require-Usage-Tokens-Return": "*"
    },
    body: JSON.stringify(buildDoubaoRequestBody(fallback, ssml, promptOverride ?? doubaoTtsPrompt))
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`豆包语音合成失败：${response.status}${body ? ` ${body.slice(0, 300)}` : ""}`);
  }
  return parseDoubaoAudioChunks(await response.text());
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
  return get<AuthUser>(
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

function requireSuperuser(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = res.locals.user as AuthUser;
  if (!isSuperuserUsername(user?.username)) {
    res.status(403).json({ error: "仅超级用户可以修改豆包语音设置" });
    return;
  }
  next();
}

function currentUserId(res: express.Response) {
  return Number((res.locals.user as { id: number }).id);
}

type GameState = {
  version: number;
  initializedAt: string;
  updatedAt: string;
  profile: {
    farmName: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
    title: string;
  };
  wallet: {
    sunCoins: number;
    focusCrystals: number;
    stardust: number;
  };
  farm: {
    unlockedPlots: number;
    greenhouseLevel: number;
    warehouseLevel: number;
    decorationScore: number;
  };
  inventory: {
    seeds: Array<{ seedId: string; name: string; rarity: string; count: number }>;
    tomatoes: Array<{ tomatoId: string; name: string; rarity: string; count: number }>;
    decorations: unknown[];
    tools: unknown[];
    partners?: unknown[];
  };
  collection: {
    unlockedTomatoes: unknown[];
    unlockedDecorations: unknown[];
    unlockedPartners: unknown[];
    unlockedTitles: unknown[];
    unlockedTools: unknown[];
    unlockedSeeds: unknown[];
    seenItemIds: string[];
  };
  showcase: ShowcaseState;
  taskBoard: TaskBoardState;
  operationStats: OperationStatsState;
  planning: PlanningState;
  planningTemplates: PlanningTemplatesState;
  planting: {
    plots: PlantingPlot[];
  };
  dailyOrders: {
    lastRefreshDate: string;
    orders: DailyOrder[];
    completedOrderIds: string[];
  };
  supply: {
    pity: Record<string, SupplyPity>;
    history: SupplyHistoryEntry[];
  };
  events: Array<{
    eventId: string;
    type: string;
    message: string;
    createdAt: string;
    source: string;
    recordId?: string;
    orderId?: string;
    crateId?: string;
    itemId?: string;
    slotId?: string;
    taskId?: string;
    results?: SupplyResult[];
    reward?: HarvestReward | DailyOrderReward;
    consumed?: DailyOrderConsumed;
  }>;
  idempotency: {
    eventIds: string[];
    claimedPomodoroRecordIds: string[];
    completedDailyOrderIds: string[];
    supplyOpenIds: string[];
  };
};

type TomatoRecord = Record<string, unknown>;

type PlantingPlot = {
  plotId: string;
  status: "empty" | "growing" | "ready";
  seedId: string | null;
  seedName: string | null;
  plantedAt: string | null;
  readyAt: string | null;
  harvestedAt: string | null;
};

type HarvestReward = {
  sunCoins: number;
  farmXp: number;
  focusCrystals: number;
  tomatoUnits: number;
};

type DailyOrderReward = {
  sunCoins: number;
  farmXp: number;
  focusCrystals: number;
  basicTomatoSeeds: number;
};

type DailyOrderConsumed = {
  basicFarmTomatoes: number;
};

type DailyOrder = {
  orderId: string;
  type: "daily_basic";
  date: string;
  title: string;
  description: string;
  status: "available" | "completed";
  completedAt: string | null;
  requirements: {
    effectiveTomatoesRequired: number;
    effectiveTomatoesCurrent: number;
    basicFarmTomatoesRequired: number;
  };
  reward: DailyOrderReward;
};

type Rarity = "N" | "R" | "SR" | "SSR" | "UR";

type SupplyPity = {
  totalOpens: number;
  sinceLastSR: number;
  sinceLastSSR: number;
};

type SupplyResult = {
  itemId: string;
  name: string;
  type: "seed" | "tomato" | "sunCoins" | "farmXp" | "decoration" | "tool" | "partner" | "title";
  rarity: Rarity;
  quantity: number;
  isNew: boolean;
  pityTriggered: boolean;
};

type SupplyHistoryEntry = {
  supplyId: string;
  crateId: string;
  crateName: string;
  cost: {
    focusCrystals: number;
  };
  results: SupplyResult[];
  createdAt: string;
};

type SupplyItem = {
  itemId: string;
  name: string;
  type: SupplyResult["type"];
  rarity: Rarity;
  quantity: number;
  targetId?: string;
};

type CollectionType = "seed" | "tomato" | "decoration" | "tool" | "partner" | "title";

type CatalogItem = {
  itemId: string;
  name: string;
  type: CollectionType;
  rarity: Rarity;
  description: string;
  source: string;
};

type ShowcaseSlotId = "signboard" | "field" | "greenhouse" | "warehouse" | "path" | "background";

type ShowcaseState = {
  titleId: string | null;
  partnerId: string | null;
  decorationSlots: Record<ShowcaseSlotId, string | null>;
  updatedAt: string | null;
};

type TaskBoardTask = {
  taskId: string;
  type: string;
  scope: "daily" | "weekly";
  title: string;
  description: string;
  status: "available" | "completed" | "claimed";
  progress: {
    current: number;
    required: number;
    unit: string;
  };
  reward: DailyOrderReward;
  claimedAt: string | null;
};

type TaskBoardState = {
  daily: {
    date: string;
    tasks: TaskBoardTask[];
  };
  weekly: {
    weekId: string;
    tasks: TaskBoardTask[];
  };
  claimedTaskIds: string[];
  updatedAt: string | null;
};

type OperationTaskHistoryEntry = {
  id: string;
  taskId: string;
  title: string;
  type: "daily" | "weekly";
  claimedAt: string;
  rewardSummary: string;
};

type OperationStatsState = {
  streak: {
    currentDays: number;
    bestDays: number;
    lastActiveDate: string | null;
  };
  weeklySummary: {
    weekId: string;
    completedTomatoes: number;
    submittedOrders: number;
    openedCrates: number;
    plantedCount: number;
    claimedTasks: number;
    updatedAt: string | null;
  };
  taskHistory: OperationTaskHistoryEntry[];
};

type DailyPlanningState = {
  date: string;
  tomatoTarget: number;
  orderTarget: number;
  plantingTarget: number;
  harvestTarget: number;
  note: string;
  updatedAt: string | null;
};

type WeeklyPlanningState = {
  weekId: string;
  tomatoTarget: number;
  orderTarget: number;
  plantingTarget: number;
  harvestTarget: number;
  note: string;
  updatedAt: string | null;
};

type PlanningState = {
  daily: DailyPlanningState;
  weekly: WeeklyPlanningState;
};

type PlanningTemplateScope = "daily" | "weekly";

type PlanningTemplate = {
  id: string;
  name: string;
  tomatoTarget: number;
  orderTarget: number;
  plantingTarget: number;
  harvestTarget: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

type PlanningTemplatesState = {
  daily: PlanningTemplate[];
  weekly: PlanningTemplate[];
};

type DailyTaskMetrics = {
  todayEffective: number;
  dailyOrderCompleted: number;
  plantedToday: number;
  harvestedToday: number;
  supplyToday: number;
  checkedInToday: number;
};

type DailyTaskTemplate = {
  key: string;
  type: string;
  title: string;
  description: string;
  required: number;
  unit: string;
  reward: DailyOrderReward;
  current: (metrics: DailyTaskMetrics) => number;
};

const gameStateKey = "game.state.v1";
const basicTomatoGrowSeconds = 60;
const maxPlanningTemplatesPerScope = 10;
const maxPlanningTemplateNameLength = 24;
const maxPlanningTomatoTarget = 500;
const maxPlanningCycleTarget = 100;
const taskBoardDailyTaskTypes = ["daily_focus", "daily_order", "daily_plant"] as const;
const taskBoardWeeklyTaskTypes = ["weekly_focus", "weekly_orders", "weekly_supply"] as const;
const showcaseSlotLabels: Record<ShowcaseSlotId, string> = {
  signboard: "招牌位",
  field: "田地区",
  greenhouse: "温室区",
  warehouse: "仓库区",
  path: "小路区",
  background: "背景区"
};
const showcaseSlotIds = Object.keys(showcaseSlotLabels) as ShowcaseSlotId[];
const defaultShowcaseSlots: Record<ShowcaseSlotId, null> = {
  signboard: null,
  field: null,
  greenhouse: null,
  warehouse: null,
  path: null,
  background: null
};
const defaultSeed = {
  seedId: "basic_tomato_seed",
  name: "普通番茄种子",
  rarity: "N",
  count: 0
};
const defaultHarvestTomato = {
  tomatoId: "basic_harvest_tomato",
  name: "基础收获番茄",
  rarity: "N",
  count: 0
};
const defaultFarmTomato = {
  tomatoId: "basic_farm_tomato",
  name: "基础经营番茄",
  rarity: "N",
  count: 0
};
const dailyBasicReward: DailyOrderReward = {
  sunCoins: 30,
  farmXp: 40,
  focusCrystals: 1,
  basicTomatoSeeds: 1
};
const dailyBasicConsumed: DailyOrderConsumed = {
  basicFarmTomatoes: 1
};
const basicSeedCrate = {
  crateId: "basic_seed_crate",
  name: "普通种子补给箱",
  description: "装着基础种子、农场小物件和少量稀有种子的补给箱。",
  cost: {
    focusCrystals: 5
  },
  probabilities: {
    N: 0.6,
    R: 0.28,
    SR: 0.1,
    SSR: 0.018,
    UR: 0.002
  } as Record<Rarity, number>,
  pity: {
    srWithin: 10,
    ssrWithin: 50
  }
};
const supplyRarityRank: Record<Rarity, number> = {
  N: 1,
  R: 2,
  SR: 3,
  SSR: 4,
  UR: 5
};
const supplyPool: SupplyItem[] = [
  { itemId: "basic_tomato_seed_x1", name: "普通番茄种子", type: "seed", targetId: "basic_tomato_seed", rarity: "N", quantity: 1 },
  { itemId: "basic_tomato_seed_x2", name: "普通番茄种子", type: "seed", targetId: "basic_tomato_seed", rarity: "N", quantity: 2 },
  { itemId: "basic_harvest_tomato_x1", name: "基础收获番茄", type: "tomato", targetId: "basic_harvest_tomato", rarity: "N", quantity: 1 },
  { itemId: "sun_coins_x10", name: "阳光币", type: "sunCoins", rarity: "N", quantity: 10 },
  { itemId: "farm_xp_x10", name: "农场经验", type: "farmXp", rarity: "N", quantity: 10 },
  { itemId: "wooden_sign_decoration", name: "小木牌装饰", type: "decoration", targetId: "wooden_sign_decoration", rarity: "N", quantity: 1 },
  { itemId: "old_barrel_decoration", name: "旧木桶装饰", type: "decoration", targetId: "old_barrel_decoration", rarity: "N", quantity: 1 },
  { itemId: "pebble_path_decoration", name: "小石子路装饰", type: "decoration", targetId: "pebble_path_decoration", rarity: "N", quantity: 1 },
  { itemId: "basic_tomato_seed_x5", name: "普通番茄种子", type: "seed", targetId: "basic_tomato_seed", rarity: "R", quantity: 5 },
  { itemId: "cherry_tomato_seed_x1", name: "樱桃番茄种子", type: "seed", targetId: "cherry_tomato_seed", rarity: "R", quantity: 1 },
  { itemId: "sun_coins_x30", name: "阳光币", type: "sunCoins", rarity: "R", quantity: 30 },
  { itemId: "farm_xp_x30", name: "农场经验", type: "farmXp", rarity: "R", quantity: 30 },
  { itemId: "small_watering_can_tool", name: "小水壶工具", type: "tool", targetId: "small_watering_can_tool", rarity: "R", quantity: 1 },
  { itemId: "leaf_fence_decoration", name: "绿叶栅栏装饰", type: "decoration", targetId: "leaf_fence_decoration", rarity: "R", quantity: 1 },
  { itemId: "mini_greenhouse_decoration", name: "迷你温室摆件", type: "decoration", targetId: "mini_greenhouse_decoration", rarity: "R", quantity: 1 },
  { itemId: "hardworking_farmer_title", name: "勤快农场主", type: "title", targetId: "hardworking_farmer_title", rarity: "R", quantity: 1 },
  { itemId: "cherry_tomato_seed_x3", name: "樱桃番茄种子", type: "seed", targetId: "cherry_tomato_seed", rarity: "SR", quantity: 3 },
  { itemId: "golden_tomato_seed_x1", name: "金色番茄种子", type: "seed", targetId: "golden_tomato_seed", rarity: "SR", quantity: 1 },
  { itemId: "sun_coins_x80", name: "阳光币", type: "sunCoins", rarity: "SR", quantity: 80 },
  { itemId: "farm_xp_x80", name: "农场经验", type: "farmXp", rarity: "SR", quantity: 80 },
  { itemId: "scarecrow_decoration", name: "稻草人装饰", type: "decoration", targetId: "scarecrow_decoration", rarity: "SR", quantity: 1 },
  { itemId: "tomato_sprite_partner", name: "小番茄精灵", type: "partner", targetId: "tomato_sprite_partner", rarity: "SR", quantity: 1 },
  { itemId: "greenhouse_keeper_title", name: "温室管理员", type: "title", targetId: "greenhouse_keeper_title", rarity: "SR", quantity: 1 },
  { itemId: "golden_tomato_seed_x3", name: "金色番茄种子", type: "seed", targetId: "golden_tomato_seed", rarity: "SSR", quantity: 3 },
  { itemId: "starlight_tomato_seed_x1", name: "星光番茄种子", type: "seed", targetId: "starlight_tomato_seed", rarity: "SSR", quantity: 1 },
  { itemId: "sun_coins_x200", name: "阳光币", type: "sunCoins", rarity: "SSR", quantity: 200 },
  { itemId: "farm_xp_x200", name: "农场经验", type: "farmXp", rarity: "SSR", quantity: 200 },
  { itemId: "sunny_fountain_decoration", name: "阳光喷泉", type: "decoration", targetId: "sunny_fountain_decoration", rarity: "SSR", quantity: 1 },
  { itemId: "warehouse_cat_partner", name: "仓库猫猫", type: "partner", targetId: "warehouse_cat_partner", rarity: "SSR", quantity: 1 },
  { itemId: "starlight_tomato_seed_x3", name: "星光番茄种子", type: "seed", targetId: "starlight_tomato_seed", rarity: "UR", quantity: 3 },
  { itemId: "rainbow_greenhouse_decoration", name: "彩虹温室", type: "decoration", targetId: "rainbow_greenhouse_decoration", rarity: "UR", quantity: 1 },
  { itemId: "tomato_dragon_partner", name: "番茄龙宝宝", type: "partner", targetId: "tomato_dragon_partner", rarity: "UR", quantity: 1 },
  { itemId: "tomato_base_legend_title", name: "番茄基地传说", type: "title", targetId: "tomato_base_legend_title", rarity: "UR", quantity: 1 }
];
const catalogCategoryNames: Record<CollectionType, string> = {
  tomato: "番茄图鉴",
  seed: "种子图鉴",
  decoration: "装饰图鉴",
  tool: "工具图鉴",
  partner: "伙伴图鉴",
  title: "称号图鉴"
};
const catalogCategoryIds: Record<CollectionType, string> = {
  tomato: "tomatoes",
  seed: "seeds",
  decoration: "decorations",
  tool: "tools",
  partner: "partners",
  title: "titles"
};
const catalogCategoryOrder: CollectionType[] = ["tomato", "seed", "decoration", "tool", "partner", "title"];
const collectionMeta: Record<string, { description: string; source: string }> = {
  basic_harvest_tomato: {
    description: "从真实番茄记录领取的基础收获，可用于制作普通种子。",
    source: "收获中心 / 补给中心"
  },
  basic_farm_tomato: {
    description: "在地块中手动种植并收获的基础经营番茄。",
    source: "种植中心 / 每日订单"
  },
  basic_tomato_seed: {
    description: "最基础的番茄种子，适合新手农场主继续经营地块。",
    source: "种植中心 / 每日订单 / 补给中心"
  },
  cherry_tomato_seed: {
    description: "小巧鲜亮的番茄种子，后续可用于更丰富的温室种植。",
    source: "补给中心"
  },
  golden_tomato_seed: {
    description: "带着阳光色泽的稀有种子，适合放进长期收藏清单。",
    source: "补给中心"
  },
  starlight_tomato_seed: {
    description: "闪着微光的珍贵种子，后续会开放专属种植用途。",
    source: "补给中心"
  },
  wooden_sign_decoration: {
    description: "可以放在田边的小木牌，给基地增加一点经营气息。",
    source: "补给中心"
  },
  old_barrel_decoration: {
    description: "旧木桶装饰，适合摆在仓库旁边。",
    source: "补给中心"
  },
  pebble_path_decoration: {
    description: "一段朴素的小石子路，后续可用于基地布置。",
    source: "补给中心"
  },
  leaf_fence_decoration: {
    description: "带着叶片纹样的栅栏装饰。",
    source: "补给中心"
  },
  mini_greenhouse_decoration: {
    description: "迷你温室摆件，象征基地正在一点点扩建。",
    source: "补给中心"
  },
  scarecrow_decoration: {
    description: "守在田边的稻草人装饰，让农场更像农场。",
    source: "补给中心"
  },
  sunny_fountain_decoration: {
    description: "明亮的阳光喷泉，适合摆在基地中央。",
    source: "补给中心"
  },
  rainbow_greenhouse_decoration: {
    description: "彩虹色的温室收藏品，代表非常罕见的经营物资。",
    source: "补给中心"
  },
  small_watering_can_tool: {
    description: "小水壶工具，后续可扩展为种植辅助物品。",
    source: "补给中心"
  },
  tomato_sprite_partner: {
    description: "喜欢在温室附近帮忙的小伙伴，暂时作为收藏展示。",
    source: "补给中心"
  },
  warehouse_cat_partner: {
    description: "喜欢待在仓库附近的农场伙伴，暂时作为收藏展示。",
    source: "补给中心"
  },
  tomato_dragon_partner: {
    description: "传说级农场伙伴，暂时作为收藏展示。",
    source: "补给中心"
  },
  hardworking_farmer_title: {
    description: "送给持续照料基地的农场主称号。",
    source: "补给中心"
  },
  greenhouse_keeper_title: {
    description: "象征温室经营经验的收藏称号。",
    source: "补给中心"
  },
  tomato_base_legend_title: {
    description: "番茄基地收藏进度里的传说称号。",
    source: "补给中心"
  }
};
const tomatoWeights: Record<string, number> = {
  "完美的🍅": 1,
  "有小瑕疵🍅": 0.9,
  "有大瑕疵🍅": 0.8,
  "被啃了一口🍅": 0.7,
  "半个🍅": 0.5
};

function finiteNumber(value: unknown, fallback: number, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, number);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeSeed(value: unknown) {
  const seed = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    seedId: stringValue(seed.seedId, defaultSeed.seedId),
    name: stringValue(seed.name, defaultSeed.name),
    rarity: stringValue(seed.rarity, defaultSeed.rarity),
    count: finiteNumber(seed.count, 0)
  };
}

function normalizeStoredTomato(value: unknown) {
  const tomato = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tomatoId = stringValue(tomato.tomatoId, defaultHarvestTomato.tomatoId);
  const fallback = tomatoId === defaultFarmTomato.tomatoId ? defaultFarmTomato : defaultHarvestTomato;
  return {
    tomatoId,
    name: stringValue(tomato.name, fallback.name),
    rarity: stringValue(tomato.rarity, fallback.rarity),
    count: finiteNumber(tomato.count, 0)
  };
}

function normalizeCollectionItem(value: unknown, idKey: string, fallbackId: string, fallbackName: string, fallbackRarity: Rarity = "N") {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    [idKey]: stringValue(item[idKey], fallbackId),
    name: stringValue(item.name, fallbackName),
    rarity: stringValue(item.rarity, fallbackRarity),
    count: Math.max(0, Math.floor(finiteNumber(item.count, 1)))
  };
}

function normalizeSupplyPity(value: unknown): SupplyPity {
  const pity = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    totalOpens: Math.max(0, Math.floor(finiteNumber(pity.totalOpens, 0))),
    sinceLastSR: Math.max(0, Math.floor(finiteNumber(pity.sinceLastSR, 0))),
    sinceLastSSR: Math.max(0, Math.floor(finiteNumber(pity.sinceLastSSR, 0)))
  };
}

function normalizeSupplyResult(value: unknown): SupplyResult {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rarityText = String(result.rarity ?? "N");
  const rarity: Rarity = rarityText === "R" || rarityText === "SR" || rarityText === "SSR" || rarityText === "UR" ? rarityText : "N";
  const typeText = String(result.type ?? "seed");
  const type: SupplyResult["type"] = ["seed", "tomato", "sunCoins", "farmXp", "decoration", "tool", "partner", "title"].includes(typeText)
    ? typeText as SupplyResult["type"]
    : "seed";
  return {
    itemId: stringValue(result.itemId, "unknown_supply_item"),
    name: stringValue(result.name, "补给物资"),
    type,
    rarity,
    quantity: Math.max(0, finiteNumber(result.quantity, 1)),
    isNew: Boolean(result.isNew),
    pityTriggered: Boolean(result.pityTriggered)
  };
}

function normalizeSupplyHistoryEntry(value: unknown): SupplyHistoryEntry {
  const entry = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const cost = entry.cost && typeof entry.cost === "object" && !Array.isArray(entry.cost) ? entry.cost as Record<string, unknown> : {};
  return {
    supplyId: stringValue(entry.supplyId, `supply_${crypto.randomUUID()}`),
    crateId: stringValue(entry.crateId, basicSeedCrate.crateId),
    crateName: stringValue(entry.crateName, basicSeedCrate.name),
    cost: {
      focusCrystals: Math.max(0, Math.round(finiteNumber(cost.focusCrystals, basicSeedCrate.cost.focusCrystals)))
    },
    results: arrayValue(entry.results).map(normalizeSupplyResult),
    createdAt: stringValue(entry.createdAt, nowIso())
  };
}

function normalizeSupplyState(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const pity = source.pity && typeof source.pity === "object" && !Array.isArray(source.pity) ? source.pity as Record<string, unknown> : {};
  return {
    pity: {
      [basicSeedCrate.crateId]: normalizeSupplyPity(pity[basicSeedCrate.crateId])
    },
    history: arrayValue(source.history).map(normalizeSupplyHistoryEntry)
  };
}

function nullableId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeShowcaseState(value: unknown): ShowcaseState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const slots = source.decorationSlots && typeof source.decorationSlots === "object" && !Array.isArray(source.decorationSlots)
    ? source.decorationSlots as Record<string, unknown>
    : {};
  return {
    titleId: nullableId(source.titleId),
    partnerId: nullableId(source.partnerId),
    decorationSlots: {
      signboard: nullableId(slots.signboard),
      field: nullableId(slots.field),
      greenhouse: nullableId(slots.greenhouse),
      warehouse: nullableId(slots.warehouse),
      path: nullableId(slots.path),
      background: nullableId(slots.background)
    },
    updatedAt: nullableId(source.updatedAt)
  };
}

function normalizePlantingPlot(value: unknown, fallbackId: string): PlantingPlot {
  const plot = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const statusText = String(plot.status ?? "empty");
  const status: PlantingPlot["status"] = statusText === "growing" || statusText === "ready" ? statusText : "empty";
  const seedId = typeof plot.seedId === "string" && plot.seedId.trim() ? plot.seedId.trim() : null;
  const seedName = typeof plot.seedName === "string" && plot.seedName.trim() ? plot.seedName.trim() : null;
  const plantedAt = typeof plot.plantedAt === "string" && plot.plantedAt.trim() ? plot.plantedAt.trim() : null;
  const readyAt = typeof plot.readyAt === "string" && plot.readyAt.trim() ? plot.readyAt.trim() : null;
  const harvestedAt = typeof plot.harvestedAt === "string" && plot.harvestedAt.trim() ? plot.harvestedAt.trim() : null;
  if (status === "empty") {
    return {
      plotId: stringValue(plot.plotId, fallbackId),
      status: "empty",
      seedId: null,
      seedName: null,
      plantedAt: null,
      readyAt: null,
      harvestedAt
    };
  }
  return {
    plotId: stringValue(plot.plotId, fallbackId),
    status,
    seedId,
    seedName,
    plantedAt,
    readyAt,
    harvestedAt
  };
}

function normalizePlantingPlots(values: unknown[], unlockedPlots: number) {
  const plots = values.map((plot, index) => normalizePlantingPlot(plot, `plot_${index + 1}`));
  for (let index = 1; index <= unlockedPlots; index += 1) {
    const plotId = `plot_${index}`;
    if (!plots.some((plot) => plot.plotId === plotId)) {
      plots.push({
        plotId,
        status: "empty",
        seedId: null,
        seedName: null,
        plantedAt: null,
        readyAt: null,
        harvestedAt: null
      });
    }
  }
  return plots;
}

function dailyBasicOrderId(dateKey: string) {
  return `daily_basic_${dateKey}`;
}

function defaultDailyOrder(dateKey = shanghaiDateKey(), completed = false): DailyOrder {
  return {
    orderId: dailyBasicOrderId(dateKey),
    type: "daily_basic",
    date: dateKey,
    title: "今日基础订单",
    description: "完成今日基础经营目标，并交付 1 个基础经营番茄。",
    status: completed ? "completed" : "available",
    completedAt: null,
    requirements: {
      effectiveTomatoesRequired: 1,
      effectiveTomatoesCurrent: 0,
      basicFarmTomatoesRequired: dailyBasicConsumed.basicFarmTomatoes
    },
    reward: { ...dailyBasicReward }
  };
}

function normalizeDailyOrder(value: unknown, fallbackDate = shanghaiDateKey(), completedIds: string[] = []): DailyOrder {
  const order = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const date = stringValue(order.date, fallbackDate);
  const orderId = stringValue(order.orderId, dailyBasicOrderId(date));
  const requirements = order.requirements && typeof order.requirements === "object" && !Array.isArray(order.requirements) ? order.requirements as Record<string, unknown> : {};
  const reward = order.reward && typeof order.reward === "object" && !Array.isArray(order.reward) ? order.reward as Record<string, unknown> : {};
  const completed = completedIds.includes(orderId) || order.status === "completed";
  return {
    orderId,
    type: "daily_basic",
    date,
    title: stringValue(order.title, "今日基础订单"),
    description: stringValue(order.description, "完成今日基础经营目标，并交付 1 个基础经营番茄。"),
    status: completed ? "completed" : "available",
    completedAt: typeof order.completedAt === "string" && order.completedAt.trim() ? order.completedAt.trim() : null,
    requirements: {
      effectiveTomatoesRequired: finiteNumber(requirements.effectiveTomatoesRequired, 1),
      effectiveTomatoesCurrent: finiteNumber(requirements.effectiveTomatoesCurrent, 0),
      basicFarmTomatoesRequired: Math.max(1, Math.floor(finiteNumber(requirements.basicFarmTomatoesRequired, dailyBasicConsumed.basicFarmTomatoes, 1)))
    },
    reward: {
      sunCoins: Math.max(0, Math.round(finiteNumber(reward.sunCoins, dailyBasicReward.sunCoins))),
      farmXp: Math.max(0, Math.round(finiteNumber(reward.farmXp, dailyBasicReward.farmXp))),
      focusCrystals: Math.max(0, Math.round(finiteNumber(reward.focusCrystals, dailyBasicReward.focusCrystals))),
      basicTomatoSeeds: Math.max(0, Math.round(finiteNumber(reward.basicTomatoSeeds, dailyBasicReward.basicTomatoSeeds)))
    }
  };
}

function normalizeDailyOrders(value: unknown, completedIds: string[], todayKey = shanghaiDateKey()) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const lastRefreshDate = stringValue(source.lastRefreshDate, todayKey);
  const orders = arrayValue(source.orders).map((order) => normalizeDailyOrder(order, todayKey, completedIds));
  const todayOrderId = dailyBasicOrderId(todayKey);
  if (!orders.some((order) => order.orderId === todayOrderId)) {
    orders.push(defaultDailyOrder(todayKey, completedIds.includes(todayOrderId)));
  }
  return {
    lastRefreshDate,
    orders,
    completedOrderIds: Array.from(new Set([...arrayValue(source.completedOrderIds).map((id) => String(id)).filter(Boolean), ...completedIds]))
  };
}

function taskBoardDailyTaskId(type: string, dateKey: string) {
  return `task_${type}_${dateKey}`;
}

function taskBoardWeeklyTaskId(type: string, weekId: string) {
  return `task_${type}_${weekId}`;
}

function defaultTaskBoardTask(taskId: string, scope: "daily" | "weekly", type: string, title: string, description: string, required: number, unit: string, reward: DailyOrderReward, claimed = false): TaskBoardTask {
  return {
    taskId,
    type,
    scope,
    title,
    description,
    status: claimed ? "claimed" : "available",
    progress: {
      current: 0,
      required,
      unit
    },
    reward: { ...reward },
    claimedAt: null
  };
}

function defaultTaskBoard(dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()): TaskBoardState {
  return {
    daily: {
      date: dateKey,
      tasks: []
    },
    weekly: {
      weekId,
      tasks: []
    },
    claimedTaskIds: [],
    updatedAt: null
  };
}

function normalizeTaskBoardTask(value: unknown, scope: "daily" | "weekly", claimedIds: string[]): TaskBoardTask | null {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const taskId = typeof source.taskId === "string" && source.taskId.trim() ? source.taskId.trim() : "";
  if (!taskId) return null;
  const progress = source.progress && typeof source.progress === "object" && !Array.isArray(source.progress) ? source.progress as Record<string, unknown> : {};
  const reward = source.reward && typeof source.reward === "object" && !Array.isArray(source.reward) ? source.reward as Record<string, unknown> : {};
  const statusText = String(source.status ?? "");
  const claimed = claimedIds.includes(taskId) || statusText === "claimed";
  const completed = statusText === "completed";
  return {
    taskId,
    type: stringValue(source.type, "custom_task"),
    scope,
    title: stringValue(source.title, scope === "daily" ? "每日经营目标" : "每周经营目标"),
    description: stringValue(source.description, "完成经营目标后可领取奖励。"),
    status: claimed ? "claimed" : completed ? "completed" : "available",
    progress: {
      current: Math.max(0, finiteNumber(progress.current, 0)),
      required: Math.max(1, finiteNumber(progress.required, 1, 1)),
      unit: stringValue(progress.unit, "次")
    },
    reward: normalizeDailyOrderReward(reward),
    claimedAt: typeof source.claimedAt === "string" && source.claimedAt.trim() ? source.claimedAt.trim() : null
  };
}

function normalizeTaskBoard(value: unknown, claimedIds: string[], dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()): TaskBoardState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const daily = source.daily && typeof source.daily === "object" && !Array.isArray(source.daily) ? source.daily as Record<string, unknown> : {};
  const weekly = source.weekly && typeof source.weekly === "object" && !Array.isArray(source.weekly) ? source.weekly as Record<string, unknown> : {};
  const claimedFromTasks = [...arrayValue(daily.tasks), ...arrayValue(weekly.tasks)]
    .map((task) => task && typeof task === "object" && !Array.isArray(task) ? task as Record<string, unknown> : null)
    .filter((task): task is Record<string, unknown> => Boolean(task && task.status === "claimed" && typeof task.taskId === "string" && task.taskId.trim()))
    .map((task) => String(task.taskId));
  const allClaimed = Array.from(new Set([
    ...arrayValue(source.claimedTaskIds).map((taskId) => String(taskId)).filter(Boolean),
    ...claimedFromTasks,
    ...claimedIds
  ]));
  return {
    daily: {
      date: stringValue(daily.date, dateKey),
      tasks: arrayValue(daily.tasks).map((task) => normalizeTaskBoardTask(task, "daily", allClaimed)).filter((task): task is TaskBoardTask => Boolean(task))
    },
    weekly: {
      weekId: stringValue(weekly.weekId, weekId),
      tasks: arrayValue(weekly.tasks).map((task) => normalizeTaskBoardTask(task, "weekly", allClaimed)).filter((task): task is TaskBoardTask => Boolean(task))
    },
    claimedTaskIds: allClaimed,
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : null
  };
}

function normalizeOperationTaskHistoryEntry(value: unknown): OperationTaskHistoryEntry | null {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "";
  const taskId = typeof source.taskId === "string" && source.taskId.trim() ? source.taskId.trim() : "";
  const claimedAt = typeof source.claimedAt === "string" && source.claimedAt.trim() ? source.claimedAt.trim() : "";
  const typeText = String(source.type ?? "");
  if (!id || !taskId || !claimedAt) return null;
  return {
    id,
    taskId,
    title: stringValue(source.title, "经营目标"),
    type: typeText === "weekly" ? "weekly" : "daily",
    claimedAt,
    rewardSummary: stringValue(source.rewardSummary, "已领取经营奖励")
  };
}

function defaultOperationStats(weekId = shanghaiWeekId()): OperationStatsState {
  return {
    streak: {
      currentDays: 0,
      bestDays: 0,
      lastActiveDate: null
    },
    weeklySummary: {
      weekId,
      completedTomatoes: 0,
      submittedOrders: 0,
      openedCrates: 0,
      plantedCount: 0,
      claimedTasks: 0,
      updatedAt: null
    },
    taskHistory: []
  };
}

function defaultPlanning(dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()): PlanningState {
  return {
    daily: {
      date: dateKey,
      tomatoTarget: 0,
      orderTarget: 0,
      plantingTarget: 0,
      harvestTarget: 0,
      note: "",
      updatedAt: null
    },
    weekly: {
      weekId,
      tomatoTarget: 0,
      orderTarget: 0,
      plantingTarget: 0,
      harvestTarget: 0,
      note: "",
      updatedAt: null
    }
  };
}

function defaultPlanningTemplates(): PlanningTemplatesState {
  return {
    daily: [],
    weekly: []
  };
}

function normalizePlanningTarget(value: unknown, { allowDecimal = false }: { allowDecimal?: boolean } = {}) {
  const safe = Math.max(0, finiteNumber(value, 0));
  if (allowDecimal) return Math.round(safe * 10) / 10;
  return Math.floor(safe);
}

function normalizePlanningTemplateName(value: unknown) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("模板名称不能为空");
  return name.slice(0, maxPlanningTemplateNameLength);
}

function clampPlanningTemplateTarget(value: unknown, scope: "tomato" | "count") {
  if (scope === "tomato") {
    const safe = Math.max(0, Math.round(finiteNumber(value, 0) * 10) / 10);
    return Math.min(maxPlanningTomatoTarget, safe);
  }
  const safe = Math.max(0, Math.floor(finiteNumber(value, 0)));
  return Math.min(maxPlanningCycleTarget, safe);
}

function normalizePlanningTemplate(
  value: unknown,
  fallbackNow = nowIso()
): PlanningTemplate | null {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const id = stringValue(source.id, "");
  const name = stringValue(source.name, "").trim().slice(0, maxPlanningTemplateNameLength);
  if (!id || !name) return null;
  return {
    id,
    name,
    tomatoTarget: clampPlanningTemplateTarget(source.tomatoTarget, "tomato"),
    orderTarget: clampPlanningTemplateTarget(source.orderTarget, "count"),
    plantingTarget: clampPlanningTemplateTarget(source.plantingTarget, "count"),
    harvestTarget: clampPlanningTemplateTarget(source.harvestTarget, "count"),
    note: stringValue(source.note, "").slice(0, 300),
    createdAt: stringValue(source.createdAt, fallbackNow),
    updatedAt: stringValue(source.updatedAt, fallbackNow)
  };
}

function normalizePlanningTemplatesState(value: unknown): PlanningTemplatesState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const normalizeScope = (items: unknown[], scope: PlanningTemplateScope) => {
    const seen = new Set<string>();
    return items
      .map((item) => normalizePlanningTemplate(item))
      .filter((item): item is PlanningTemplate => Boolean(item))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, maxPlanningTemplatesPerScope);
  };
  return {
    daily: normalizeScope(arrayValue(source.daily), "daily"),
    weekly: normalizeScope(arrayValue(source.weekly), "weekly")
  };
}

function buildPlanningTemplateFromInput(body: Record<string, unknown>) {
  return {
    name: normalizePlanningTemplateName(body.name),
    tomatoTarget: clampPlanningTemplateTarget(body.tomatoTarget, "tomato"),
    orderTarget: clampPlanningTemplateTarget(body.orderTarget, "count"),
    plantingTarget: clampPlanningTemplateTarget(body.plantingTarget, "count"),
    harvestTarget: clampPlanningTemplateTarget(body.harvestTarget, "count"),
    note: stringValue(body.note, "").slice(0, 300)
  };
}

function normalizePlanningGoal(
  value: unknown,
  cycle: "daily" | "weekly",
  cycleKey: string
): DailyPlanningState | WeeklyPlanningState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (cycle === "daily") {
    const savedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(source.date ?? "")) ? String(source.date) : cycleKey;
    if (savedDate !== cycleKey) {
      return {
        ...defaultPlanning(cycleKey, shanghaiWeekId()).daily,
        date: cycleKey
      };
    }
  } else {
    const savedWeekId = /^\d{4}-\d{2}$/.test(String(source.weekId ?? "")) ? String(source.weekId) : cycleKey;
    if (savedWeekId !== cycleKey) {
      return {
        ...defaultPlanning(shanghaiDateKey(), cycleKey).weekly,
        weekId: cycleKey
      };
    }
  }
  const common = {
    tomatoTarget: normalizePlanningTarget(source.tomatoTarget, { allowDecimal: true }),
    orderTarget: normalizePlanningTarget(source.orderTarget),
    plantingTarget: normalizePlanningTarget(source.plantingTarget),
    harvestTarget: normalizePlanningTarget(source.harvestTarget),
    note: stringValue(source.note, "").slice(0, 300),
    updatedAt: typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : null
  };
  if (cycle === "daily") {
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(source.date ?? "")) ? String(source.date) : cycleKey,
      ...common
    };
  }
  return {
    weekId: /^\d{4}-\d{2}$/.test(String(source.weekId ?? "")) ? String(source.weekId) : cycleKey,
    ...common
  };
}

function normalizePlanningState(value: unknown, dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()): PlanningState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    daily: normalizePlanningGoal(source.daily, "daily", dateKey) as DailyPlanningState,
    weekly: normalizePlanningGoal(source.weekly, "weekly", weekId) as WeeklyPlanningState
  };
}

function normalizeOperationStats(value: unknown, weekId = shanghaiWeekId()): OperationStatsState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const streak = source.streak && typeof source.streak === "object" && !Array.isArray(source.streak) ? source.streak as Record<string, unknown> : {};
  const weekly = source.weeklySummary && typeof source.weeklySummary === "object" && !Array.isArray(source.weeklySummary) ? source.weeklySummary as Record<string, unknown> : {};
  return {
    streak: {
      currentDays: Math.max(0, Math.floor(finiteNumber(streak.currentDays, 0))),
      bestDays: Math.max(0, Math.floor(finiteNumber(streak.bestDays, 0))),
      lastActiveDate: typeof streak.lastActiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(streak.lastActiveDate) ? streak.lastActiveDate : null
    },
    weeklySummary: {
      weekId: stringValue(weekly.weekId, weekId),
      completedTomatoes: Math.max(0, Math.round(finiteNumber(weekly.completedTomatoes, 0) * 100) / 100),
      submittedOrders: Math.max(0, Math.floor(finiteNumber(weekly.submittedOrders, 0))),
      openedCrates: Math.max(0, Math.floor(finiteNumber(weekly.openedCrates, 0))),
      plantedCount: Math.max(0, Math.floor(finiteNumber(weekly.plantedCount, 0))),
      claimedTasks: Math.max(0, Math.floor(finiteNumber(weekly.claimedTasks, 0))),
      updatedAt: typeof weekly.updatedAt === "string" && weekly.updatedAt.trim() ? weekly.updatedAt.trim() : null
    },
    taskHistory: arrayValue(source.taskHistory)
      .map(normalizeOperationTaskHistoryEntry)
      .filter((entry): entry is OperationTaskHistoryEntry => Boolean(entry))
      .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
      .slice(0, 30)
  };
}

function defaultGameState(now = nowIso(), eventId = `init_${crypto.randomUUID()}`): GameState {
  const dateKey = shanghaiDateKey(new Date(now));
  const weekId = shanghaiWeekId(new Date(now));
  return {
    version: 1,
    initializedAt: now,
    updatedAt: now,
    profile: {
      farmName: "番茄基地",
      level: 1,
      xp: 0,
      xpToNextLevel: 100,
      title: "新手农场主"
    },
    wallet: {
      sunCoins: 0,
      focusCrystals: 0,
      stardust: 0
    },
    farm: {
      unlockedPlots: 1,
      greenhouseLevel: 1,
      warehouseLevel: 1,
      decorationScore: 0
    },
    inventory: {
      seeds: [{ ...defaultSeed }],
      tomatoes: [{ ...defaultHarvestTomato }, { ...defaultFarmTomato }],
      decorations: [],
      tools: [],
      partners: []
    },
    collection: {
      unlockedTomatoes: [],
      unlockedDecorations: [],
      unlockedPartners: [],
      unlockedTitles: [],
      unlockedTools: [],
      unlockedSeeds: [],
      seenItemIds: []
    },
    showcase: {
      titleId: null,
      partnerId: null,
      decorationSlots: { ...defaultShowcaseSlots },
      updatedAt: null
    },
    taskBoard: defaultTaskBoard(dateKey, weekId),
    operationStats: defaultOperationStats(weekId),
    planning: defaultPlanning(dateKey, weekId),
    planningTemplates: defaultPlanningTemplates(),
    planting: {
      plots: [{
        plotId: "plot_1",
        status: "empty",
        seedId: null,
        seedName: null,
        plantedAt: null,
        readyAt: null,
        harvestedAt: null
      }]
    },
    dailyOrders: {
      lastRefreshDate: dateKey,
      orders: [defaultDailyOrder(dateKey)],
      completedOrderIds: []
    },
    supply: {
      pity: {
        [basicSeedCrate.crateId]: {
          totalOpens: 0,
          sinceLastSR: 0,
          sinceLastSSR: 0
        }
      },
      history: []
    },
    events: [{
      eventId,
      type: "game_initialized",
      message: "番茄基地经营系统已启用",
      createdAt: now,
      source: "system"
    }],
    idempotency: {
      eventIds: [eventId],
      claimedPomodoroRecordIds: [],
      completedDailyOrderIds: [],
      supplyOpenIds: []
    }
  };
}

function normalizeGameState(raw: unknown): GameState {
  const base = defaultGameState();
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const profile = source.profile && typeof source.profile === "object" && !Array.isArray(source.profile) ? source.profile as Record<string, unknown> : {};
  const wallet = source.wallet && typeof source.wallet === "object" && !Array.isArray(source.wallet) ? source.wallet as Record<string, unknown> : {};
  const farm = source.farm && typeof source.farm === "object" && !Array.isArray(source.farm) ? source.farm as Record<string, unknown> : {};
  const inventory = source.inventory && typeof source.inventory === "object" && !Array.isArray(source.inventory) ? source.inventory as Record<string, unknown> : {};
  const collection = source.collection && typeof source.collection === "object" && !Array.isArray(source.collection) ? source.collection as Record<string, unknown> : {};
  const planting = source.planting && typeof source.planting === "object" && !Array.isArray(source.planting) ? source.planting as Record<string, unknown> : {};
  const dailyOrders = source.dailyOrders && typeof source.dailyOrders === "object" && !Array.isArray(source.dailyOrders) ? source.dailyOrders as Record<string, unknown> : {};
  const supply = source.supply && typeof source.supply === "object" && !Array.isArray(source.supply) ? source.supply as Record<string, unknown> : {};
  const showcase = source.showcase && typeof source.showcase === "object" && !Array.isArray(source.showcase) ? source.showcase as Record<string, unknown> : {};
  const taskBoard = source.taskBoard && typeof source.taskBoard === "object" && !Array.isArray(source.taskBoard) ? source.taskBoard as Record<string, unknown> : {};
  const operationStats = source.operationStats && typeof source.operationStats === "object" && !Array.isArray(source.operationStats) ? source.operationStats as Record<string, unknown> : {};
  const planning = source.planning && typeof source.planning === "object" && !Array.isArray(source.planning) ? source.planning as Record<string, unknown> : {};
  const planningTemplates = source.planningTemplates && typeof source.planningTemplates === "object" && !Array.isArray(source.planningTemplates) ? source.planningTemplates as Record<string, unknown> : {};
  const idempotency = source.idempotency && typeof source.idempotency === "object" && !Array.isArray(source.idempotency) ? source.idempotency as Record<string, unknown> : {};
  const events = arrayValue(source.events)
    .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object" && !Array.isArray(event)))
    .map((event) => ({
      eventId: stringValue(event.eventId, `event_${crypto.randomUUID()}`),
      type: stringValue(event.type, "system_note"),
      message: stringValue(event.message, "经营事件"),
      createdAt: stringValue(event.createdAt, nowIso()),
      source: stringValue(event.source, "system"),
      recordId: typeof event.recordId === "string" ? event.recordId : undefined,
      orderId: typeof event.orderId === "string" ? event.orderId : undefined,
      crateId: typeof event.crateId === "string" ? event.crateId : undefined,
      itemId: typeof event.itemId === "string" ? event.itemId : undefined,
      slotId: typeof event.slotId === "string" ? event.slotId : undefined,
      taskId: typeof event.taskId === "string" ? event.taskId : undefined,
      results: arrayValue(event.results).map(normalizeSupplyResult),
      reward: event.reward && typeof event.reward === "object" && !Array.isArray(event.reward)
        ? normalizeEventReward(event.reward as Record<string, unknown>)
        : undefined,
      consumed: event.consumed && typeof event.consumed === "object" && !Array.isArray(event.consumed)
        ? normalizeDailyOrderConsumed(event.consumed as Record<string, unknown>)
        : undefined
    }));
  const eventIds = Array.from(new Set(arrayValue(idempotency.eventIds).map((eventId) => String(eventId)).filter(Boolean)));
  const claimedPomodoroRecordIds = Array.from(new Set(arrayValue(idempotency.claimedPomodoroRecordIds).map((recordId) => String(recordId)).filter(Boolean)));
  const completedDailyOrderIds = Array.from(new Set(arrayValue(idempotency.completedDailyOrderIds).map((orderId) => String(orderId)).filter(Boolean)));
  const supplyOpenIds = Array.from(new Set(arrayValue(idempotency.supplyOpenIds).map((supplyId) => String(supplyId)).filter(Boolean)));
  const normalizedSeeds = arrayValue(inventory.seeds).map(normalizeSeed);
  if (!normalizedSeeds.some((seed) => seed.seedId === defaultSeed.seedId)) {
    normalizedSeeds.unshift({ ...defaultSeed });
  }
  const normalizedTomatoes = arrayValue(inventory.tomatoes).map(normalizeStoredTomato);
  if (!normalizedTomatoes.some((tomato) => tomato.tomatoId === defaultHarvestTomato.tomatoId)) {
    normalizedTomatoes.unshift({ ...defaultHarvestTomato });
  }
  if (!normalizedTomatoes.some((tomato) => tomato.tomatoId === defaultFarmTomato.tomatoId)) {
    normalizedTomatoes.push({ ...defaultFarmTomato });
  }
  const unlockedPlots = Math.max(1, Math.floor(finiteNumber(farm.unlockedPlots, base.farm.unlockedPlots, 1)));
  const normalizedPlots = normalizePlantingPlots(arrayValue(planting.plots), unlockedPlots);
  const normalizedDailyOrders = normalizeDailyOrders(dailyOrders, completedDailyOrderIds);
  const normalizedSupply = normalizeSupplyState(supply);
  const normalizedShowcase = normalizeShowcaseState(showcase);
  const normalizedTaskBoard = normalizeTaskBoard(taskBoard, []);
  const normalizedOperationStats = normalizeOperationStats(operationStats);
  const normalizedPlanning = normalizePlanningState(planning);
  const normalizedPlanningTemplates = normalizePlanningTemplatesState(planningTemplates);

  return {
    version: Math.max(1, Math.floor(finiteNumber(source.version, base.version, 1))),
    initializedAt: stringValue(source.initializedAt, base.initializedAt),
    updatedAt: stringValue(source.updatedAt, base.updatedAt),
    profile: {
      farmName: stringValue(profile.farmName, base.profile.farmName),
      level: Math.max(1, Math.floor(finiteNumber(profile.level, base.profile.level, 1))),
      xp: finiteNumber(profile.xp, base.profile.xp),
      xpToNextLevel: Math.max(1, finiteNumber(profile.xpToNextLevel, base.profile.xpToNextLevel, 1)),
      title: stringValue(profile.title, base.profile.title)
    },
    wallet: {
      sunCoins: finiteNumber(wallet.sunCoins, base.wallet.sunCoins),
      focusCrystals: finiteNumber(wallet.focusCrystals, base.wallet.focusCrystals),
      stardust: finiteNumber(wallet.stardust, base.wallet.stardust)
    },
    farm: {
      unlockedPlots,
      greenhouseLevel: Math.max(1, Math.floor(finiteNumber(farm.greenhouseLevel, base.farm.greenhouseLevel, 1))),
      warehouseLevel: Math.max(1, Math.floor(finiteNumber(farm.warehouseLevel, base.farm.warehouseLevel, 1))),
      decorationScore: finiteNumber(farm.decorationScore, base.farm.decorationScore)
    },
    inventory: {
      seeds: normalizedSeeds,
      tomatoes: normalizedTomatoes,
      decorations: arrayValue(inventory.decorations).map((item) => normalizeCollectionItem(item, "decorationId", "decoration", "农场装饰")),
      tools: arrayValue(inventory.tools).map((item) => normalizeCollectionItem(item, "toolId", "tool", "农场工具")),
      partners: arrayValue(inventory.partners).map((item) => normalizeCollectionItem(item, "partnerId", "partner", "农场伙伴"))
    },
    collection: {
      unlockedTomatoes: arrayValue(collection.unlockedTomatoes),
      unlockedDecorations: arrayValue(collection.unlockedDecorations),
      unlockedPartners: arrayValue(collection.unlockedPartners),
      unlockedTitles: arrayValue(collection.unlockedTitles),
      unlockedTools: arrayValue(collection.unlockedTools),
      unlockedSeeds: arrayValue(collection.unlockedSeeds),
      seenItemIds: Array.from(new Set(arrayValue(collection.seenItemIds).map((itemId) => String(itemId)).filter(Boolean)))
    },
    showcase: normalizedShowcase,
    taskBoard: normalizedTaskBoard,
    operationStats: normalizedOperationStats,
    planning: normalizedPlanning,
    planningTemplates: normalizedPlanningTemplates,
    planting: {
      plots: normalizedPlots
    },
    dailyOrders: normalizedDailyOrders,
    supply: normalizedSupply,
    events,
    idempotency: {
      eventIds: Array.from(new Set([...eventIds, ...events.map((event) => event.eventId)])),
      claimedPomodoroRecordIds,
      completedDailyOrderIds: normalizedDailyOrders.completedOrderIds,
      supplyOpenIds: Array.from(new Set([...supplyOpenIds, ...normalizedSupply.history.map((entry) => entry.supplyId)]))
    }
  };
}

function readGameState(userId: number) {
  const row = get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", [userId, gameStateKey]);
  if (!row?.value) return null;
  return normalizeGameState(JSON.parse(row.value));
}

function normalizeHarvestReward(value: Record<string, unknown>): HarvestReward {
  return {
    sunCoins: Math.max(0, Math.round(finiteNumber(value.sunCoins, 0))),
    farmXp: Math.max(0, Math.round(finiteNumber(value.farmXp, 0))),
    focusCrystals: Math.max(0, Math.round(finiteNumber(value.focusCrystals, 0))),
    tomatoUnits: Math.max(0, Math.round(finiteNumber(value.tomatoUnits, 0) * 100) / 100)
  };
}

function normalizeDailyOrderReward(value: Record<string, unknown>): DailyOrderReward {
  return {
    sunCoins: Math.max(0, Math.round(finiteNumber(value.sunCoins, 0))),
    farmXp: Math.max(0, Math.round(finiteNumber(value.farmXp, 0))),
    focusCrystals: Math.max(0, Math.round(finiteNumber(value.focusCrystals, 0))),
    basicTomatoSeeds: Math.max(0, Math.round(finiteNumber(value.basicTomatoSeeds, 0)))
  };
}

function normalizeEventReward(value: Record<string, unknown>) {
  return "basicTomatoSeeds" in value ? normalizeDailyOrderReward(value) : normalizeHarvestReward(value);
}

function normalizeDailyOrderConsumed(value: Record<string, unknown>): DailyOrderConsumed {
  return {
    basicFarmTomatoes: Math.max(0, Math.round(finiteNumber(value.basicFarmTomatoes, 0)))
  };
}

function readTomatoState(userId: number) {
  const row = get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", [userId, "tomatoes.state.v1"]);
  if (!row?.value) return null;
  const parsed = JSON.parse(row.value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function tomatoRecords(userId: number) {
  const state = readTomatoState(userId);
  return Array.isArray(state?.records) ? state.records.filter((record): record is TomatoRecord => Boolean(record && typeof record === "object" && !Array.isArray(record))) : [];
}

function stableRecordId(record: TomatoRecord, index: number) {
  if (typeof record.id === "string" && record.id.trim()) return record.id.trim();
  return `fallback_${crypto.createHash("sha256").update(JSON.stringify({
    index,
    date: record.date,
    no: record.no,
    startTime: record.startTime,
    endTime: record.endTime,
    taskGoal: record.taskGoal,
    completionContent: record.completionContent,
    createdAt: record.createdAt
  })).digest("hex").slice(0, 24)}`;
}

function recordWeight(record: TomatoRecord) {
  const explicit = Number(record.tomatoWeight);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit * 100) / 100;
  const status = String(record.tomatoStatus ?? "");
  return tomatoWeights[status] ?? 1;
}

function completionMultiplier(record: TomatoRecord) {
  const percent = Number(record.completionPercent);
  if (!Number.isFinite(percent)) return 1;
  return Math.min(1, Math.max(0.5, percent / 100));
}

function focusCrystalReward(record: TomatoRecord) {
  const status = String(record.tomatoStatus ?? "");
  if (status === "完美的🍅") return 2;
  if (status === "有小瑕疵🍅" || status === "有大瑕疵🍅") return 1;
  return 0;
}

function calculateHarvestReward(record: TomatoRecord): HarvestReward {
  const weight = recordWeight(record);
  const multiplier = Math.max(0, weight * completionMultiplier(record));
  return {
    sunCoins: Math.max(0, Math.round(20 * multiplier)),
    farmXp: Math.max(0, Math.round(30 * multiplier)),
    focusCrystals: focusCrystalReward(record),
    tomatoUnits: weight
  };
}

function xpToNextLevel(level: number) {
  return 100 + (Math.max(1, level) - 1) * 150;
}

function applyFarmXp(state: GameState, farmXp: number) {
  const oldLevel = state.profile.level;
  state.profile.xp += Math.max(0, farmXp);
  state.profile.xpToNextLevel = xpToNextLevel(state.profile.level);
  while (state.profile.xp >= state.profile.xpToNextLevel) {
    state.profile.xp -= state.profile.xpToNextLevel;
    state.profile.level += 1;
    state.profile.xpToNextLevel = xpToNextLevel(state.profile.level);
  }
  return {
    leveledUp: state.profile.level > oldLevel,
    oldLevel,
    newLevel: state.profile.level
  };
}

function harvestTomatoInventory(state: GameState) {
  let tomato = state.inventory.tomatoes.find((item) => item.tomatoId === defaultHarvestTomato.tomatoId);
  if (!tomato) {
    tomato = { ...defaultHarvestTomato };
    state.inventory.tomatoes.unshift(tomato);
  }
  return tomato;
}

function farmTomatoInventory(state: GameState) {
  let tomato = state.inventory.tomatoes.find((item) => item.tomatoId === defaultFarmTomato.tomatoId);
  if (!tomato) {
    tomato = { ...defaultFarmTomato };
    state.inventory.tomatoes.push(tomato);
  }
  return tomato;
}

function basicSeedInventory(state: GameState) {
  let seed = state.inventory.seeds.find((item) => item.seedId === defaultSeed.seedId);
  if (!seed) {
    seed = { ...defaultSeed };
    state.inventory.seeds.unshift(seed);
  }
  seed.count = Math.max(0, Math.floor(finiteNumber(seed.count, 0)));
  return seed;
}

function syncPlantingReadiness(state: GameState, now = new Date()) {
  let changed = false;
  state.planting.plots.forEach((plot) => {
    if (plot.status === "growing" && plot.readyAt) {
      const readyAt = new Date(plot.readyAt);
      if (!Number.isNaN(readyAt.getTime()) && readyAt.getTime() <= now.getTime()) {
        plot.status = "ready";
        changed = true;
      }
    }
  });
  return changed;
}

function remainingSeconds(plot: PlantingPlot, now = new Date()) {
  if (!plot.readyAt || plot.status === "empty") return 0;
  const readyAt = new Date(plot.readyAt);
  if (Number.isNaN(readyAt.getTime())) return 0;
  return Math.max(0, Math.ceil((readyAt.getTime() - now.getTime()) / 1000));
}

function plotPayload(plot: PlantingPlot, now = new Date()) {
  return {
    ...plot,
    remainingSeconds: remainingSeconds(plot, now)
  };
}

function plantingStatePayload(state: GameState, now = new Date()) {
  syncPlantingReadiness(state, now);
  return {
    ok: true,
    initialized: true,
    serverNow: now.toISOString(),
    config: {
      basicTomatoGrowSeconds
    },
    plots: state.planting.plots.map((plot) => plotPayload(plot, now)),
    inventory: {
      seeds: state.inventory.seeds,
      tomatoes: state.inventory.tomatoes
    }
  };
}

function addGameEvent(state: GameState, event: GameState["events"][number]) {
  if (state.idempotency.eventIds.includes(event.eventId)) return;
  state.events.push(event);
  state.idempotency.eventIds.push(event.eventId);
}

function recordBelongsToDate(record: TomatoRecord, dateKey: string) {
  if (String(record.date ?? "") === dateKey) return true;
  return sameShanghaiDay(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""), dateKey);
}

function todayEffectiveTomatoes(userId: number, dateKey = shanghaiDateKey()) {
  return Math.round(tomatoRecords(userId)
    .filter((record) => recordBelongsToDate(record, dateKey))
    .reduce((sum, record) => sum + recordWeight(record), 0) * 100) / 100;
}

function recordBelongsToWeek(record: TomatoRecord, weekId: string) {
  const dateText = String(record.date ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    const [year, month, day] = dateText.split("-").map(Number);
    return shanghaiWeekId(new Date(Date.UTC(year, month - 1, day))) === weekId;
  }
  const date = new Date(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""));
  return !Number.isNaN(date.getTime()) && shanghaiWeekId(date) === weekId;
}

function weekEffectiveTomatoes(userId: number, weekId = shanghaiWeekId()) {
  return Math.round(tomatoRecords(userId)
    .filter((record) => recordBelongsToWeek(record, weekId))
    .reduce((sum, record) => sum + recordWeight(record), 0) * 100) / 100;
}

function weekTomatoRecords(userId: number, weekId = shanghaiWeekId()) {
  return tomatoRecords(userId).filter((record) => recordBelongsToWeek(record, weekId));
}

function recordFocusMinutes(record: TomatoRecord) {
  const minuteFields = ["focusMinutes", "durationMinutes", "actualMinutes", "minutes"];
  for (const field of minuteFields) {
    const value = Number(record[field]);
    if (Number.isFinite(value) && value > 0) return Math.min(480, value);
  }
  const seconds = Number(record.durationSeconds ?? record.focusSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(480, seconds / 60);
  const milliseconds = Number(record.durationMs ?? record.focusMs);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.min(480, milliseconds / 60000);
  const start = new Date(String(record.startTime ?? record.startedAt ?? ""));
  const end = new Date(String(record.endTime ?? record.endedAt ?? record.completedAt ?? ""));
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
    return Math.min(480, (end.getTime() - start.getTime()) / 60000);
  }
  return 0;
}

function weekFocusMinutes(userId: number, weekId = shanghaiWeekId()) {
  return Math.round(weekTomatoRecords(userId, weekId)
    .reduce((sum, record) => sum + recordFocusMinutes(record), 0));
}

function plantedCountOnDate(state: GameState, dateKey = shanghaiDateKey()) {
  return state.events.filter((event) => event.type === "seed_planted" && eventCreatedOnDate(event, dateKey)).length;
}

function plantingHarvestedCountOnDate(state: GameState, dateKey = shanghaiDateKey()) {
  return state.events.filter((event) => event.type === "planting_harvested" && eventCreatedOnDate(event, dateKey)).length;
}

function supplyOpenCountOnDate(state: GameState, dateKey = shanghaiDateKey()) {
  return state.events.filter((event) => event.type === "supply_opened" && eventCreatedOnDate(event, dateKey)).length;
}

function todayTargetTomatoes(userId: number) {
  const state = readTomatoState(userId);
  const settings = state?.settings && typeof state.settings === "object" && !Array.isArray(state.settings)
    ? state.settings as Record<string, unknown>
    : {};
  const target = Number(settings.todayTargetTomatoes);
  return Number.isFinite(target) && target > 0 ? target : 1;
}

function dailyOrderState(userId: number, state: GameState, dateKey = shanghaiDateKey()) {
  const orderId = dailyBasicOrderId(dateKey);
  const effective = todayEffectiveTomatoes(userId, dateKey);
  const target = todayTargetTomatoes(userId);
  const required = Math.max(1, Math.min(target, 3));
  const basicFarmTomatoes = farmTomatoInventory(state).count;
  const completed = state.idempotency.completedDailyOrderIds.includes(orderId)
    || state.dailyOrders.completedOrderIds.includes(orderId);
  const reasons: string[] = [];
  if (effective < required) reasons.push("今日有效番茄不足");
  if (basicFarmTomatoes < dailyBasicConsumed.basicFarmTomatoes) reasons.push("基础经营番茄不足");
  const order = normalizeDailyOrder(
    state.dailyOrders.orders.find((item) => item.orderId === orderId) ?? defaultDailyOrder(dateKey, completed),
    dateKey,
    completed ? [orderId] : []
  );
  order.status = completed ? "completed" : "available";
  order.requirements.effectiveTomatoesRequired = required;
  order.requirements.effectiveTomatoesCurrent = effective;
  order.requirements.basicFarmTomatoesRequired = dailyBasicConsumed.basicFarmTomatoes;
  order.reward = { ...dailyBasicReward };
  return {
    ok: true,
    initialized: true,
    date: dateKey,
    summary: {
      todayEffectiveTomatoes: effective,
      todayTargetTomatoes: target,
      basicOrderRequiredTomatoes: required,
      basicFarmTomatoes
    },
    order: {
      ...order,
      canSubmit: !completed && reasons.length === 0,
      requirements: {
        ...order.requirements,
        basicFarmTomatoesCurrent: basicFarmTomatoes
      },
      reward: { ...dailyBasicReward },
      consumed: { ...dailyBasicConsumed },
      reasons
    }
  };
}

function upsertDailyOrder(state: GameState, order: DailyOrder) {
  const index = state.dailyOrders.orders.findIndex((item) => item.orderId === order.orderId);
  if (index >= 0) state.dailyOrders.orders[index] = order;
  else state.dailyOrders.orders.push(order);
}

function eventCreatedOnDate(event: GameState["events"][number], dateKey: string) {
  return sameShanghaiDay(event.createdAt, dateKey);
}

function eventCreatedInWeek(event: GameState["events"][number], weekId: string) {
  const date = new Date(event.createdAt);
  return !Number.isNaN(date.getTime()) && shanghaiWeekId(date) === weekId;
}

function dailyCompletedOrderCountInWeek(state: GameState, weekId: string) {
  return state.dailyOrders.completedOrderIds.filter((orderId) => {
    const date = orderId.replace("daily_basic_", "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const [year, month, day] = date.split("-").map(Number);
    return shanghaiWeekId(new Date(Date.UTC(year, month - 1, day))) === weekId;
  }).length;
}

function supplyOpenCountInWeek(state: GameState, weekId: string) {
  return state.supply.history.filter((entry) => {
    const date = new Date(entry.createdAt);
    return !Number.isNaN(date.getTime()) && shanghaiWeekId(date) === weekId;
  }).length;
}

function plantedCountInWeek(state: GameState, weekId: string) {
  return state.events.filter((event) => event.type === "seed_planted" && eventCreatedInWeek(event, weekId)).length;
}

function plantingHarvestedCountInWeek(state: GameState, weekId: string) {
  return state.events.filter((event) => event.type === "planting_harvested" && eventCreatedInWeek(event, weekId)).length;
}

function checkInDaysInWeek(state: GameState, weekId: string) {
  const dates = new Set<string>();
  state.events.forEach((event) => {
    if (event.type !== "operation_check_in" || !eventCreatedInWeek(event, weekId)) return;
    dates.add(shanghaiDateKey(new Date(event.createdAt)));
  });
  const lastActiveDate = state.operationStats.streak.lastActiveDate;
  if (lastActiveDate && /^\d{4}-\d{2}-\d{2}$/.test(lastActiveDate)) {
    const [year, month, day] = lastActiveDate.split("-").map(Number);
    if (shanghaiWeekId(new Date(Date.UTC(year, month - 1, day))) === weekId) dates.add(lastActiveDate);
  }
  return dates.size;
}

function claimedTaskCountInWeek(state: GameState, weekId: string) {
  return state.operationStats.taskHistory.filter((entry) => {
    const date = new Date(entry.claimedAt);
    return !Number.isNaN(date.getTime()) && shanghaiWeekId(date) === weekId;
  }).length;
}

function rewardSummaryText(reward: DailyOrderReward) {
  const parts = [
    reward.sunCoins ? `阳光币 +${reward.sunCoins}` : "",
    reward.farmXp ? `经验 +${reward.farmXp}` : "",
    reward.focusCrystals ? `专注水晶 +${reward.focusCrystals}` : "",
    reward.basicTomatoSeeds ? `普通种子 +${reward.basicTomatoSeeds}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "已领取经营奖励";
}

function appendTaskHistory(state: GameState, task: TaskBoardTask, claimedAt: string) {
  if (state.operationStats.taskHistory.some((entry) => entry.taskId === task.taskId)) return;
  state.operationStats.taskHistory.unshift({
    id: `task_history_${crypto.createHash("sha256").update(`${task.taskId}:${claimedAt}`).digest("hex").slice(0, 24)}`,
    taskId: task.taskId,
    title: task.title,
    type: task.scope,
    claimedAt,
    rewardSummary: rewardSummaryText(task.reward)
  });
  state.operationStats.taskHistory = state.operationStats.taskHistory
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
    .slice(0, 30);
}

function previousShanghaiDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return shanghaiDateKey(date);
}

function checkInStreakPreview(stats: OperationStatsState, dateKey = shanghaiDateKey()) {
  const lastActiveDate = stats.streak.lastActiveDate;
  if (lastActiveDate === dateKey) {
    return {
      alreadyCheckedIn: true,
      currentDays: stats.streak.currentDays,
      bestDays: stats.streak.bestDays,
      lastActiveDate
    };
  }
  const yesterday = previousShanghaiDateKey(dateKey);
  const nextCurrent = lastActiveDate === yesterday ? stats.streak.currentDays + 1 : 1;
  return {
    alreadyCheckedIn: false,
    currentDays: nextCurrent,
    bestDays: Math.max(stats.streak.bestDays, nextCurrent),
    lastActiveDate: dateKey
  };
}

function weeklyGoalProgress(summary: OperationStatsState["weeklySummary"]) {
  const targets = {
    completedTomatoes: 5,
    submittedOrders: 3,
    openedCrates: 1,
    plantedCount: 3,
    claimedTasks: 3
  };
  const ratios = [
    Math.min(1, summary.completedTomatoes / targets.completedTomatoes),
    Math.min(1, summary.submittedOrders / targets.submittedOrders),
    Math.min(1, summary.openedCrates / targets.openedCrates),
    Math.min(1, summary.plantedCount / targets.plantedCount),
    Math.min(1, summary.claimedTasks / targets.claimedTasks)
  ];
  return Math.round(ratios.reduce((sum, item) => sum + item, 0) / ratios.length * 100);
}

function operationSummaryState(userId: number, state: GameState, dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()) {
  const weeklySummary = {
    weekId,
    completedTomatoes: weekEffectiveTomatoes(userId, weekId),
    submittedOrders: dailyCompletedOrderCountInWeek(state, weekId),
    openedCrates: supplyOpenCountInWeek(state, weekId),
    plantedCount: plantedCountInWeek(state, weekId),
    claimedTasks: claimedTaskCountInWeek(state, weekId),
    updatedAt: nowIso()
  };
  state.operationStats.weeklySummary = weeklySummary;
  state.operationStats.taskHistory = normalizeOperationStats(state.operationStats, weekId).taskHistory;
  state.operationStats.streak = normalizeOperationStats(state.operationStats, weekId).streak;
  const checkInPreview = checkInStreakPreview(state.operationStats, dateKey);
  return {
    ok: true,
    initialized: true,
    date: dateKey,
    weekId,
    streak: {
      ...state.operationStats.streak,
      alreadyCheckedInToday: state.operationStats.streak.lastActiveDate === dateKey,
      nextCurrentDays: checkInPreview.currentDays
    },
    weeklySummary,
    weeklyGoal: {
      percent: weeklyGoalProgress(weeklySummary),
      targets: {
        completedTomatoes: 5,
        submittedOrders: 3,
        openedCrates: 1,
        plantedCount: 3,
        claimedTasks: 3
      }
    },
    recentTaskHistory: state.operationStats.taskHistory.slice(0, 10)
  };
}

function emptyOperationSummaryPayload(userId: number) {
  const dateKey = shanghaiDateKey();
  const weekId = shanghaiWeekId();
  const stats = defaultOperationStats(weekId);
  return {
    ok: true,
    initialized: false,
    date: dateKey,
    weekId,
    streak: {
      ...stats.streak,
      alreadyCheckedInToday: false,
      nextCurrentDays: 1
    },
    weeklySummary: {
      ...stats.weeklySummary,
      completedTomatoes: weekEffectiveTomatoes(userId, weekId)
    },
    weeklyGoal: {
      percent: 0,
      targets: {
        completedTomatoes: 5,
        submittedOrders: 3,
        openedCrates: 1,
        plantedCount: 3,
        claimedTasks: 3
      }
    },
    recentTaskHistory: []
  };
}

function planningGoalStatus(current: number, target: number) {
  const safeCurrent = Math.round(Math.max(0, current) * 100) / 100;
  const safeTarget = Math.round(Math.max(0, target) * 100) / 100;
  if (safeTarget <= 0) {
    return {
      current: safeCurrent,
      target: safeTarget,
      percent: 0,
      status: "empty",
      label: "未设置"
    };
  }
  if (safeCurrent >= safeTarget) {
    return {
      current: safeCurrent,
      target: safeTarget,
      percent: 100,
      status: "completed",
      label: "已完成"
    };
  }
  if (safeCurrent > 0) {
    return {
      current: safeCurrent,
      target: safeTarget,
      percent: Math.min(100, Math.round(safeCurrent / safeTarget * 100)),
      status: "in_progress",
      label: "进行中"
    };
  }
  return {
    current: safeCurrent,
    target: safeTarget,
    percent: 0,
    status: "pending",
    label: "未开始"
  };
}

function planningCycleProgress(metrics: {
  tomatoes: number;
  orders: number;
  plantings: number;
  harvests: number;
}, targets: {
  tomatoTarget: number;
  orderTarget: number;
  plantingTarget: number;
  harvestTarget: number;
}) {
  const tomato = planningGoalStatus(metrics.tomatoes, targets.tomatoTarget);
  const order = planningGoalStatus(metrics.orders, targets.orderTarget);
  const planting = planningGoalStatus(metrics.plantings, targets.plantingTarget);
  const harvest = planningGoalStatus(metrics.harvests, targets.harvestTarget);
  const items = [tomato, order, planting, harvest];
  const activeItems = items.filter((item) => item.target > 0);
  const percent = activeItems.length
    ? Math.round(activeItems.reduce((sum, item) => sum + item.percent, 0) / activeItems.length)
    : 0;
  const status = !activeItems.length
    ? "empty"
    : activeItems.every((item) => item.status === "completed")
      ? "completed"
      : activeItems.some((item) => item.status === "in_progress" || item.status === "completed")
        ? "in_progress"
        : "pending";
  const statusLabel = status === "completed"
    ? "已完成"
    : status === "in_progress"
      ? "进行中"
      : status === "pending"
        ? "未开始"
        : "未设置";
  return {
    tomato,
    order,
    planting,
    harvest,
    percent,
    status,
    statusLabel
  };
}

function planningStatePayload(userId: number, state: GameState, dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()) {
  const normalizedPlanning = normalizePlanningState(state.planning, dateKey, weekId);
  state.planning.daily = normalizedPlanning.daily;
  state.planning.weekly = normalizedPlanning.weekly;
  const dailyMetrics = {
    tomatoes: todayEffectiveTomatoes(userId, dateKey),
    orders: state.dailyOrders.completedOrderIds.includes(dailyBasicOrderId(dateKey)) ? 1 : 0,
    plantings: plantedCountOnDate(state, dateKey),
    harvests: plantingHarvestedCountOnDate(state, dateKey)
  };
  const weeklyMetrics = {
    tomatoes: weekEffectiveTomatoes(userId, weekId),
    orders: dailyCompletedOrderCountInWeek(state, weekId),
    plantings: plantedCountInWeek(state, weekId),
    harvests: plantingHarvestedCountInWeek(state, weekId)
  };
  return {
    ok: true,
    initialized: true,
    date: dateKey,
    weekId,
    planning: normalizedPlanning,
    progress: {
      daily: planningCycleProgress(dailyMetrics, normalizedPlanning.daily),
      weekly: planningCycleProgress(weeklyMetrics, normalizedPlanning.weekly)
    },
    metrics: {
      daily: dailyMetrics,
      weekly: weeklyMetrics
    }
  };
}

function emptyPlanningPayload(userId: number, dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()) {
  const planning = defaultPlanning(dateKey, weekId);
  const dailyMetrics = {
    tomatoes: todayEffectiveTomatoes(userId, dateKey),
    orders: 0,
    plantings: 0,
    harvests: 0
  };
  const weeklyMetrics = {
    tomatoes: weekEffectiveTomatoes(userId, weekId),
    orders: 0,
    plantings: 0,
    harvests: 0
  };
  return {
    ok: true,
    initialized: false,
    date: dateKey,
    weekId,
    planning,
    progress: {
      daily: planningCycleProgress(dailyMetrics, planning.daily),
      weekly: planningCycleProgress(weeklyMetrics, planning.weekly)
    },
    metrics: {
      daily: dailyMetrics,
      weekly: weeklyMetrics
    }
  };
}

function planningTemplatesPayload(state: GameState | null) {
  if (!state) {
    return {
      ok: true,
      initialized: false,
      templates: defaultPlanningTemplates()
    };
  }
  state.planningTemplates = normalizePlanningTemplatesState(state.planningTemplates);
  return {
    ok: true,
    initialized: true,
    templates: state.planningTemplates
  };
}

function findPlanningTemplate(state: GameState, scope: PlanningTemplateScope, templateId: string) {
  return state.planningTemplates[scope].find((item) => item.id === templateId) ?? null;
}

function weekRangeForReport(weekId: string) {
  const [yearText, weekText] = weekId.split("-");
  const year = Number(yearText);
  const week = Number(weekText);
  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    const today = shanghaiDateKey();
    return { startDate: today, endDate: today };
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Weekday + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startDate: shanghaiDateKey(monday),
    endDate: shanghaiDateKey(sunday)
  };
}

function weeklyReportScore(summary: {
  completedTomatoes: number;
  submittedOrders: number;
  plantedCount: number;
  harvestedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  const targets = {
    completedTomatoes: 5,
    submittedOrders: 3,
    plantedCount: 3,
    harvestedCount: 3,
    openedCrates: 1,
    claimedTasks: 3,
    checkInDays: 5
  };
  const ratios = [
    Math.min(1, summary.completedTomatoes / targets.completedTomatoes),
    Math.min(1, summary.submittedOrders / targets.submittedOrders),
    Math.min(1, summary.plantedCount / targets.plantedCount),
    Math.min(1, summary.harvestedCount / targets.harvestedCount),
    Math.min(1, summary.openedCrates / targets.openedCrates),
    Math.min(1, summary.claimedTasks / targets.claimedTasks),
    Math.min(1, summary.checkInDays / targets.checkInDays)
  ];
  const percent = Math.round(ratios.reduce((sum, item) => sum + item, 0) / ratios.length * 100);
  if (percent >= 85) return { level: "excellent", label: "高效经营", percent };
  if (percent >= 60) return { level: "active", label: "活跃经营", percent };
  if (percent >= 25) return { level: "steady", label: "稳定经营", percent };
  return { level: "quiet", label: "轻量经营", percent };
}

function weeklyReportHighlights(summary: {
  completedTomatoes: number;
  focusMinutes: number;
  submittedOrders: number;
  plantedCount: number;
  harvestedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}, state: GameState | null) {
  const highlights: string[] = [];
  if (summary.completedTomatoes > 0) highlights.push(`本周完成 ${summary.completedTomatoes} 颗有效番茄`);
  if (summary.focusMinutes > 0) highlights.push(`累计专注约 ${summary.focusMinutes} 分钟`);
  if (summary.checkInDays > 0) highlights.push(`完成 ${summary.checkInDays} 天经营打卡`);
  if (summary.claimedTasks > 0) highlights.push(`领取 ${summary.claimedTasks} 个农场任务奖励`);
  if (summary.submittedOrders > 0) highlights.push(`提交 ${summary.submittedOrders} 个每日订单`);
  if (summary.plantedCount || summary.harvestedCount) highlights.push(`完成 ${summary.plantedCount} 次播种、${summary.harvestedCount} 次收获`);
  if (summary.openedCrates > 0) highlights.push(`开启 ${summary.openedCrates} 次补给箱`);
  if (state && state.operationStats.streak.currentDays > 1) highlights.push(`当前连续经营 ${state.operationStats.streak.currentDays} 天`);
  return highlights.slice(0, 6);
}

function weeklyReportSuggestions(summary: {
  completedTomatoes: number;
  submittedOrders: number;
  plantedCount: number;
  harvestedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  const suggestions: string[] = [];
  if (summary.completedTomatoes < 5) suggestions.push("明天可以先完成 1 颗有效番茄，为本周经营继续添一笔收成。");
  if (summary.submittedOrders < 1) suggestions.push("如果仓库里有基础经营番茄，可以试着提交一次每日订单。");
  if (summary.plantedCount < 1) suggestions.push("可以去种植中心播下一颗普通番茄种子，让基地保持成长。");
  if (summary.harvestedCount < summary.plantedCount) suggestions.push("记得回到种植中心看看成熟地块，手动收获会更有成就感。");
  if (summary.openedCrates < 1) suggestions.push("专注水晶足够时，可以开启 1 次补给箱补充农场物资。");
  if (summary.claimedTasks < 1) suggestions.push("完成农场任务板目标后，记得手动领取任务奖励。");
  if (summary.checkInDays < 3) suggestions.push("每天打开基地打卡一次，可以慢慢积累连续经营记录。");
  return suggestions.length ? suggestions.slice(0, 4) : ["这周经营节奏很好，可以继续保持番茄、订单和种植的循环。"];
}

function weeklyReportPayload(userId: number, state: GameState | null, weekId = shanghaiWeekId()) {
  const summary = {
    completedTomatoes: weekEffectiveTomatoes(userId, weekId),
    focusMinutes: weekFocusMinutes(userId, weekId),
    submittedOrders: state ? dailyCompletedOrderCountInWeek(state, weekId) : 0,
    plantedCount: state ? plantedCountInWeek(state, weekId) : 0,
    harvestedCount: state ? plantingHarvestedCountInWeek(state, weekId) : 0,
    openedCrates: state ? supplyOpenCountInWeek(state, weekId) : 0,
    claimedTasks: state ? claimedTaskCountInWeek(state, weekId) : 0,
    checkInDays: state ? checkInDaysInWeek(state, weekId) : 0
  };
  return {
    ok: true,
    initialized: Boolean(state),
    weekId: weekId.replace("-", "-W"),
    range: weekRangeForReport(weekId),
    summary,
    highlights: weeklyReportHighlights(summary, state),
    score: weeklyReportScore(summary),
    suggestions: weeklyReportSuggestions(summary)
  };
}

function monthIdForDate(value = new Date()) {
  return shanghaiDateKey(value).slice(0, 7);
}

function monthRangeFor(monthId: string) {
  const [yearText, monthText] = monthId.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const today = shanghaiDateKey();
    return { startDate: today, endDate: today };
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    startDate: shanghaiDateKey(start),
    endDate: shanghaiDateKey(end)
  };
}

function sameShanghaiMonth(value: string | undefined, monthId: string) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && shanghaiDateKey(date).slice(0, 7) === monthId;
}

function recordBelongsToMonth(record: TomatoRecord, monthId: string) {
  const dateText = String(record.date ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return dateText.slice(0, 7) === monthId;
  }
  return sameShanghaiMonth(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""), monthId);
}

function monthTomatoRecords(userId: number, monthId = monthIdForDate()) {
  return tomatoRecords(userId).filter((record) => recordBelongsToMonth(record, monthId));
}

function monthEffectiveTomatoes(userId: number, monthId = monthIdForDate()) {
  return Math.round(monthTomatoRecords(userId, monthId)
    .reduce((sum, record) => sum + recordWeight(record), 0) * 100) / 100;
}

function monthFocusMinutes(userId: number, monthId = monthIdForDate()) {
  return Math.round(monthTomatoRecords(userId, monthId)
    .reduce((sum, record) => sum + recordFocusMinutes(record), 0));
}

function monthDailyMap(userId: number, state: GameState | null, monthId = monthIdForDate()) {
  const [yearText, monthText] = monthId.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const records = monthTomatoRecords(userId, monthId);
  const tomatoByDate = new Map<string, number>();
  const focusByDate = new Map<string, number>();
  const activityDates = new Set<string>();
  records.forEach((record) => {
    const date = String(record.date ?? "").slice(0, 10);
    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : shanghaiDateKey(new Date(String(record.createdAt ?? record.endTime ?? record.startedAt ?? "")));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey.slice(0, 7) !== monthId) return;
    tomatoByDate.set(dayKey, (tomatoByDate.get(dayKey) || 0) + recordWeight(record));
    focusByDate.set(dayKey, (focusByDate.get(dayKey) || 0) + recordFocusMinutes(record));
  });
  if (state) {
    state.events.forEach((event) => {
      const dayKey = shanghaiDateKey(new Date(event.createdAt));
      if (dayKey.slice(0, 7) !== monthId) return;
      activityDates.add(dayKey);
    });
    state.supply.history.forEach((entry) => {
      const dayKey = shanghaiDateKey(new Date(entry.createdAt));
      if (dayKey.slice(0, 7) === monthId) activityDates.add(dayKey);
    });
    state.operationStats.taskHistory.forEach((entry) => {
      const dayKey = shanghaiDateKey(new Date(entry.claimedAt));
      if (dayKey.slice(0, 7) === monthId) activityDates.add(dayKey);
    });
    state.dailyOrders.completedOrderIds.forEach((orderId) => {
      const dayKey = orderId.replace("daily_basic_", "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey) && dayKey.slice(0, 7) === monthId) activityDates.add(dayKey);
    });
  }
  const days: Array<{
    date: string;
    completedTomatoes: number;
    focusMinutes: number;
    active: boolean;
    level: number;
  }> = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${monthId}-${String(day).padStart(2, "0")}`;
    const completedTomatoes = Math.round((tomatoByDate.get(date) || 0) * 100) / 100;
    const focusMinutes = Math.round((focusByDate.get(date) || 0) * 100) / 100;
    const active = completedTomatoes > 0 || focusMinutes > 0 || activityDates.has(date);
    const totalScore = completedTomatoes + focusMinutes / 60 + (activityDates.has(date) ? 1 : 0);
    let level = 0;
    if (totalScore >= 3) level = 3;
    else if (totalScore >= 1.5) level = 2;
    else if (active) level = 1;
    days.push({ date, completedTomatoes, focusMinutes, active, level });
  }
  return days;
}

function monthlyReportHighlights(summary: {
  completedTomatoes: number;
  focusMinutes: number;
  activeDays: number;
  submittedOrders: number;
  plantedCount: number;
  harvestedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  const highlights: string[] = [];
  if (summary.completedTomatoes > 0) highlights.push(`本月完成 ${summary.completedTomatoes} 颗有效番茄`);
  if (summary.activeDays > 0) highlights.push(`本月共有 ${summary.activeDays} 天保持经营活跃`);
  if (summary.focusMinutes > 0) highlights.push(`累计专注约 ${summary.focusMinutes} 分钟`);
  if (summary.submittedOrders > 0) highlights.push(`完成 ${summary.submittedOrders} 个每日订单`);
  if (summary.plantedCount || summary.harvestedCount) highlights.push(`完成 ${summary.plantedCount} 次播种、${summary.harvestedCount} 次收获`);
  if (summary.openedCrates > 0) highlights.push(`开启 ${summary.openedCrates} 次补给箱`);
  if (summary.claimedTasks > 0) highlights.push(`领取 ${summary.claimedTasks} 个任务奖励`);
  if (summary.checkInDays > 0) highlights.push(`完成 ${summary.checkInDays} 天经营打卡`);
  return highlights.slice(0, 6);
}

function monthlyReportSuggestions(summary: {
  completedTomatoes: number;
  activeDays: number;
  submittedOrders: number;
  plantedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  const suggestions: string[] = [];
  if (summary.completedTomatoes < 20) suggestions.push("这个月还可以继续完成番茄记录，让基地收成更完整。");
  if (summary.activeDays < 10) suggestions.push("可以试着保持更多活跃日，让月报日历更亮一些。");
  if (summary.submittedOrders < 3) suggestions.push("有基础经营番茄时，不妨再提交几次每日订单。");
  if (summary.plantedCount < 3) suggestions.push("去种植中心补几次播种，经营循环会更完整。");
  if (summary.openedCrates < 1) suggestions.push("专注水晶够用时，可以开启一次补给补充收藏。");
  if (summary.claimedTasks < 3) suggestions.push("完成任务板目标后记得领取奖励，月报会更有反馈。");
  if (summary.checkInDays < 10) suggestions.push("每天回来打卡一次，连续经营会慢慢积累起来。");
  return suggestions.length ? suggestions.slice(0, 4) : ["这个月经营节奏不错，可以继续保持番茄、订单、种植和任务的循环。"];
}

function monthlyReportScore(summary: {
  completedTomatoes: number;
  focusMinutes: number;
  activeDays: number;
  submittedOrders: number;
  plantedCount: number;
  harvestedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  const targets = {
    completedTomatoes: 20,
    focusMinutes: 600,
    activeDays: 12,
    submittedOrders: 4,
    plantedCount: 6,
    harvestedCount: 6,
    openedCrates: 2,
    claimedTasks: 6,
    checkInDays: 10
  };
  const ratios = [
    Math.min(1, summary.completedTomatoes / targets.completedTomatoes),
    Math.min(1, summary.focusMinutes / targets.focusMinutes),
    Math.min(1, summary.activeDays / targets.activeDays),
    Math.min(1, summary.submittedOrders / targets.submittedOrders),
    Math.min(1, summary.plantedCount / targets.plantedCount),
    Math.min(1, summary.harvestedCount / targets.harvestedCount),
    Math.min(1, summary.openedCrates / targets.openedCrates),
    Math.min(1, summary.claimedTasks / targets.claimedTasks),
    Math.min(1, summary.checkInDays / targets.checkInDays)
  ];
  const percent = Math.round(ratios.reduce((sum, item) => sum + item, 0) / ratios.length * 100);
  if (percent >= 85) return { level: "excellent", label: "高效经营", percent };
  if (percent >= 60) return { level: "active", label: "活跃经营", percent };
  if (percent >= 25) return { level: "steady", label: "稳定经营", percent };
  return { level: "quiet", label: "轻量经营", percent };
}

function monthlyReportPayload(userId: number, state: GameState | null, monthId = monthIdForDate()) {
  const summary = {
    completedTomatoes: monthEffectiveTomatoes(userId, monthId),
    focusMinutes: monthFocusMinutes(userId, monthId),
    activeDays: monthDailyMap(userId, state, monthId).filter((day) => day.active).length,
    submittedOrders: state ? state.dailyOrders.completedOrderIds.filter((orderId) => orderId.startsWith(`daily_basic_${monthId}`)).length : 0,
    plantedCount: state ? state.events.filter((event) => event.type === "seed_planted" && sameShanghaiMonth(event.createdAt, monthId)).length : 0,
    harvestedCount: state ? state.events.filter((event) => event.type === "planting_harvested" && sameShanghaiMonth(event.createdAt, monthId)).length : 0,
    openedCrates: state ? state.supply.history.filter((entry) => sameShanghaiMonth(entry.createdAt, monthId)).length : 0,
    claimedTasks: state ? state.operationStats.taskHistory.filter((entry) => sameShanghaiMonth(entry.claimedAt, monthId)).length : 0,
    checkInDays: state ? state.events.filter((event) => event.type === "operation_check_in" && sameShanghaiMonth(event.createdAt, monthId)).length : 0
  };
  const calendar = monthDailyMap(userId, state, monthId);
  return {
    ok: true,
    initialized: Boolean(state),
    monthId,
    range: monthRangeFor(monthId),
    summary,
    calendar,
    score: monthlyReportScore(summary),
    highlights: monthlyReportHighlights(summary),
    suggestions: monthlyReportSuggestions(summary)
  };
}

function achievementCatalog() {
  return [
    {
      achievementId: "first_tomato",
      name: "第一颗番茄",
      description: "完成至少 1 颗有效番茄。",
      category: "focus",
      target: 1,
      detail: "这是番茄基地经营的起点，第一颗番茄会把整套经营循环真正点亮。"
    },
    {
      achievementId: "ten_tomatoes",
      name: "十颗番茄",
      description: "累计完成 10 颗有效番茄。",
      category: "focus",
      target: 10,
      detail: "你已经开始形成稳定的专注积累，基地里的收成开始有了规模。"
    },
    {
      achievementId: "hundred_tomatoes",
      name: "百颗番茄",
      description: "累计完成 100 颗有效番茄。",
      category: "focus",
      target: 100,
      detail: "这是长期经营的重要里程碑，说明番茄基地已经进入持续成长阶段。"
    },
    {
      achievementId: "weekly_farmer",
      name: "稳定农场主",
      description: "单周完成 5 颗有效番茄。",
      category: "weekly",
      target: 5,
      detail: "单周完成稳定收成，说明你已经把经营节奏和学习节奏慢慢连起来了。"
    },
    {
      achievementId: "monthly_operator",
      name: "月度经营者",
      description: "本月活跃天数达到 7 天。",
      category: "monthly",
      target: 7,
      detail: "这代表你不只是偶尔回来看看，而是在认真地陪着基地一起运转。"
    },
    {
      achievementId: "first_order",
      name: "订单新手",
      description: "累计提交 1 次订单。",
      category: "operation",
      target: 1,
      detail: "第一次把经营番茄交付出去，番茄基地开始具备完整的经营回路。"
    },
    {
      achievementId: "first_supply",
      name: "补给体验者",
      description: "累计开启 1 次补给箱。",
      category: "collection",
      target: 1,
      detail: "你已经开始收集种子和农场物资，基地的收藏感也慢慢长出来了。"
    },
    {
      achievementId: "first_planting",
      name: "播种开始",
      description: "累计播种 1 次。",
      category: "farm",
      target: 1,
      detail: "第一次播种意味着经营系统真正开始运转，基地从这里进入成长循环。"
    },
    {
      achievementId: "showcase_builder",
      name: "展示基地",
      description: "至少设置过 1 个 showcase 展示项。",
      category: "collection",
      target: 1,
      detail: "你开始把收藏摆进自己的基地首页，番茄基地第一次有了属于自己的样子。"
    },
    {
      achievementId: "streak_three",
      name: "连续经营",
      description: "连续经营达到 3 天。",
      category: "operation",
      target: 3,
      detail: "连续三天回来经营，说明这座基地已经开始和你的日常节奏连在一起。"
    }
  ];
}

function achievementProgress(userId: number, state: GameState | null) {
  const monthId = monthIdForDate();
  const weekId = shanghaiWeekId();
  const tomatoes = tomatoRecords(userId);
  const totalTomatoes = tomatoes.reduce((sum, record) => sum + recordWeight(record), 0);
  const totalOrders = state ? state.idempotency.completedDailyOrderIds.length : 0;
  const totalSupply = state ? state.supply.history.length : 0;
  const plantedTotal = state ? state.events.filter((event) => event.type === "seed_planted").length : 0;
  const showcase = state ? showcaseStatePayload(state).showcase : null;
  const showcaseCount = showcase && (
    Boolean(showcase.title?.valid)
    || Boolean(showcase.partner?.valid)
    || Object.values(showcase.decorationSlots).some((slot) => Boolean(slot?.valid))
  ) ? 1 : 0;
  const monthlyActiveDays = monthlyReportPayload(userId, state, monthId).summary.activeDays;
  const currentWeekTomatoes = weekEffectiveTomatoes(userId, weekId);
  const streakDays = state?.operationStats.streak.currentDays ?? 0;
  const catalog = achievementCatalog();
  const achievements = catalog.map((item) => {
    let progress = 0;
    let unlocked = false;
    switch (item.achievementId) {
      case "first_tomato":
        progress = totalTomatoes;
        unlocked = totalTomatoes >= item.target;
        break;
      case "ten_tomatoes":
        progress = totalTomatoes;
        unlocked = totalTomatoes >= item.target;
        break;
      case "hundred_tomatoes":
        progress = totalTomatoes;
        unlocked = totalTomatoes >= item.target;
        break;
      case "weekly_farmer":
        progress = currentWeekTomatoes;
        unlocked = currentWeekTomatoes >= item.target;
        break;
      case "monthly_operator":
        progress = monthlyActiveDays;
        unlocked = monthlyActiveDays >= item.target;
        break;
      case "first_order":
        progress = totalOrders;
        unlocked = totalOrders >= item.target;
        break;
      case "first_supply":
        progress = totalSupply;
        unlocked = totalSupply >= item.target;
        break;
      case "first_planting":
        progress = plantedTotal;
        unlocked = plantedTotal >= item.target;
        break;
      case "showcase_builder":
        progress = showcaseCount;
        unlocked = showcaseCount >= item.target;
        break;
      case "streak_three":
        progress = streakDays;
        unlocked = streakDays >= item.target;
        break;
      default:
        progress = 0;
        unlocked = false;
    }
    return {
      achievementId: item.achievementId,
      name: item.name,
      description: item.description,
      category: item.category,
      unlocked,
      progress: Math.min(item.target, Math.max(0, Math.round(progress * 100) / 100)),
      target: item.target
    };
  });
  return {
    ok: true,
    achievements,
    categories: catalog.reduce((acc, item) => {
      const category = item.category;
      if (!acc.includes(category)) acc.push(category);
      return acc;
    }, [] as string[]),
    summary: {
      unlockedCount: achievements.filter((item) => item.unlocked).length,
      totalCount: achievements.length
    }
  };
}

function previousMonthId(monthId: string) {
  const [yearText, monthText] = monthId.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthIdForDate();
  const value = new Date(Date.UTC(year, month - 1, 1));
  value.setUTCMonth(value.getUTCMonth() - 1);
  return shanghaiDateKey(value).slice(0, 7);
}

function recentMonthIds(count = 6, currentMonthId = monthIdForDate()) {
  const months: string[] = [];
  let cursor = currentMonthId;
  for (let index = 0; index < count; index += 1) {
    months.push(cursor);
    cursor = previousMonthId(cursor);
  }
  return months;
}

function monthlyMemorySummary(summary: {
  completedTomatoes: number;
  focusMinutes: number;
  activeDays: number;
  submittedOrders: number;
  plantedCount: number;
  openedCrates: number;
  claimedTasks: number;
  checkInDays: number;
}) {
  if (summary.completedTomatoes <= 0 && summary.focusMinutes <= 0 && summary.activeDays <= 0
    && summary.submittedOrders <= 0 && summary.plantedCount <= 0 && summary.openedCrates <= 0
    && summary.claimedTasks <= 0 && summary.checkInDays <= 0) {
    return "这个月还没有留下经营记录。";
  }
  const parts: string[] = [];
  if (summary.completedTomatoes > 0) parts.push(`完成 ${summary.completedTomatoes} 颗有效番茄`);
  if (summary.activeDays > 0) parts.push(`活跃 ${summary.activeDays} 天`);
  if (summary.submittedOrders > 0) parts.push(`提交 ${summary.submittedOrders} 次订单`);
  if (summary.plantedCount > 0) parts.push(`播种 ${summary.plantedCount} 次`);
  if (summary.openedCrates > 0) parts.push(`开启 ${summary.openedCrates} 次补给`);
  if (summary.claimedTasks > 0) parts.push(`领取 ${summary.claimedTasks} 个任务`);
  if (parts.length === 0 && summary.focusMinutes > 0) parts.push(`累计专注 ${summary.focusMinutes} 分钟`);
  return `这个月你${parts.slice(0, 3).join("，")}。`;
}

function activeDateSet(userId: number, state: GameState | null) {
  const dates = new Set<string>();
  tomatoRecords(userId).forEach((record) => {
    const dateText = String(record.date ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      dates.add(dateText);
      return;
    }
    const fallback = String(record.createdAt ?? record.endTime ?? record.startedAt ?? "");
    const date = new Date(fallback);
    if (!Number.isNaN(date.getTime())) dates.add(shanghaiDateKey(date));
  });
  if (state) {
    state.events.forEach((event) => {
      const date = new Date(event.createdAt);
      if (!Number.isNaN(date.getTime())) dates.add(shanghaiDateKey(date));
    });
    state.supply.history.forEach((entry) => {
      const date = new Date(entry.createdAt);
      if (!Number.isNaN(date.getTime())) dates.add(shanghaiDateKey(date));
    });
    state.operationStats.taskHistory.forEach((entry) => {
      const date = new Date(entry.claimedAt);
      if (!Number.isNaN(date.getTime())) dates.add(shanghaiDateKey(date));
    });
  }
  return dates;
}

function firstTomatoMilestone(userId: number) {
  const first = tomatoRecords(userId)
    .map((record) => {
      const rawDate = String(record.date ?? "");
      let date: string | null = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      if (!date) {
        const fallback = new Date(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""));
        if (!Number.isNaN(fallback.getTime())) date = shanghaiDateKey(fallback);
      }
      return {
        weight: recordWeight(record),
        date
      };
    })
    .filter((item) => item.weight > 0 && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  if (!first?.date) return null;
  return {
    id: "first_tomato",
    type: "focus",
    title: "完成第一颗番茄",
    description: "你完成了第一颗有效番茄。",
    date: first.date,
    icon: "tomato"
  };
}

function cumulativeTomatoThresholdDate(userId: number, target: number) {
  let total = 0;
  const sorted = tomatoRecords(userId)
    .map((record) => {
      const rawDate = String(record.date ?? "");
      let date: string | null = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      if (!date) {
        const fallback = new Date(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""));
        if (!Number.isNaN(fallback.getTime())) date = shanghaiDateKey(fallback);
      }
      return {
        weight: recordWeight(record),
        date
      };
    })
    .filter((item) => item.weight > 0 && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const item of sorted) {
    total += item.weight;
    if (total >= target) return item.date;
  }
  return null;
}

function weekTomatoThresholdDate(userId: number, weekId: string, target: number) {
  let total = 0;
  const sorted = weekTomatoRecords(userId, weekId)
    .map((record) => {
      const rawDate = String(record.date ?? "");
      let date: string | null = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      if (!date) {
        const fallback = new Date(String(record.createdAt ?? record.endTime ?? record.startedAt ?? ""));
        if (!Number.isNaN(fallback.getTime())) date = shanghaiDateKey(fallback);
      }
      return {
        weight: recordWeight(record),
        date
      };
    })
    .filter((item) => item.weight > 0 && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const item of sorted) {
    total += item.weight;
    if (total >= target) return item.date;
  }
  return null;
}

function monthActiveThresholdDate(userId: number, state: GameState | null, monthId: string, target: number) {
  const activeDates = monthDailyMap(userId, state, monthId)
    .filter((item) => item.active)
    .map((item) => item.date)
    .sort();
  return activeDates.length >= target ? activeDates[target - 1] : null;
}

function firstEventMilestone(state: GameState | null, matcher: (event: GameState["events"][number]) => boolean, payload: {
  id: string;
  type: string;
  title: string;
  description: string;
  icon: string;
}) {
  if (!state) return null;
  const found = [...state.events]
    .filter(matcher)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if (!found?.createdAt) return null;
  const date = new Date(found.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    ...payload,
    date: shanghaiDateKey(date)
  };
}

function firstOrderMilestone(state: GameState | null) {
  if (!state) return null;
  const firstOrderId = [...state.dailyOrders.completedOrderIds]
    .filter((orderId) => /^daily_basic_\d{4}-\d{2}-\d{2}$/.test(orderId))
    .sort()[0];
  if (!firstOrderId) return null;
  return {
    id: "first_order",
    type: "operation",
    title: "第一次提交订单",
    description: "你完成了第一次每日订单交付。",
    date: firstOrderId.replace("daily_basic_", ""),
    icon: "order"
  };
}

function firstAchievementMilestone(userId: number, state: GameState | null) {
  const achievements = achievementDetailsPayload(userId, state);
  const firstUnlocked = achievements
    .filter((item) => item.unlocked && item.firstUnlockedAt)
    .sort((a, b) => String(a.firstUnlockedAt).localeCompare(String(b.firstUnlockedAt)))[0];
  if (!firstUnlocked?.firstUnlockedAt) return null;
  return {
    id: "first_achievement",
    type: "achievement",
    title: "第一次点亮成就",
    description: `点亮成就「${firstUnlocked.name}」。`,
    date: String(firstUnlocked.firstUnlockedAt).slice(0, 10),
    icon: "badge"
  };
}

function achievementDetailsPayload(userId: number, state: GameState | null) {
  const progressPayload = achievementProgress(userId, state);
  const catalog = achievementCatalog();
  const totalTomatoes = Math.round(tomatoRecords(userId).reduce((sum, record) => sum + recordWeight(record), 0) * 100) / 100;
  const totalFocusMinutes = Math.round(tomatoRecords(userId).reduce((sum, record) => sum + recordFocusMinutes(record), 0));
  const totalOrders = state ? state.idempotency.completedDailyOrderIds.length : 0;
  const totalSupply = state ? state.supply.history.length : 0;
  const totalPlanting = state ? state.events.filter((event) => event.type === "seed_planted").length : 0;
  const showcase = state ? showcaseStatePayload(state).showcase : null;
  const showcaseCount = showcase && (
    Boolean(showcase.title?.valid)
    || Boolean(showcase.partner?.valid)
    || Object.values(showcase.decorationSlots).some((slot) => Boolean(slot?.valid))
  ) ? 1 : 0;
  const streakDays = state?.operationStats.streak.currentDays ?? 0;
  const monthId = monthIdForDate();
  const weeklyWeekId = shanghaiWeekId();
  const monthlyActiveDays = monthlyReportPayload(userId, state, monthId).summary.activeDays;
  const currentWeekTomatoes = weekEffectiveTomatoes(userId, weeklyWeekId);
  return progressPayload.achievements.map((achievement) => {
    const meta = catalog.find((item) => item.achievementId === achievement.achievementId);
    let relatedStats: Record<string, number | string> = {};
    let firstUnlockedAt: string | null = null;
    switch (achievement.achievementId) {
      case "first_tomato":
        relatedStats = {
          totalTomatoes,
          totalFocusMinutes
        };
        firstUnlockedAt = cumulativeTomatoThresholdDate(userId, 1);
        break;
      case "ten_tomatoes":
        relatedStats = {
          totalTomatoes,
          totalFocusMinutes
        };
        firstUnlockedAt = cumulativeTomatoThresholdDate(userId, 10);
        break;
      case "hundred_tomatoes":
        relatedStats = {
          totalTomatoes,
          totalFocusMinutes
        };
        firstUnlockedAt = cumulativeTomatoThresholdDate(userId, 100);
        break;
      case "weekly_farmer":
        relatedStats = {
          currentWeekTomatoes
        };
        firstUnlockedAt = weekTomatoThresholdDate(userId, weeklyWeekId, 5);
        break;
      case "monthly_operator":
        relatedStats = {
          monthlyActiveDays
        };
        firstUnlockedAt = monthActiveThresholdDate(userId, state, monthId, 7);
        break;
      case "first_order":
        relatedStats = {
          totalOrders
        };
        firstUnlockedAt = firstOrderMilestone(state)?.date ?? null;
        break;
      case "first_supply":
        relatedStats = {
          totalSupply
        };
        firstUnlockedAt = firstEventMilestone(state, (event) => event.type === "supply_opened", {
          id: "first_supply",
          type: "collection",
          title: "第一次开启补给",
          description: "你第一次开启了补给箱。",
          icon: "crate"
        })?.date ?? null;
        break;
      case "first_planting":
        relatedStats = {
          totalPlanting
        };
        firstUnlockedAt = firstEventMilestone(state, (event) => event.type === "seed_planted", {
          id: "first_planting",
          type: "farm",
          title: "第一次播种",
          description: "你完成了第一次播种。",
          icon: "seed"
        })?.date ?? null;
        break;
      case "showcase_builder":
        relatedStats = {
          showcaseCount
        };
        firstUnlockedAt = firstEventMilestone(state, (event) => event.type === "showcase_updated" && Boolean(event.itemId), {
          id: "first_showcase",
          type: "showcase",
          title: "第一次设置展示",
          description: "你第一次把收藏摆进了自己的基地。",
          icon: "showcase"
        })?.date ?? null;
        break;
      case "streak_three":
        relatedStats = {
          streakDays
        };
        break;
      default:
        relatedStats = {};
    }
    return {
      ...achievement,
      detail: meta?.detail ?? "继续经营基地，这项成就会在合适的时候自然点亮。",
      relatedStats,
      firstUnlockedAt: achievement.unlocked ? firstUnlockedAt : null
    };
  });
}

function monthlyMemoriesPayload(userId: number, state: GameState | null, currentMonthId = monthIdForDate()) {
  return recentMonthIds(6, currentMonthId).map((monthId) => {
    const payload = monthlyReportPayload(userId, state, monthId);
    return {
      monthId,
      label: `${monthId.slice(0, 4)} 年 ${monthId.slice(5, 7).replace(/^0/, "")} 月`,
      completedTomatoes: payload.summary.completedTomatoes,
      focusMinutes: payload.summary.focusMinutes,
      activeDays: payload.summary.activeDays,
      summary: monthlyMemorySummary(payload.summary)
    };
  });
}

function memoryBookPayload(userId: number, state: GameState | null) {
  const achievementDetails = achievementDetailsPayload(userId, state);
  const milestones = [
    firstTomatoMilestone(userId),
    firstEventMilestone(state, (event) => event.type === "seed_planted", {
      id: "first_planting",
      type: "farm",
      title: "第一次播种",
      description: "你在种植中心播下了第一颗种子。",
      icon: "seed"
    }),
    firstOrderMilestone(state),
    firstEventMilestone(state, (event) => event.type === "supply_opened", {
      id: "first_supply",
      type: "collection",
      title: "第一次开启补给",
      description: "你打开了第一只农场补给箱。",
      icon: "crate"
    }),
    firstEventMilestone(state, (event) => event.type === "showcase_updated" && Boolean(event.slotId) && Boolean(event.itemId), {
      id: "first_showcase_decoration",
      type: "showcase",
      title: "第一次展示装饰",
      description: "你把第一件装饰摆进了基地首页。",
      icon: "decoration"
    }),
    firstEventMilestone(state, (event) => event.type === "showcase_updated" && Boolean(event.itemId) && !event.slotId && Boolean(catalogItemByTypeAndId("partner", String(event.itemId))), {
      id: "first_showcase_partner",
      type: "showcase",
      title: "第一次展示伙伴",
      description: "你为基地设置了第一位展示伙伴。",
      icon: "partner"
    }),
    firstEventMilestone(state, (event) => event.type === "showcase_updated" && Boolean(event.itemId) && !event.slotId && Boolean(catalogItemByTypeAndId("title", String(event.itemId))), {
      id: "first_showcase_title",
      type: "showcase",
      title: "第一次展示称号",
      description: "你第一次把称号挂到了基地资料卡上。",
      icon: "title"
    }),
    firstEventMilestone(state, (event) => event.type === "task_claimed", {
      id: "first_task_claim",
      type: "task",
      title: "第一次完成每日任务",
      description: "你领取了第一份农场任务奖励。",
      icon: "task"
    }),
    firstEventMilestone(state, (event) => event.type === "operation_check_in", {
      id: "first_check_in",
      type: "operation",
      title: "第一次经营打卡",
      description: "你完成了第一次今日经营打卡。",
      icon: "checkin"
    }),
    firstAchievementMilestone(userId, state)
  ]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 20);
  const showcase = state ? showcaseStatePayload(state).showcase : null;
  const currentTitle = showcase?.title?.valid ? showcase.title.name : null;
  const currentPartner = showcase?.partner?.valid ? showcase.partner.name : null;
  const records = tomatoRecords(userId);
  const totalTomatoes = Math.round(records.reduce((sum, record) => sum + recordWeight(record), 0) * 100) / 100;
  const totalFocusMinutes = Math.round(records.reduce((sum, record) => sum + recordFocusMinutes(record), 0));
  const activeDays = activeDateSet(userId, state).size;
  const monthlyMemories = monthlyMemoriesPayload(userId, state);
  const totalOrders = state ? state.idempotency.completedDailyOrderIds.length : 0;
  const totalPlanting = state ? state.events.filter((event) => event.type === "seed_planted").length : 0;
  const totalSupply = state ? state.supply.history.length : 0;
  return {
    ok: true,
    initialized: Boolean(state),
    profile: {
      farmName: state?.profile.farmName ?? "番茄基地",
      currentTitle,
      currentPartner,
      startedAt: state?.initializedAt ? shanghaiDateKey(new Date(state.initializedAt)) : null,
      activeDays,
      totalTomatoes,
      totalFocusMinutes,
      totalOrders,
      totalPlanting,
      totalSupply,
      unlockedAchievements: achievementDetails.filter((item) => item.unlocked).length,
      totalAchievements: achievementDetails.length
    },
    milestones,
    achievementDetails,
    monthlyMemories
  };
}

function taskBoardReward(type: string): DailyOrderReward {
  const rewards: Record<string, DailyOrderReward> = {
    daily_focus: { sunCoins: 10, farmXp: 15, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_order: { sunCoins: 12, farmXp: 15, focusCrystals: 0, basicTomatoSeeds: 1 },
    daily_plant: { sunCoins: 8, farmXp: 10, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_focus_1: { sunCoins: 5, farmXp: 5, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_focus_2: { sunCoins: 8, farmXp: 8, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_focus_3: { sunCoins: 10, farmXp: 10, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_order_1: { sunCoins: 8, farmXp: 8, focusCrystals: 0, basicTomatoSeeds: 1 },
    daily_plant_1: { sunCoins: 6, farmXp: 6, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_plant_2: { sunCoins: 9, farmXp: 9, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_harvest_1: { sunCoins: 8, farmXp: 8, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_supply_1: { sunCoins: 8, farmXp: 8, focusCrystals: 0, basicTomatoSeeds: 0 },
    daily_checkin_1: { sunCoins: 5, farmXp: 5, focusCrystals: 0, basicTomatoSeeds: 0 },
    weekly_focus: { sunCoins: 60, farmXp: 80, focusCrystals: 2, basicTomatoSeeds: 2 },
    weekly_orders: { sunCoins: 45, farmXp: 60, focusCrystals: 1, basicTomatoSeeds: 1 },
    weekly_supply: { sunCoins: 30, farmXp: 50, focusCrystals: 1, basicTomatoSeeds: 1 }
  };
  return { ...(rewards[type] ?? { sunCoins: 0, farmXp: 0, focusCrystals: 0, basicTomatoSeeds: 0 }) };
}

function taskChoiceScore(userId: number, cycleKey: string, key: string) {
  return crypto.createHash("sha256").update(`${userId}:${cycleKey}:${key}`).digest("hex");
}

function pickTaskTemplate(templates: DailyTaskTemplate[], userId: number, cycleKey: string) {
  return [...templates].sort((a, b) => taskChoiceScore(userId, cycleKey, a.key).localeCompare(taskChoiceScore(userId, cycleKey, b.key)))[0] ?? null;
}

function buildDailyTaskMetrics(userId: number, state: GameState, dateKey: string): DailyTaskMetrics {
  return {
    todayEffective: todayEffectiveTomatoes(userId, dateKey),
    dailyOrderCompleted: state.dailyOrders.completedOrderIds.includes(dailyBasicOrderId(dateKey)) ? 1 : 0,
    plantedToday: plantedCountOnDate(state, dateKey),
    harvestedToday: plantingHarvestedCountOnDate(state, dateKey),
    supplyToday: supplyOpenCountOnDate(state, dateKey),
    checkedInToday: state.operationStats.streak.lastActiveDate === dateKey ? 1 : 0
  };
}

function buildDynamicDailyTasks(userId: number, state: GameState, dateKey = shanghaiDateKey()) {
  const metrics = buildDailyTaskMetrics(userId, state, dateKey);
  const basicSeeds = basicSeedInventory(state).count;
  const farmTomatoes = farmTomatoInventory(state).count;
  const activePlots = state.planting.plots.filter((plot) => plot.status !== "empty").length;
  const focusCandidates: DailyTaskTemplate[] = [
    {
      key: "focus_1",
      type: "daily_focus_1",
      title: "完成 1 颗有效番茄",
      description: "完成 1 颗有效番茄，推进今天的经营节奏。",
      required: 1,
      unit: "有效番茄",
      reward: taskBoardReward("daily_focus_1"),
      current: (value: DailyTaskMetrics) => value.todayEffective
    },
    {
      key: "focus_2",
      type: "daily_focus_2",
      title: "完成 2 颗有效番茄",
      description: "让今天的专注节奏再往前推一点，完成 2 颗有效番茄。",
      required: 2,
      unit: "有效番茄",
      reward: taskBoardReward("daily_focus_2"),
      current: (value: DailyTaskMetrics) => value.todayEffective
    },
    {
      key: "focus_3",
      type: "daily_focus_3",
      title: "完成 3 颗有效番茄",
      description: "用更完整的一段专注时间，把今天的番茄收成拉满到 3 颗。",
      required: 3,
      unit: "有效番茄",
      reward: taskBoardReward("daily_focus_3"),
      current: (value: DailyTaskMetrics) => value.todayEffective
    }
  ].filter((item) => item.required <= (state.profile.level >= 3 ? 3 : 2));
  const farmCandidates: DailyTaskTemplate[] = [
    farmTomatoes > 0 || metrics.dailyOrderCompleted > 0
      ? {
          key: "order_1",
          type: "daily_order_1",
          title: "提交 1 次每日订单",
          description: "完成 1 次每日订单，让今天的基地经营形成闭环。",
          required: 1,
          unit: "订单",
          reward: taskBoardReward("daily_order_1"),
          current: (value: DailyTaskMetrics) => value.dailyOrderCompleted
        }
      : null,
    basicSeeds > 0 || metrics.plantedToday > 0
      ? {
          key: "plant_1",
          type: "daily_plant_1",
          title: "播种 1 次番茄",
          description: "在种植中心播种 1 次番茄，让农场继续运转。",
          required: 1,
          unit: "次播种",
          reward: taskBoardReward("daily_plant_1"),
          current: (value: DailyTaskMetrics) => value.plantedToday
        }
      : null,
    basicSeeds >= 2 || metrics.plantedToday >= 2
      ? {
          key: "plant_2",
          type: "daily_plant_2",
          title: "播种 2 次番茄",
          description: "今天把种植节奏再往前推进一步，完成 2 次播种。",
          required: 2,
          unit: "次播种",
          reward: taskBoardReward("daily_plant_2"),
          current: (value: DailyTaskMetrics) => value.plantedToday
        }
      : null,
    activePlots > 0 || metrics.harvestedToday > 0
      ? {
          key: "harvest_1",
          type: "daily_harvest_1",
          title: "收获 1 次番茄",
          description: "去种植中心收获 1 次成熟番茄，把今天的经营节奏闭合起来。",
          required: 1,
          unit: "次收获",
          reward: taskBoardReward("daily_harvest_1"),
          current: (value: DailyTaskMetrics) => value.harvestedToday
        }
      : null,
    state.wallet.focusCrystals >= basicSeedCrate.cost.focusCrystals || metrics.supplyToday > 0
      ? {
          key: "supply_1",
          type: "daily_supply_1",
          title: "开启 1 次补给箱",
          description: "使用专注水晶开启 1 次补给箱，为农场补充一点新物资。",
          required: 1,
          unit: "次补给",
          reward: taskBoardReward("daily_supply_1"),
          current: (value: DailyTaskMetrics) => value.supplyToday
        }
      : null,
    {
      key: "checkin_1",
      type: "daily_checkin_1",
      title: "完成今日经营打卡",
      description: "给今天的番茄基地打个卡，让经营节奏稳稳落地。",
      required: 1,
      unit: "次打卡",
      reward: taskBoardReward("daily_checkin_1"),
      current: (value: DailyTaskMetrics) => value.checkedInToday
    }
  ].filter((item): item is DailyTaskTemplate => Boolean(item));

  const chosen: DailyTaskTemplate[] = [];
  const focusTask = pickTaskTemplate(focusCandidates, userId, `${dateKey}:focus`);
  if (focusTask) chosen.push(focusTask);
  const primaryFarmTask = pickTaskTemplate(farmCandidates, userId, `${dateKey}:farm`);
  if (primaryFarmTask && !chosen.some((item) => item.key === primaryFarmTask.key)) chosen.push(primaryFarmTask);
  const remainingPool = [...farmCandidates, ...focusCandidates].filter((item) => !chosen.some((picked) => picked.key === item.key));
  const tertiaryTask = pickTaskTemplate(remainingPool, userId, `${dateKey}:extra`);
  if (tertiaryTask) chosen.push(tertiaryTask);
  while (chosen.length < 3) {
    const fallback = pickTaskTemplate(focusCandidates.filter((item) => !chosen.some((picked) => picked.key === item.key)), userId, `${dateKey}:fallback:${chosen.length}`);
    if (!fallback) break;
    chosen.push(fallback);
  }
  return chosen.slice(0, 3).map((template) => withTaskProgress(defaultTaskBoardTask(
    taskBoardDailyTaskId(template.type, dateKey),
    "daily",
    template.type,
    template.title,
    template.description,
    template.required,
    template.unit,
    template.reward
  ), template.current(metrics), [], null));
}

function currentForDailyTask(task: TaskBoardTask, metrics: DailyTaskMetrics) {
  const currentByType: Record<string, number> = {
    daily_focus: metrics.todayEffective,
    daily_focus_1: metrics.todayEffective,
    daily_focus_2: metrics.todayEffective,
    daily_focus_3: metrics.todayEffective,
    daily_order: metrics.dailyOrderCompleted,
    daily_order_1: metrics.dailyOrderCompleted,
    daily_plant: metrics.plantedToday,
    daily_plant_1: metrics.plantedToday,
    daily_plant_2: metrics.plantedToday,
    daily_harvest_1: metrics.harvestedToday,
    daily_supply_1: metrics.supplyToday,
    daily_checkin_1: metrics.checkedInToday
  };
  return currentByType[task.type] ?? 0;
}

function withTaskProgress(task: TaskBoardTask, current: number, claimedIds: string[], claimedAt?: string | null): TaskBoardTask {
  const safeCurrent = Math.round(Math.max(0, current) * 100) / 100;
  const claimed = claimedIds.includes(task.taskId);
  return {
    ...task,
    status: claimed ? "claimed" : safeCurrent >= task.progress.required ? "completed" : "available",
    progress: {
      ...task.progress,
      current: safeCurrent
    },
    claimedAt: claimed ? claimedAt ?? task.claimedAt : null
  };
}

function taskBoardState(userId: number, state: GameState, dateKey = shanghaiDateKey(), weekId = shanghaiWeekId()) {
  const claimedIds = Array.from(new Set(state.taskBoard.claimedTaskIds));
  const refreshDailyTasks = state.taskBoard.daily.date !== dateKey || state.taskBoard.daily.tasks.length === 0;
  const storedDailyTasks = refreshDailyTasks
    ? buildDynamicDailyTasks(userId, state, dateKey)
    : state.taskBoard.daily.tasks.map((task) => normalizeTaskBoardTask(task, "daily", claimedIds)).filter((task): task is TaskBoardTask => Boolean(task));
  const existingTasks = [...storedDailyTasks, ...state.taskBoard.weekly.tasks];
  const claimedAtFor = (taskId: string) => existingTasks.find((task) => task.taskId === taskId)?.claimedAt ?? null;
  const dailyMetrics = buildDailyTaskMetrics(userId, state, dateKey);
  const todayEffective = dailyMetrics.todayEffective;
  const weekEffective = weekEffectiveTomatoes(userId, weekId);
  const weeklyOrders = dailyCompletedOrderCountInWeek(state, weekId);
  const weeklySupply = supplyOpenCountInWeek(state, weekId);
  const dailyTasks = storedDailyTasks.map((task) => withTaskProgress(task, currentForDailyTask(task, dailyMetrics), claimedIds, claimedAtFor(task.taskId)));
  const weeklyTasks = [
    withTaskProgress(defaultTaskBoardTask(
      taskBoardWeeklyTaskId("weekly_focus", weekId),
      "weekly",
      "weekly_focus",
      "本周累计 5 颗有效番茄",
      "用一周的真实专注记录推进番茄基地建设。",
      5,
      "有效番茄",
      taskBoardReward("weekly_focus"),
      claimedIds.includes(taskBoardWeeklyTaskId("weekly_focus", weekId))
    ), weekEffective, claimedIds, claimedAtFor(taskBoardWeeklyTaskId("weekly_focus", weekId))),
    withTaskProgress(defaultTaskBoardTask(
      taskBoardWeeklyTaskId("weekly_orders", weekId),
      "weekly",
      "weekly_orders",
      "本周提交 3 次每日订单",
      "持续交付每日订单，稳定经营番茄基地。",
      3,
      "订单",
      taskBoardReward("weekly_orders"),
      claimedIds.includes(taskBoardWeeklyTaskId("weekly_orders", weekId))
    ), weeklyOrders, claimedIds, claimedAtFor(taskBoardWeeklyTaskId("weekly_orders", weekId))),
    withTaskProgress(defaultTaskBoardTask(
      taskBoardWeeklyTaskId("weekly_supply", weekId),
      "weekly",
      "weekly_supply",
      "本周开启 1 次补给箱",
      "使用学习获得的专注水晶开启一次农场补给。",
      1,
      "次补给",
      taskBoardReward("weekly_supply"),
      claimedIds.includes(taskBoardWeeklyTaskId("weekly_supply", weekId))
    ), weeklySupply, claimedIds, claimedAtFor(taskBoardWeeklyTaskId("weekly_supply", weekId)))
  ];
  const completedCount = [...dailyTasks, ...weeklyTasks].filter((task) => task.status === "completed").length;
  const claimedCount = [...dailyTasks, ...weeklyTasks].filter((task) => task.status === "claimed").length;
  return {
    ok: true,
    initialized: true,
    date: dateKey,
    weekId,
    taskBoard: {
      daily: {
        date: dateKey,
        tasks: dailyTasks
      },
      weekly: {
        weekId,
        tasks: weeklyTasks
      },
      claimedTaskIds: claimedIds,
      updatedAt: state.taskBoard.updatedAt
    },
    summary: {
      dailyTotal: dailyTasks.length,
      weeklyTotal: weeklyTasks.length,
      completedCount,
      claimedCount,
      claimableCount: completedCount,
      todayEffectiveTomatoes: todayEffective,
      weekEffectiveTomatoes: weekEffective
    }
  };
}

function emptyTaskBoardPayload(userId: number) {
  const dateKey = shanghaiDateKey();
  const weekId = shanghaiWeekId();
  return {
    ok: true,
    initialized: false,
    date: dateKey,
    weekId,
    taskBoard: defaultTaskBoard(dateKey, weekId),
    summary: {
      dailyTotal: taskBoardDailyTaskTypes.length,
      weeklyTotal: taskBoardWeeklyTaskTypes.length,
      completedCount: 0,
      claimedCount: 0,
      claimableCount: 0,
      todayEffectiveTomatoes: todayEffectiveTomatoes(userId, dateKey),
      weekEffectiveTomatoes: weekEffectiveTomatoes(userId, weekId)
    }
  };
}

function saveTaskBoardSnapshot(state: GameState, payload: ReturnType<typeof taskBoardState>, now: string) {
  state.taskBoard.daily = payload.taskBoard.daily;
  state.taskBoard.weekly = payload.taskBoard.weekly;
  state.taskBoard.claimedTaskIds = Array.from(new Set(state.taskBoard.claimedTaskIds));
  state.taskBoard.updatedAt = now;
}

function shouldPersistDailyTaskBoard(state: GameState, payload: ReturnType<typeof taskBoardState>, dateKey: string) {
  if (state.taskBoard.daily.date !== dateKey) return true;
  const currentIds = state.taskBoard.daily.tasks.map((task) => task.taskId).join("|");
  const nextIds = payload.taskBoard.daily.tasks.map((task) => task.taskId).join("|");
  return currentIds !== nextIds || state.taskBoard.daily.tasks.length !== payload.taskBoard.daily.tasks.length;
}

function applyTaskReward(state: GameState, reward: DailyOrderReward) {
  state.wallet.sunCoins += reward.sunCoins;
  state.wallet.focusCrystals += reward.focusCrystals;
  basicSeedInventory(state).count += reward.basicTomatoSeeds;
  return applyFarmXp(state, reward.farmXp);
}

function itemBucket(rarity: Rarity) {
  return supplyPool.filter((item) => item.rarity === rarity);
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomRarity(minRarity: Rarity = "N") {
  const allowed = (Object.keys(basicSeedCrate.probabilities) as Rarity[])
    .filter((rarity) => supplyRarityRank[rarity] >= supplyRarityRank[minRarity]);
  const total = allowed.reduce((sum, rarity) => sum + basicSeedCrate.probabilities[rarity], 0);
  let roll = Math.random() * total;
  for (const rarity of allowed) {
    roll -= basicSeedCrate.probabilities[rarity];
    if (roll <= 0) return rarity;
  }
  return allowed.at(-1) ?? minRarity;
}

function nextSupplyRarity(pity: SupplyPity) {
  if (pity.sinceLastSSR >= basicSeedCrate.pity.ssrWithin - 1) {
    return { rarity: randomRarity("SSR"), pityTriggered: true };
  }
  if (pity.sinceLastSR >= basicSeedCrate.pity.srWithin - 1) {
    return { rarity: randomRarity("SR"), pityTriggered: true };
  }
  return { rarity: randomRarity(), pityTriggered: false };
}

function addSeed(state: GameState, seedId: string, name: string, rarity: string, quantity: number) {
  let seed = state.inventory.seeds.find((item) => item.seedId === seedId);
  const isNew = !seed;
  if (!seed) {
    seed = { seedId, name, rarity, count: 0 };
    state.inventory.seeds.push(seed);
  }
  seed.count = Math.max(0, Math.floor(seed.count)) + Math.max(0, Math.floor(quantity));
  return isNew;
}

function addTomatoItem(state: GameState, tomatoId: string, name: string, rarity: string, quantity: number) {
  let tomato = state.inventory.tomatoes.find((item) => item.tomatoId === tomatoId);
  const isNew = !tomato;
  if (!tomato) {
    tomato = { tomatoId, name, rarity, count: 0 };
    state.inventory.tomatoes.push(tomato);
  }
  tomato.count = Math.round((tomato.count + Math.max(0, quantity)) * 100) / 100;
  return isNew;
}

function addCountedInventoryItem(items: unknown[], idKey: string, id: string, name: string, rarity: Rarity, quantity: number) {
  const normalized = items
    .map((item) => normalizeCollectionItem(item, idKey, id, name, rarity))
    .filter((item) => String(item[idKey] ?? ""));
  const existing = normalized.find((item) => item[idKey] === id);
  const isNew = !existing;
  if (existing) existing.count += Math.max(0, Math.floor(quantity));
  else normalized.push({ [idKey]: id, name, rarity, count: Math.max(0, Math.floor(quantity)) });
  return { items: normalized, isNew };
}

function addUniqueCollectionItem(items: unknown[], idKey: string, id: string, name: string, rarity: Rarity) {
  const normalized = items
    .map((item) => normalizeCollectionItem(item, idKey, id, name, rarity))
    .filter((item) => String(item[idKey] ?? ""));
  const existing = normalized.find((item) => item[idKey] === id);
  if (existing) {
    existing.count += 1;
    return { items: normalized, isNew: false };
  }
  normalized.push({ [idKey]: id, name, rarity, count: 1 });
  return { items: normalized, isNew: true };
}

function applySupplyItem(state: GameState, item: SupplyItem, pityTriggered: boolean) {
  let isNew = false;
  const targetId = item.targetId ?? item.itemId;
  if (item.type === "seed") {
    isNew = addSeed(state, targetId, item.name, item.rarity, item.quantity);
  } else if (item.type === "tomato") {
    isNew = addTomatoItem(state, targetId, item.name, item.rarity, item.quantity);
  } else if (item.type === "sunCoins") {
    state.wallet.sunCoins += Math.max(0, Math.round(item.quantity));
  } else if (item.type === "farmXp") {
    applyFarmXp(state, Math.max(0, Math.round(item.quantity)));
  } else if (item.type === "decoration") {
    const next = addCountedInventoryItem(state.inventory.decorations, "decorationId", targetId, item.name, item.rarity, item.quantity);
    state.inventory.decorations = next.items;
    const collection = addUniqueCollectionItem(state.collection.unlockedDecorations, "decorationId", targetId, item.name, item.rarity);
    state.collection.unlockedDecorations = collection.items;
    isNew = collection.isNew;
  } else if (item.type === "tool") {
    const next = addCountedInventoryItem(state.inventory.tools, "toolId", targetId, item.name, item.rarity, item.quantity);
    state.inventory.tools = next.items;
    isNew = next.isNew;
  } else if (item.type === "partner") {
    const inventory = addCountedInventoryItem(state.inventory.partners ?? [], "partnerId", targetId, item.name, item.rarity, item.quantity);
    state.inventory.partners = inventory.items;
    const collection = addUniqueCollectionItem(state.collection.unlockedPartners, "partnerId", targetId, item.name, item.rarity);
    state.collection.unlockedPartners = collection.items;
    isNew = collection.isNew;
  } else if (item.type === "title") {
    const collection = addUniqueCollectionItem(state.collection.unlockedTitles, "titleId", targetId, item.name, item.rarity);
    state.collection.unlockedTitles = collection.items;
    isNew = collection.isNew;
  }
  return {
    itemId: item.itemId,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    quantity: item.quantity,
    isNew,
    pityTriggered
  };
}

function supplyStatePayload(state: GameState) {
  return {
    ok: true,
    initialized: true,
    wallet: {
      focusCrystals: state.wallet.focusCrystals,
      sunCoins: state.wallet.sunCoins
    },
    pity: state.supply.pity,
    recentHistory: [...state.supply.history]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
  };
}

function supplyItemToCatalogItem(item: SupplyItem): CatalogItem | null {
  if (item.type === "sunCoins" || item.type === "farmXp") return null;
  const itemId = item.targetId ?? item.itemId;
  const meta = collectionMeta[itemId] ?? {
    description: `${item.name} 是番茄基地中的可收藏物资。`,
    source: "补给中心"
  };
  return {
    itemId,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    description: meta.description,
    source: meta.source
  };
}

function collectionCatalogItems() {
  const items = new Map<string, CatalogItem>();
  const baseItems: CatalogItem[] = [
    {
      itemId: defaultHarvestTomato.tomatoId,
      name: defaultHarvestTomato.name,
      type: "tomato",
      rarity: "N",
      description: collectionMeta[defaultHarvestTomato.tomatoId].description,
      source: collectionMeta[defaultHarvestTomato.tomatoId].source
    },
    {
      itemId: defaultFarmTomato.tomatoId,
      name: defaultFarmTomato.name,
      type: "tomato",
      rarity: "N",
      description: collectionMeta[defaultFarmTomato.tomatoId].description,
      source: collectionMeta[defaultFarmTomato.tomatoId].source
    },
    {
      itemId: defaultSeed.seedId,
      name: defaultSeed.name,
      type: "seed",
      rarity: "N",
      description: collectionMeta[defaultSeed.seedId].description,
      source: collectionMeta[defaultSeed.seedId].source
    }
  ];
  for (const item of baseItems) items.set(`${item.type}:${item.itemId}`, item);
  for (const supplyItem of supplyPool) {
    const catalogItem = supplyItemToCatalogItem(supplyItem);
    if (!catalogItem) continue;
    const key = `${catalogItem.type}:${catalogItem.itemId}`;
    if (!items.has(key)) items.set(key, catalogItem);
  }
  return Array.from(items.values()).sort((a, b) => {
    const categoryDelta = catalogCategoryOrder.indexOf(a.type) - catalogCategoryOrder.indexOf(b.type);
    if (categoryDelta) return categoryDelta;
    const rarityDelta = supplyRarityRank[a.rarity] - supplyRarityRank[b.rarity];
    if (rarityDelta) return rarityDelta;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function collectionCatalogCategories(items = collectionCatalogItems()) {
  return catalogCategoryOrder.map((type) => ({
    categoryId: catalogCategoryIds[type],
    name: catalogCategoryNames[type],
    items: items.filter((item) => item.type === type)
  }));
}

function catalogPayload() {
  return {
    ok: true,
    categories: collectionCatalogCategories()
  };
}

function collectionEntryCount(items: unknown[], idKey: string, itemId: string) {
  return arrayValue(items).reduce((sum, item) => {
    if (typeof item === "string") return item === itemId ? sum + 1 : sum;
    if (!item || typeof item !== "object" || Array.isArray(item)) return sum;
    const source = item as Record<string, unknown>;
    const id = String(source[idKey] ?? source.itemId ?? source.id ?? "");
    if (id !== itemId) return sum;
    return sum + Math.max(1, finiteNumber(source.count, 1));
  }, 0);
}

function inventoryCountForCatalogItem(state: GameState, item: CatalogItem) {
  if (item.type === "seed") {
    const inventoryCount = state.inventory.seeds.find((seed) => seed.seedId === item.itemId)?.count ?? 0;
    return Math.max(inventoryCount, collectionEntryCount(state.collection.unlockedSeeds, "seedId", item.itemId));
  }
  if (item.type === "tomato") {
    const inventoryCount = state.inventory.tomatoes.find((tomato) => tomato.tomatoId === item.itemId)?.count ?? 0;
    return Math.max(inventoryCount, collectionEntryCount(state.collection.unlockedTomatoes, "tomatoId", item.itemId));
  }
  if (item.type === "decoration") {
    const inventoryCount = collectionEntryCount(state.inventory.decorations, "decorationId", item.itemId);
    return Math.max(inventoryCount, collectionEntryCount(state.collection.unlockedDecorations, "decorationId", item.itemId));
  }
  if (item.type === "tool") {
    const inventoryCount = collectionEntryCount(state.inventory.tools, "toolId", item.itemId);
    return Math.max(inventoryCount, collectionEntryCount(state.collection.unlockedTools, "toolId", item.itemId));
  }
  if (item.type === "partner") {
    const inventoryCount = collectionEntryCount(state.inventory.partners ?? [], "partnerId", item.itemId);
    return Math.max(inventoryCount, collectionEntryCount(state.collection.unlockedPartners, "partnerId", item.itemId));
  }
  if (item.type === "title") {
    return collectionEntryCount(state.collection.unlockedTitles, "titleId", item.itemId);
  }
  return 0;
}

function firstUnlockedAt(state: GameState, item: CatalogItem) {
  let first: string | null = null;
  for (const entry of state.supply.history) {
    for (const result of entry.results) {
      const supplyItem = supplyPool.find((poolItem) => poolItem.itemId === result.itemId);
      const resultId = supplyItem?.targetId ?? result.itemId;
      if (resultId === item.itemId && result.type === item.type) {
        if (!first || String(entry.createdAt).localeCompare(first) < 0) first = entry.createdAt;
      }
    }
  }
  return first;
}

function collectionStatePayload(state: GameState) {
  const items = collectionCatalogItems();
  const categories = collectionCatalogCategories(items).map((category) => {
    const categoryItems = category.items.map((item) => {
      const count = inventoryCountForCatalogItem(state, item);
      const unlocked = count > 0;
      return {
        ...item,
        unlocked,
        count,
        firstUnlockedAt: unlocked ? firstUnlockedAt(state, item) : null
      };
    });
    const unlocked = categoryItems.filter((item) => item.unlocked).length;
    const total = categoryItems.length;
    return {
      categoryId: category.categoryId,
      name: category.name,
      total,
      unlocked,
      percent: total ? Math.round((unlocked / total) * 100) : 0,
      items: categoryItems
    };
  });
  const total = categories.reduce((sum, category) => sum + category.total, 0);
  const unlocked = categories.reduce((sum, category) => sum + category.unlocked, 0);
  return {
    ok: true,
    initialized: true,
    summary: {
      total,
      unlocked,
      percent: total ? Math.round((unlocked / total) * 100) : 0
    },
    categories
  };
}

function catalogItemByTypeAndId(type: CollectionType, itemId: string) {
  return collectionCatalogItems().find((item) => item.type === type && item.itemId === itemId) ?? null;
}

function ownedCatalogItems(state: GameState, type: CollectionType) {
  return collectionCatalogItems()
    .filter((item) => item.type === type)
    .map((item) => ({
      ...item,
      count: inventoryCountForCatalogItem(state, item)
    }))
    .filter((item) => item.count > 0);
}

function showcaseItemPayload(state: GameState, type: "decoration" | "partner" | "title", itemId: string | null) {
  if (!itemId) return null;
  const item = catalogItemByTypeAndId(type, itemId);
  const count = item ? inventoryCountForCatalogItem(state, item) : 0;
  const idKey = type === "decoration" ? "decorationId" : type === "partner" ? "partnerId" : "titleId";
  return {
    [idKey]: itemId,
    name: item?.name ?? "展示物品异常",
    rarity: item?.rarity ?? "N",
    valid: Boolean(item && count > 0),
    count
  };
}

function showcaseStatePayload(state: GameState) {
  const slots = Object.fromEntries(showcaseSlotIds.map((slotId) => [
    slotId,
    showcaseItemPayload(state, "decoration", state.showcase.decorationSlots[slotId])
  ])) as Record<ShowcaseSlotId, ReturnType<typeof showcaseItemPayload>>;
  const invalidItems = [
    showcaseItemPayload(state, "title", state.showcase.titleId),
    showcaseItemPayload(state, "partner", state.showcase.partnerId),
    ...Object.values(slots)
  ].filter((item) => item && !item.valid);
  return {
    ok: true,
    initialized: true,
    showcase: {
      updatedAt: state.showcase.updatedAt,
      title: showcaseItemPayload(state, "title", state.showcase.titleId),
      partner: showcaseItemPayload(state, "partner", state.showcase.partnerId),
      decorationSlots: slots
    },
    slots: showcaseSlotIds.map((slotId) => ({ slotId, name: showcaseSlotLabels[slotId] })),
    available: {
      decorations: ownedCatalogItems(state, "decoration"),
      partners: ownedCatalogItems(state, "partner"),
      titles: ownedCatalogItems(state, "title")
    },
    invalidItems
  };
}

function requireOwnedShowcaseItem(state: GameState, type: "decoration" | "partner" | "title", itemId: string) {
  const item = catalogItemByTypeAndId(type, itemId);
  if (!item) return { ok: false as const, status: 404, message: "展示物品不存在" };
  if (inventoryCountForCatalogItem(state, item) <= 0) return { ok: false as const, status: 403, message: "你还没有获得这个物品" };
  return { ok: true as const, item };
}

function emptyShowcasePayload() {
  return {
    ok: true,
    initialized: false,
    showcase: {
      updatedAt: null,
      title: null,
      partner: null,
      decorationSlots: Object.fromEntries(showcaseSlotIds.map((slotId) => [slotId, null]))
    },
    slots: showcaseSlotIds.map((slotId) => ({ slotId, name: showcaseSlotLabels[slotId] })),
    available: {
      decorations: [],
      partners: [],
      titles: []
    },
    invalidItems: []
  };
}

function harvestEligiblePayload(record: TomatoRecord, recordId: string) {
  return {
    recordId,
    date: String(record.date ?? ""),
    taskGoal: String(record.taskGoal ?? ""),
    completionContent: String(record.completionContent ?? ""),
    tomatoStatus: String(record.tomatoStatus ?? ""),
    tomatoWeight: recordWeight(record),
    completionPercent: Number.isFinite(Number(record.completionPercent)) ? Number(record.completionPercent) : null,
    estimatedReward: calculateHarvestReward(record)
  };
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
  return Math.max(1, Number(getUserSetting(userId, "dailyWordGoal", getUserSetting(userId, "dailyNewGoal", "20"))) || 20);
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
  const front = requireText(input.front, "题目");
  const back = requireText(input.back, "答案");
  const choices = normalizedCardOptionsPayload(cardType, input.choices ?? [], back, front);
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
      JSON.stringify(choices),
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

function importBatchRows(userId: number, limit = 5) {
  return all(
    `SELECT b.id, b.deck_id, COALESCE(d.name, '已删除卡组') AS deck_name, b.imported, b.skipped, b.source, b.created_at, b.undone_at
     FROM import_batches b
     LEFT JOIN decks d ON d.id = b.deck_id AND d.user_id = b.user_id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC
     LIMIT ?`,
    [userId, Math.max(1, Math.min(20, limit))]
  );
}

function createImportBatch(userId: number, deckId: number, imported: number, skipped: number, source: string, cardIds: number[]) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  run(
    `INSERT INTO import_batches (id, user_id, deck_id, imported, skipped, source, card_ids, created_at, undone_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
    [id, userId, deckId, imported, skipped, source, JSON.stringify(cardIds), createdAt]
  );
  return { id, createdAt };
}

function parseImportBatchCardIds(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
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

type DailyTaskRow = Record<string, unknown> & {
  date: string;
  daily_new_goal: number;
  review_card_ids: string;
  new_card_ids: string;
  new_mastered_card_ids: string;
  review_mastered_card_ids: string;
  completed_at: string;
};

type DailyTaskSnapshot = Pick<DailyTaskRow, "new_card_ids" | "new_mastered_card_ids" | "review_mastered_card_ids" | "completed_at">;

function ensureDailyTask(userId: number) {
  const date = shanghaiDateKey();
  const existing = get<{ date: string }>("SELECT date FROM daily_tasks WHERE user_id = ? AND date = ?", [userId, date]);
  if (!existing) {
    const now = nowIso();
    run(
      `INSERT INTO daily_tasks (
         user_id, date, daily_new_goal, review_card_ids, new_card_ids,
         new_mastered_card_ids, review_mastered_card_ids, completed_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      [userId, date, getDailyGoal(userId), JSON.stringify(dueReviewIdsForToday(userId, now)), "[]", "[]", "[]", now, now]
    );
  }
  return get<DailyTaskRow>(
    "SELECT * FROM daily_tasks WHERE user_id = ? AND date = ?",
    [userId, date]
  )!;
}

function dailyTaskSnapshot(task: DailyTaskRow): DailyTaskSnapshot {
  return {
    new_card_ids: String(task.new_card_ids ?? "[]"),
    new_mastered_card_ids: String(task.new_mastered_card_ids ?? "[]"),
    review_mastered_card_ids: String(task.review_mastered_card_ids ?? "[]"),
    completed_at: String(task.completed_at ?? "")
  };
}

function restoreDailyTaskSnapshot(userId: number, snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const task = ensureDailyTask(userId);
  const value = snapshot as Partial<DailyTaskSnapshot>;
  const now = nowIso();
  run(
    `UPDATE daily_tasks
     SET new_card_ids = ?,
         new_mastered_card_ids = ?,
         review_mastered_card_ids = ?,
         completed_at = ?,
         updated_at = ?
     WHERE user_id = ? AND date = ?`,
    [
      typeof value.new_card_ids === "string" ? value.new_card_ids : task.new_card_ids,
      typeof value.new_mastered_card_ids === "string" ? value.new_mastered_card_ids : task.new_mastered_card_ids,
      typeof value.review_mastered_card_ids === "string" ? value.review_mastered_card_ids : task.review_mastered_card_ids,
      typeof value.completed_at === "string" ? value.completed_at : task.completed_at,
      now,
      userId,
      task.date
    ]
  );
  return true;
}

function updateDailyTaskProgress(userId: number, cardId: number, rating: ReviewRating, originalStage: number) {
  const task = ensureDailyTask(userId);
  const reviewIds = new Set(parseJsonArray(task.review_card_ids));
  const newIds = new Set(parseJsonArray(task.new_card_ids));
  const newMasteredIds = new Set(parseJsonArray(task.new_mastered_card_ids));
  const reviewMasteredIds = new Set(parseJsonArray(task.review_mastered_card_ids));

  if (originalStage === 0) {
    newIds.add(cardId);
    if (rating === "known") newMasteredIds.add(cardId);
    else newMasteredIds.delete(cardId);
  } else if (reviewIds.has(cardId)) {
    if (rating === "known") reviewMasteredIds.add(cardId);
    else reviewMasteredIds.delete(cardId);
  }

  const now = nowIso();
  run(
    `UPDATE daily_tasks
     SET new_card_ids = ?,
         new_mastered_card_ids = ?,
         review_mastered_card_ids = ?,
         completed_at = '',
         updated_at = ?
     WHERE user_id = ? AND date = ?`,
    [
      JSON.stringify([...newIds]),
      JSON.stringify([...newMasteredIds]),
      JSON.stringify([...reviewMasteredIds]),
      now,
      userId,
      task.date
    ]
  );
}

function removeDailyNewCard(userId: number, cardId: number) {
  const task = ensureDailyTask(userId);
  const newIds = new Set(parseJsonArray(task.new_card_ids));
  const newMasteredIds = new Set(parseJsonArray(task.new_mastered_card_ids));
  newIds.delete(cardId);
  newMasteredIds.delete(cardId);
  const now = nowIso();
  run(
    `UPDATE daily_tasks
     SET new_card_ids = ?,
         new_mastered_card_ids = ?,
         completed_at = '',
         updated_at = ?
     WHERE user_id = ? AND date = ?`,
    [
      JSON.stringify([...newIds]),
      JSON.stringify([...newMasteredIds]),
      now,
      userId,
      task.date
    ]
  );
}

function updateDailyPracticeMastery(userId: number, cardId: number, rating: ReviewRating) {
  const task = ensureDailyTask(userId);
  const newIds = new Set(parseJsonArray(task.new_card_ids));
  const reviewIds = new Set(parseJsonArray(task.review_card_ids));
  const newMasteredIds = new Set(parseJsonArray(task.new_mastered_card_ids));
  const reviewMasteredIds = new Set(parseJsonArray(task.review_mastered_card_ids));

  if (newIds.has(cardId)) {
    if (rating === "known") newMasteredIds.add(cardId);
    else newMasteredIds.delete(cardId);
  } else if (reviewIds.has(cardId)) {
    if (rating === "known") reviewMasteredIds.add(cardId);
    else reviewMasteredIds.delete(cardId);
  }

  const now = nowIso();
  run(
    `UPDATE daily_tasks
     SET new_mastered_card_ids = ?,
         review_mastered_card_ids = ?,
         completed_at = '',
         updated_at = ?
     WHERE user_id = ? AND date = ?`,
    [
      JSON.stringify([...newMasteredIds]),
      JSON.stringify([...reviewMasteredIds]),
      now,
      userId,
      task.date
    ]
  );
}

function normalizeDailyMasteryLists(userId: number, task: DailyTaskRow) {
  const reviewIds = new Set(parseJsonArray(task.review_card_ids));
  const newIds = new Set(parseJsonArray(task.new_card_ids));
  const rawNewMasteredIds = parseJsonArray(task.new_mastered_card_ids);
  const rawReviewMasteredIds = parseJsonArray(task.review_mastered_card_ids);
  const newMasteredIds = rawNewMasteredIds.filter((id) => newIds.has(id));
  const reviewMasteredIds = rawReviewMasteredIds.filter((id) => reviewIds.has(id));
  if (newMasteredIds.length === rawNewMasteredIds.length && reviewMasteredIds.length === rawReviewMasteredIds.length) {
    return { newMasteredIds, reviewMasteredIds };
  }
  const now = nowIso();
  run(
    `UPDATE daily_tasks
     SET new_mastered_card_ids = ?, review_mastered_card_ids = ?, updated_at = ?
     WHERE user_id = ? AND date = ?`,
    [JSON.stringify(newMasteredIds), JSON.stringify(reviewMasteredIds), now, userId, task.date]
  );
  return { newMasteredIds, reviewMasteredIds };
}

function dailyTaskSummary(userId: number) {
  const task = ensureDailyTask(userId);
  const date = String(task.date);
  const reviewIds = parseJsonArray(task.review_card_ids);
  const newIds = parseJsonArray(task.new_card_ids);
  const { newMasteredIds, reviewMasteredIds } = normalizeDailyMasteryLists(userId, task);
  const reviewRows = reviewIds.length
    ? all<{ card_id: number; updated_at: string }>(
        `SELECT card_id, updated_at FROM reviews WHERE card_id IN (${reviewIds.map(() => "?").join(",")})`,
        reviewIds
      )
    : [];
  const reviewCompleted = reviewRows.filter((row) => sameShanghaiDay(String(row.updated_at), date)).length;
  const newCompleted = newIds.length;
  const progressWords = reviewCompleted + newCompleted * 5;
  const completed = progressWords >= Math.max(1, Number(task.daily_new_goal));
  if (completed && !task.completed_at) {
    const now = nowIso();
    run("UPDATE daily_tasks SET completed_at = ?, updated_at = ? WHERE user_id = ? AND date = ?", [now, now, userId, date]);
    task.completed_at = now;
  }
  if (!completed && task.completed_at) {
    const now = nowIso();
    run("UPDATE daily_tasks SET completed_at = '', updated_at = ? WHERE user_id = ? AND date = ?", [now, userId, date]);
    task.completed_at = "";
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
    daily_word_goal: Number(task.daily_new_goal),
    progress_words: progressWords,
    new_completed: newCompleted,
    new_mastered: newMasteredIds.length,
    review_total: reviewIds.length,
    review_completed: reviewCompleted,
    review_mastered: reviewMasteredIds.length,
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
    user: user ? publicAuthUser(user) : null,
    canRegister: !hasUsers || process.env.ALLOW_REGISTRATION === "true"
  });
});

app.get("/api/auth/gate", (req, res) => {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).end();
    return;
  }
  res.status(204).end();
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
    res.status(201).json({ user: publicAuthUser({ id: userId, username }) });
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
  res.json({ user: publicAuthUser({ id: Number(user.id), username: user.username }) });
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = parseCookies(req.headers.cookie)[sessionCookieName];
  if (sessionId) run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  clearSession(res);
  res.json({ ok: true });
});

app.use("/api", requireUser);

app.post("/api/card-images", (req, res) => {
  cardImageUpload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE"
        ? "图片不能超过 10 MB"
        : uploadError instanceof Error
          ? uploadError.message
          : "图片上传失败";
      res.status(400).json({ error: message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "请选择要上传的图片" });
      return;
    }
    try {
      const userId = currentUserId(res);
      const stored = await storeCardImage(cardImagesDir, userId, req.file.buffer);
      res.status(201).json({ url: `/api/card-images/${userId}/${stored.filename}` });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
});

app.get("/api/card-images/:ownerId/:filename", (req, res) => {
  const userId = currentUserId(res);
  const ownerId = Number(req.params.ownerId);
  const type = cardImageTypeFromFilename(req.params.filename);
  const imagePath = ownerId === userId && type ? cardImagePath(cardImagesDir, userId, req.params.filename) : null;
  if (!imagePath || !fs.existsSync(imagePath)) {
    res.status(404).json({ error: "图片不存在" });
    return;
  }
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.type(type!.mimeType);
  res.sendFile(imagePath, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: "图片不存在" });
  });
});

app.get("/api/game/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json({
      initialized: Boolean(state),
      state: state ?? defaultGameState()
    });
  } catch (error) {
    res.status(500).json({ error: "无法读取游戏状态" });
  }
});

app.post("/api/game/init", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const existing = readGameState(userId);
    if (existing) {
      res.json({ initialized: true, state: existing, alreadyInitialized: true });
      return;
    }
    const state = defaultGameState();
    setUserSetting(userId, gameStateKey, JSON.stringify(state));
    res.status(201).json({ initialized: true, state, alreadyInitialized: false });
  } catch (error) {
    res.status(500).json({ error: "无法初始化游戏状态" });
  }
});

app.get("/api/game/harvest/eligible", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const records = tomatoRecords(userId);
    const gameState = readGameState(userId);
    if (!gameState) {
      res.json({
        ok: true,
        initialized: false,
        summary: {
          totalRecords: records.length,
          claimedCount: 0,
          eligibleCount: 0
        },
        eligible: []
      });
      return;
    }
    const claimed = new Set(gameState.idempotency.claimedPomodoroRecordIds);
    const eligible = records
      .map((record, index) => ({ record, recordId: stableRecordId(record, index) }))
      .filter(({ recordId }) => !claimed.has(recordId))
      .sort((a, b) => String(b.record.date ?? "").localeCompare(String(a.record.date ?? ""))
        || String(b.record.endTime ?? b.record.startTime ?? "").localeCompare(String(a.record.endTime ?? a.record.startTime ?? ""))
        || String(b.record.createdAt ?? "").localeCompare(String(a.record.createdAt ?? "")))
      .slice(0, 20)
      .map(({ record, recordId }) => harvestEligiblePayload(record, recordId));
    res.json({
      ok: true,
      initialized: true,
      summary: {
        totalRecords: records.length,
        claimedCount: claimed.size,
        eligibleCount: Math.max(0, records.length - claimed.size)
      },
      eligible
    });
  } catch (error) {
    res.status(500).json({ error: "无法读取待收获记录" });
  }
});

app.post("/api/game/harvest/claim", (req, res) => {
  try {
    const userId = currentUserId(res);
    const recordId = typeof req.body?.recordId === "string" ? req.body.recordId.trim() : "";
    if (!recordId) {
      res.status(400).json({ error: "recordId is required" });
      return;
    }
    const gameState = readGameState(userId);
    if (!gameState) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const records = tomatoRecords(userId);
    const match = records
      .map((record, index) => ({ record, recordId: stableRecordId(record, index) }))
      .find((item) => item.recordId === recordId);
    if (!match) {
      res.status(404).json({ error: "收获记录不存在" });
      return;
    }
    if (gameState.idempotency.claimedPomodoroRecordIds.includes(recordId)) {
      res.json({
        ok: true,
        alreadyClaimed: true,
        recordId,
        message: "这条收获记录已经领取过经营奖励"
      });
      return;
    }

    const reward = calculateHarvestReward(match.record);
    const now = nowIso();
    const claimEventId = `claim_pomodoro_${crypto.createHash("sha256").update(recordId).digest("hex").slice(0, 24)}`;
    gameState.wallet.sunCoins += reward.sunCoins;
    gameState.wallet.focusCrystals += reward.focusCrystals;
    const levelUp = applyFarmXp(gameState, reward.farmXp);
    const tomato = harvestTomatoInventory(gameState);
    tomato.count = Math.round((tomato.count + reward.tomatoUnits) * 100) / 100;
    gameState.idempotency.claimedPomodoroRecordIds.push(recordId);
    gameState.idempotency.claimedPomodoroRecordIds = Array.from(new Set(gameState.idempotency.claimedPomodoroRecordIds));
    if (!gameState.idempotency.eventIds.includes(claimEventId)) {
      gameState.events.push({
        eventId: claimEventId,
        type: "harvest_claimed",
        message: `收获「${stringValue(match.record.taskGoal, "番茄记录")}」获得 ${reward.sunCoins} 阳光币、${reward.farmXp} 经验、${reward.focusCrystals} 专注水晶`,
        recordId,
        reward,
        createdAt: now,
        source: "pomodoro_record"
      });
      gameState.idempotency.eventIds.push(claimEventId);
    }
    if (levelUp.leveledUp) {
      for (let level = levelUp.oldLevel + 1; level <= levelUp.newLevel; level += 1) {
        const levelEventId = `level_up_${now.replace(/[^0-9]/g, "")}_L${level}`;
        if (!gameState.idempotency.eventIds.includes(levelEventId)) {
          gameState.events.push({
            eventId: levelEventId,
            type: "farm_level_up",
            message: `农场升级到 Lv.${level}`,
            createdAt: now,
            source: "harvest_claim"
          });
          gameState.idempotency.eventIds.push(levelEventId);
        }
      }
    }
    gameState.updatedAt = now;
    setUserSetting(userId, gameStateKey, JSON.stringify(normalizeGameState(gameState)));
    res.json({
      ok: true,
      alreadyClaimed: false,
      recordId,
      reward,
      levelUp,
      gameSummary: {
        level: gameState.profile.level,
        xp: Math.round(gameState.profile.xp),
        xpToNextLevel: gameState.profile.xpToNextLevel,
        sunCoins: gameState.wallet.sunCoins,
        focusCrystals: gameState.wallet.focusCrystals,
        storedTomatoes: tomato.count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "领取经营奖励失败" });
  }
});

app.get("/api/game/planting/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json({
        ok: true,
        initialized: false,
        serverNow: nowIso(),
        config: {
          basicTomatoGrowSeconds
        },
        plots: [],
        inventory: {
          seeds: [],
          tomatoes: []
        }
      });
      return;
    }
    const now = new Date();
    const changed = syncPlantingReadiness(state, now);
    if (changed) {
      state.updatedAt = now.toISOString();
      setUserSetting(userId, gameStateKey, JSON.stringify(normalizeGameState(state)));
    }
    res.json(plantingStatePayload(state, now));
  } catch (error) {
    res.status(500).json({ error: "无法读取种植状态" });
  }
});

app.post("/api/game/planting/craft-seed", (req, res) => {
  try {
    const userId = currentUserId(res);
    const tomatoId = String(req.body?.tomatoId ?? "").trim();
    const seedId = String(req.body?.seedId ?? "").trim();
    const count = Number(req.body?.count);
    if (tomatoId !== defaultHarvestTomato.tomatoId || seedId !== defaultSeed.seedId) {
      res.status(400).json({ error: "当前只支持用基础收获番茄制作普通番茄种子" });
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      res.status(400).json({ error: "制作数量必须是 1 到 20 的整数" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const harvestTomato = harvestTomatoInventory(state);
    const craftable = Math.floor(finiteNumber(harvestTomato.count, 0));
    if (craftable < count) {
      res.status(400).json({ error: "基础收获番茄不足，暂时无法制作种子" });
      return;
    }
    const seed = basicSeedInventory(state);
    const now = nowIso();
    harvestTomato.count = Math.round((harvestTomato.count - count) * 100) / 100;
    seed.count += count;
    addGameEvent(state, {
      eventId: `craft_seed_${now.replace(/[^0-9]/g, "")}_${crypto.randomUUID().slice(0, 8)}`,
      type: "seed_crafted",
      message: `使用 ${count} 个基础收获番茄制作了 ${count} 个普通番茄种子`,
      createdAt: now,
      source: "planting"
    });
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      inventory: {
        seeds: normalized.inventory.seeds,
        tomatoes: normalized.inventory.tomatoes
      },
      summary: {
        basicHarvestTomatoes: harvestTomatoInventory(normalized).count,
        basicTomatoSeeds: basicSeedInventory(normalized).count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "制作种子失败" });
  }
});

app.post("/api/game/planting/plant", (req, res) => {
  try {
    const userId = currentUserId(res);
    const plotId = String(req.body?.plotId ?? "").trim();
    const seedId = String(req.body?.seedId ?? "").trim();
    if (!plotId) {
      res.status(400).json({ error: "plotId is required" });
      return;
    }
    if (seedId !== defaultSeed.seedId) {
      res.status(400).json({ error: "当前只支持播种普通番茄种子" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const nowDate = new Date();
    syncPlantingReadiness(state, nowDate);
    const plot = state.planting.plots.find((item) => item.plotId === plotId);
    if (!plot) {
      res.status(404).json({ error: "地块不存在" });
      return;
    }
    if (plot.status !== "empty") {
      res.status(409).json({ error: "这块地暂时不是空闲状态" });
      return;
    }
    const seed = basicSeedInventory(state);
    if (seed.count < 1) {
      res.status(400).json({ error: "普通番茄种子不足" });
      return;
    }
    const now = nowDate.toISOString();
    const readyAt = new Date(nowDate.getTime() + basicTomatoGrowSeconds * 1000).toISOString();
    seed.count -= 1;
    plot.status = "growing";
    plot.seedId = defaultSeed.seedId;
    plot.seedName = defaultSeed.name;
    plot.plantedAt = now;
    plot.readyAt = readyAt;
    plot.harvestedAt = null;
    addGameEvent(state, {
      eventId: `plant_${plotId}_${now.replace(/[^0-9]/g, "")}`,
      type: "seed_planted",
      message: `在 ${plotId.replace("plot_", "")} 号地块播下普通番茄种子`,
      createdAt: now,
      source: "planting"
    });
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    const savedPlot = normalized.planting.plots.find((item) => item.plotId === plotId) ?? plot;
    res.json({
      ok: true,
      plot: plotPayload(savedPlot, new Date(now)),
      inventorySummary: {
        basicTomatoSeeds: basicSeedInventory(normalized).count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "播种失败" });
  }
});

app.post("/api/game/planting/harvest", (req, res) => {
  try {
    const userId = currentUserId(res);
    const plotId = String(req.body?.plotId ?? "").trim();
    if (!plotId) {
      res.status(400).json({ error: "plotId is required" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const nowDate = new Date();
    syncPlantingReadiness(state, nowDate);
    const plot = state.planting.plots.find((item) => item.plotId === plotId);
    if (!plot) {
      res.status(404).json({ error: "地块不存在" });
      return;
    }
    if (plot.status !== "growing" && plot.status !== "ready") {
      res.status(409).json({ error: "这块地当前没有可收获的作物" });
      return;
    }
    const seconds = remainingSeconds(plot, nowDate);
    if (seconds > 0) {
      res.status(409).json({ error: "番茄还没有成熟", remainingSeconds: seconds });
      return;
    }

    const reward = {
      sunCoins: 10,
      farmXp: 15,
      focusCrystals: 0,
      tomatoUnits: 1
    };
    const now = nowDate.toISOString();
    state.wallet.sunCoins += reward.sunCoins;
    const levelUp = applyFarmXp(state, reward.farmXp);
    const farmTomato = farmTomatoInventory(state);
    farmTomato.count += reward.tomatoUnits;
    addGameEvent(state, {
      eventId: `planting_harvest_${plotId}_${now.replace(/[^0-9]/g, "")}`,
      type: "planting_harvested",
      message: `收获 ${plotId.replace("plot_", "")} 号地块，获得 10 阳光币、15 经验、1 个基础经营番茄`,
      reward,
      createdAt: now,
      source: "planting"
    });
    if (levelUp.leveledUp) {
      for (let level = levelUp.oldLevel + 1; level <= levelUp.newLevel; level += 1) {
        addGameEvent(state, {
          eventId: `planting_level_up_${now.replace(/[^0-9]/g, "")}_L${level}`,
          type: "farm_level_up",
          message: `农场升级到 Lv.${level}`,
          createdAt: now,
          source: "planting"
        });
      }
    }
    plot.status = "empty";
    plot.seedId = null;
    plot.seedName = null;
    plot.plantedAt = null;
    plot.readyAt = null;
    plot.harvestedAt = now;
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    const savedPlot = normalized.planting.plots.find((item) => item.plotId === plotId);
    res.json({
      ok: true,
      reward,
      levelUp,
      plot: savedPlot ? plotPayload(savedPlot, nowDate) : null,
      gameSummary: {
        level: normalized.profile.level,
        xp: Math.round(normalized.profile.xp),
        xpToNextLevel: normalized.profile.xpToNextLevel,
        sunCoins: normalized.wallet.sunCoins,
        focusCrystals: normalized.wallet.focusCrystals,
        basicFarmTomatoes: farmTomatoInventory(normalized).count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "收获番茄失败" });
  }
});

app.get("/api/game/orders/today", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    const dateKey = shanghaiDateKey();
    if (!state) {
      res.json({
        ok: true,
        initialized: false,
        date: dateKey,
        summary: {
          todayEffectiveTomatoes: todayEffectiveTomatoes(userId, dateKey),
          todayTargetTomatoes: todayTargetTomatoes(userId),
          basicOrderRequiredTomatoes: Math.max(1, Math.min(todayTargetTomatoes(userId), 3)),
          basicFarmTomatoes: 0
        },
        order: null
      });
      return;
    }
    res.json(dailyOrderState(userId, state, dateKey));
  } catch (error) {
    res.status(500).json({ error: "无法读取今日订单" });
  }
});

app.post("/api/game/orders/submit", (req, res) => {
  try {
    const userId = currentUserId(res);
    const dateKey = shanghaiDateKey();
    const expectedOrderId = dailyBasicOrderId(dateKey);
    const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
    if (orderId !== expectedOrderId) {
      res.status(400).json({ error: "只能提交今天的基础订单" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    if (state.idempotency.completedDailyOrderIds.includes(orderId) || state.dailyOrders.completedOrderIds.includes(orderId)) {
      res.json({
        ok: true,
        alreadyCompleted: true,
        orderId,
        message: "今日基础订单已经提交过"
      });
      return;
    }
    const orderState = dailyOrderState(userId, state, dateKey);
    if (!orderState.order.canSubmit) {
      res.status(409).json({
        error: "订单条件还没有满足",
        reasons: orderState.order.reasons,
        order: orderState.order
      });
      return;
    }

    const now = nowIso();
    const farmTomato = farmTomatoInventory(state);
    const seed = basicSeedInventory(state);
    if (farmTomato.count < dailyBasicConsumed.basicFarmTomatoes) {
      res.status(409).json({ error: "基础经营番茄不足", reasons: ["基础经营番茄不足"] });
      return;
    }
    farmTomato.count = Math.round((farmTomato.count - dailyBasicConsumed.basicFarmTomatoes) * 100) / 100;
    state.wallet.sunCoins += dailyBasicReward.sunCoins;
    state.wallet.focusCrystals += dailyBasicReward.focusCrystals;
    seed.count += dailyBasicReward.basicTomatoSeeds;
    const levelUp = applyFarmXp(state, dailyBasicReward.farmXp);
    const completedOrder = normalizeDailyOrder(orderState.order, dateKey, [orderId]);
    completedOrder.status = "completed";
    completedOrder.completedAt = now;
    completedOrder.requirements.effectiveTomatoesRequired = orderState.order.requirements.effectiveTomatoesRequired;
    completedOrder.requirements.effectiveTomatoesCurrent = orderState.order.requirements.effectiveTomatoesCurrent;
    completedOrder.requirements.basicFarmTomatoesRequired = dailyBasicConsumed.basicFarmTomatoes;
    completedOrder.reward = { ...dailyBasicReward };
    upsertDailyOrder(state, completedOrder);
    state.dailyOrders.lastRefreshDate = dateKey;
    state.dailyOrders.completedOrderIds = Array.from(new Set([...state.dailyOrders.completedOrderIds, orderId]));
    state.idempotency.completedDailyOrderIds = Array.from(new Set([...state.idempotency.completedDailyOrderIds, orderId]));
    addGameEvent(state, {
      eventId: `daily_order_${orderId}`,
      type: "daily_order_completed",
      message: "完成今日基础订单，获得 30 阳光币、40 经验、1 专注水晶、1 个普通番茄种子",
      orderId,
      reward: { ...dailyBasicReward },
      consumed: { ...dailyBasicConsumed },
      createdAt: now,
      source: "daily_order"
    });
    if (levelUp.leveledUp) {
      for (let level = levelUp.oldLevel + 1; level <= levelUp.newLevel; level += 1) {
        addGameEvent(state, {
          eventId: `level_up_daily_order_${dateKey}_L${level}`,
          type: "farm_level_up",
          message: `农场升级到 Lv.${level}`,
          createdAt: now,
          source: "daily_order"
        });
      }
    }
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      alreadyCompleted: false,
      orderId,
      reward: { ...dailyBasicReward },
      consumed: { ...dailyBasicConsumed },
      levelUp,
      gameSummary: {
        level: normalized.profile.level,
        xp: Math.round(normalized.profile.xp),
        xpToNextLevel: normalized.profile.xpToNextLevel,
        sunCoins: normalized.wallet.sunCoins,
        focusCrystals: normalized.wallet.focusCrystals,
        basicTomatoSeeds: basicSeedInventory(normalized).count,
        basicFarmTomatoes: farmTomatoInventory(normalized).count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "提交今日订单失败" });
  }
});

app.get("/api/game/supply/crates", (_req, res) => {
  res.json({
    ok: true,
    crates: [{
      crateId: basicSeedCrate.crateId,
      name: basicSeedCrate.name,
      description: basicSeedCrate.description,
      cost: basicSeedCrate.cost,
      probabilities: basicSeedCrate.probabilities,
      pity: basicSeedCrate.pity
    }]
  });
});

app.get("/api/game/supply/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json({
        ok: true,
        initialized: false,
        wallet: {
          focusCrystals: 0,
          sunCoins: 0
        },
        pity: {
          [basicSeedCrate.crateId]: normalizeSupplyPity(null)
        },
        recentHistory: []
      });
      return;
    }
    res.json(supplyStatePayload(state));
  } catch (error) {
    res.status(500).json({ error: "无法读取补给状态" });
  }
});

app.post("/api/game/supply/open", (req, res) => {
  try {
    const userId = currentUserId(res);
    const crateId = String(req.body?.crateId ?? "").trim();
    const count = Number(req.body?.count ?? 1);
    const rawClientRequestId = typeof req.body?.clientRequestId === "string" ? req.body.clientRequestId.trim() : "";
    if (crateId !== basicSeedCrate.crateId) {
      res.status(400).json({ error: "补给箱不存在" });
      return;
    }
    if (![1, 5].includes(count)) {
      res.status(400).json({ error: "开启次数只能是 1 或 5" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const supplyId = rawClientRequestId && /^[a-zA-Z0-9_-]{8,80}$/.test(rawClientRequestId)
      ? `supply_${rawClientRequestId}`
      : `supply_${crypto.randomUUID()}`;
    if (state.idempotency.supplyOpenIds.includes(supplyId)) {
      const existing = state.supply.history.find((entry) => entry.supplyId === supplyId);
      res.json({
        ok: true,
        alreadyOpened: true,
        crateId,
        cost: existing?.cost ?? { focusCrystals: basicSeedCrate.cost.focusCrystals * count },
        results: existing?.results ?? [],
        wallet: {
          focusCrystals: state.wallet.focusCrystals,
          sunCoins: state.wallet.sunCoins
        },
        pity: state.supply.pity[basicSeedCrate.crateId]
      });
      return;
    }
    const totalCost = basicSeedCrate.cost.focusCrystals * count;
    if (state.wallet.focusCrystals < totalCost) {
      res.status(400).json({
        ok: false,
        error: "focus_crystals_not_enough",
        message: "专注水晶不足"
      });
      return;
    }
    const now = nowIso();
    const oldLevel = state.profile.level;
    state.wallet.focusCrystals -= totalCost;
    const pity = state.supply.pity[basicSeedCrate.crateId] ?? normalizeSupplyPity(null);
    const results: SupplyResult[] = [];
    for (let index = 0; index < count; index += 1) {
      const rarityResult = nextSupplyRarity(pity);
      const bucket = itemBucket(rarityResult.rarity);
      const item = randomItem(bucket.length ? bucket : itemBucket("N"));
      const result = applySupplyItem(state, item, rarityResult.pityTriggered);
      results.push(result);
      pity.totalOpens += 1;
      pity.sinceLastSR = supplyRarityRank[result.rarity] >= supplyRarityRank.SR ? 0 : pity.sinceLastSR + 1;
      pity.sinceLastSSR = supplyRarityRank[result.rarity] >= supplyRarityRank.SSR ? 0 : pity.sinceLastSSR + 1;
    }
    state.supply.pity[basicSeedCrate.crateId] = pity;
    const historyEntry: SupplyHistoryEntry = {
      supplyId,
      crateId,
      crateName: basicSeedCrate.name,
      cost: {
        focusCrystals: totalCost
      },
      results,
      createdAt: now
    };
    state.supply.history.push(historyEntry);
    state.idempotency.supplyOpenIds.push(supplyId);
    const rareResult = results.find((result) => supplyRarityRank[result.rarity] >= supplyRarityRank.SR);
    const resultText = results.map((result) => `${result.name} ×${result.quantity}`).join("、");
    addGameEvent(state, {
      eventId: `supply_open_${supplyId}`,
      type: "supply_opened",
      message: rareResult
        ? `开启普通种子补给箱，获得稀有物资：${rareResult.name} ×${rareResult.quantity}`
        : `开启普通种子补给箱，获得 ${resultText}`,
      crateId,
      results,
      createdAt: now,
      source: "supply"
    });
    if (state.profile.level > oldLevel) {
      for (let level = oldLevel + 1; level <= state.profile.level; level += 1) {
        addGameEvent(state, {
          eventId: `level_up_supply_${supplyId}_L${level}`,
          type: "farm_level_up",
          message: `农场升级到 Lv.${level}`,
          createdAt: now,
          source: "supply"
        });
      }
    }
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      crateId,
      cost: {
        focusCrystals: totalCost
      },
      results,
      wallet: {
        focusCrystals: normalized.wallet.focusCrystals,
        sunCoins: normalized.wallet.sunCoins
      },
      pity: normalized.supply.pity[basicSeedCrate.crateId]
    });
  } catch (error) {
    res.status(500).json({ error: "开启补给箱失败" });
  }
});

app.get("/api/game/collection/catalog", (_req, res) => {
  res.json(catalogPayload());
});

app.get("/api/game/collection/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      const categories = collectionCatalogCategories().map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        total: category.items.length,
        unlocked: 0,
        percent: 0,
        items: category.items.map((item) => ({
          ...item,
          unlocked: false,
          count: 0,
          firstUnlockedAt: null
        }))
      }));
      const total = categories.reduce((sum, category) => sum + category.total, 0);
      res.json({
        ok: true,
        initialized: false,
        summary: {
          total,
          unlocked: 0,
          percent: 0
        },
        categories
      });
      return;
    }
    res.json(collectionStatePayload(state));
  } catch (error) {
    res.status(500).json({ error: "无法读取图鉴状态" });
  }
});

app.get("/api/game/showcase/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json(emptyShowcasePayload());
      return;
    }
    res.json(showcaseStatePayload(state));
  } catch (error) {
    res.status(500).json({ error: "无法读取基地展示状态" });
  }
});

app.post("/api/game/showcase/equip", (req, res) => {
  try {
    const userId = currentUserId(res);
    const type = String(req.body?.type ?? "").trim();
    const itemId = String(req.body?.itemId ?? "").trim();
    const slotId = String(req.body?.slotId ?? "").trim();
    if (type !== "decoration" && type !== "partner" && type !== "title") {
      res.status(400).json({ error: "展示类型不支持" });
      return;
    }
    if (!itemId) {
      res.status(400).json({ error: "缺少展示物品" });
      return;
    }
    if (type === "decoration" && !showcaseSlotIds.includes(slotId as ShowcaseSlotId)) {
      res.status(400).json({ error: "展示槽位不存在" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const owned = requireOwnedShowcaseItem(state, type, itemId);
    if (!owned.ok) {
      res.status(owned.status).json({ error: owned.message });
      return;
    }
    const now = nowIso();
    if (type === "decoration") {
      state.showcase.decorationSlots[slotId as ShowcaseSlotId] = itemId;
    } else if (type === "partner") {
      state.showcase.partnerId = itemId;
    } else {
      state.showcase.titleId = itemId;
    }
    state.showcase.updatedAt = now;
    const message = type === "decoration"
      ? `已将「${owned.item.name}」展示到${showcaseSlotLabels[slotId as ShowcaseSlotId]}`
      : type === "partner"
        ? `已将「${owned.item.name}」设为当前展示伙伴`
        : `已将「${owned.item.name}」设为当前展示称号`;
    addGameEvent(state, {
      eventId: `showcase_equip_${type}_${type === "decoration" ? `${slotId}_` : ""}${itemId}_${Date.now()}`,
      type: "showcase_updated",
      message,
      createdAt: now,
      source: "showcase",
      itemId,
      slotId: type === "decoration" ? slotId : undefined
    });
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      message,
      showcase: showcaseStatePayload(normalized).showcase
    });
  } catch (error) {
    res.status(500).json({ error: "更新基地展示失败" });
  }
});

app.post("/api/game/showcase/unequip", (req, res) => {
  try {
    const userId = currentUserId(res);
    const type = String(req.body?.type ?? "").trim();
    const slotId = String(req.body?.slotId ?? "").trim();
    if (type !== "decoration" && type !== "partner" && type !== "title") {
      res.status(400).json({ error: "展示类型不支持" });
      return;
    }
    if (type === "decoration" && !showcaseSlotIds.includes(slotId as ShowcaseSlotId)) {
      res.status(400).json({ error: "展示槽位不存在" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const now = nowIso();
    let message = "已取消展示";
    if (type === "decoration") {
      state.showcase.decorationSlots[slotId as ShowcaseSlotId] = null;
      message = `已移除${showcaseSlotLabels[slotId as ShowcaseSlotId]}装饰`;
    } else if (type === "partner") {
      state.showcase.partnerId = null;
      message = "已移除当前展示伙伴";
    } else {
      state.showcase.titleId = null;
      message = "已移除当前展示称号";
    }
    state.showcase.updatedAt = now;
    addGameEvent(state, {
      eventId: `showcase_unequip_${type}_${type === "decoration" ? slotId : "main"}_${Date.now()}`,
      type: "showcase_updated",
      message,
      createdAt: now,
      source: "showcase",
      slotId: type === "decoration" ? slotId : undefined
    });
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      message,
      showcase: showcaseStatePayload(normalized).showcase
    });
  } catch (error) {
    res.status(500).json({ error: "取消基地展示失败" });
  }
});

app.get("/api/game/task-board/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json(emptyTaskBoardPayload(userId));
      return;
    }
    const dateKey = shanghaiDateKey();
    const weekId = shanghaiWeekId();
    const payload = taskBoardState(userId, state, dateKey, weekId);
    if (shouldPersistDailyTaskBoard(state, payload, dateKey)) {
      const now = nowIso();
      saveTaskBoardSnapshot(state, payload, now);
      state.updatedAt = now;
      setUserSetting(userId, gameStateKey, JSON.stringify(normalizeGameState(state)));
    }
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "无法读取农场任务板" });
  }
});

app.post("/api/game/task-board/claim", (req, res) => {
  try {
    const userId = currentUserId(res);
    const taskId = typeof req.body?.taskId === "string" ? req.body.taskId.trim() : "";
    if (!taskId) {
      res.status(400).json({ error: "taskId is required" });
      return;
    }
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const dateKey = shanghaiDateKey();
    const weekId = shanghaiWeekId();
    const payload = taskBoardState(userId, state, dateKey, weekId);
    const tasks = [...payload.taskBoard.daily.tasks, ...payload.taskBoard.weekly.tasks];
    const task = tasks.find((item) => item.taskId === taskId);
    if (!task) {
      res.status(404).json({ error: "任务不存在或不是当前周期任务" });
      return;
    }
    if (state.taskBoard.claimedTaskIds.includes(taskId) || task.status === "claimed") {
      res.json({
        ok: true,
        alreadyClaimed: true,
        taskId,
        message: "这个经营目标已经领取过奖励"
      });
      return;
    }
    if (task.status !== "completed") {
      res.status(409).json({
        error: "经营目标还没有完成",
        task
      });
      return;
    }
    const now = nowIso();
    const reward = { ...task.reward };
    const levelUp = applyTaskReward(state, reward);
    state.taskBoard.claimedTaskIds = Array.from(new Set([...state.taskBoard.claimedTaskIds, taskId]));
    const refreshed = taskBoardState(userId, state, dateKey, weekId);
    const claimedTask = [...refreshed.taskBoard.daily.tasks, ...refreshed.taskBoard.weekly.tasks].find((item) => item.taskId === taskId);
    if (claimedTask) claimedTask.claimedAt = now;
    saveTaskBoardSnapshot(state, refreshed, now);
    appendTaskHistory(state, task, now);
    addGameEvent(state, {
      eventId: `task_board_claim_${taskId}`,
      type: "task_board_reward_claimed",
      message: `完成「${task.title}」获得 ${reward.sunCoins} 阳光币、${reward.farmXp} 经验、${reward.focusCrystals} 专注水晶、${reward.basicTomatoSeeds} 个普通番茄种子`,
      taskId,
      reward,
      createdAt: now,
      source: "task_board"
    });
    if (levelUp.leveledUp) {
      for (let level = levelUp.oldLevel + 1; level <= levelUp.newLevel; level += 1) {
        addGameEvent(state, {
          eventId: `level_up_task_board_${taskId}_L${level}`,
          type: "farm_level_up",
          message: `农场升级到 Lv.${level}`,
          createdAt: now,
          source: "task_board"
        });
      }
    }
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    const latest = taskBoardState(userId, normalized, dateKey, weekId);
    res.json({
      ok: true,
      alreadyClaimed: false,
      taskId,
      reward,
      levelUp,
      taskBoard: latest.taskBoard,
      summary: latest.summary,
      gameSummary: {
        level: normalized.profile.level,
        xp: Math.round(normalized.profile.xp),
        xpToNextLevel: normalized.profile.xpToNextLevel,
        sunCoins: normalized.wallet.sunCoins,
        focusCrystals: normalized.wallet.focusCrystals,
        basicTomatoSeeds: basicSeedInventory(normalized).count
      }
    });
  } catch (error) {
    res.status(500).json({ error: "领取任务板奖励失败" });
  }
});

app.get("/api/game/operation/summary", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json(emptyOperationSummaryPayload(userId));
      return;
    }
    const now = nowIso();
    const payload = operationSummaryState(userId, state);
    state.operationStats.weeklySummary.updatedAt = now;
    state.updatedAt = now;
    setUserSetting(userId, gameStateKey, JSON.stringify(normalizeGameState(state)));
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "无法读取本周经营总览" });
  }
});

app.post("/api/game/operation/check-in", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const dateKey = shanghaiDateKey();
    const preview = checkInStreakPreview(state.operationStats, dateKey);
    if (preview.alreadyCheckedIn) {
      res.json({
        ok: true,
        alreadyCheckedIn: true,
        message: "今日已经完成经营打卡",
        streak: {
          ...state.operationStats.streak,
          alreadyCheckedInToday: true,
          nextCurrentDays: state.operationStats.streak.currentDays
        }
      });
      return;
    }
    const now = nowIso();
    const reward: DailyOrderReward = {
      sunCoins: 5,
      farmXp: 5,
      focusCrystals: 0,
      basicTomatoSeeds: 0
    };
    state.operationStats.streak.currentDays = preview.currentDays;
    state.operationStats.streak.bestDays = preview.bestDays;
    state.operationStats.streak.lastActiveDate = dateKey;
    state.wallet.sunCoins += reward.sunCoins;
    const levelUp = applyFarmXp(state, reward.farmXp);
    addGameEvent(state, {
      eventId: `operation_check_in_${dateKey}`,
      type: "operation_check_in",
      message: `完成今日经营打卡，连续经营 ${preview.currentDays} 天`,
      reward,
      createdAt: now,
      source: "operation"
    });
    if (levelUp.leveledUp) {
      for (let level = levelUp.oldLevel + 1; level <= levelUp.newLevel; level += 1) {
        addGameEvent(state, {
          eventId: `level_up_operation_check_in_${dateKey}_L${level}`,
          type: "farm_level_up",
          message: `农场升级到 Lv.${level}`,
          createdAt: now,
          source: "operation"
        });
      }
    }
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    const summary = operationSummaryState(userId, normalized, dateKey, shanghaiWeekId());
    setUserSetting(userId, gameStateKey, JSON.stringify(normalizeGameState(normalized)));
    res.json({
      ok: true,
      alreadyCheckedIn: false,
      reward,
      levelUp,
      streak: summary.streak,
      weeklySummary: summary.weeklySummary,
      weeklyGoal: summary.weeklyGoal
    });
  } catch (error) {
    res.status(500).json({ error: "今日经营打卡失败" });
  }
});

app.get("/api/game/planning/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.json(emptyPlanningPayload(userId));
      return;
    }
    res.json(planningStatePayload(userId, state));
  } catch (error) {
    res.status(500).json({ error: "无法读取经营计划" });
  }
});

app.post("/api/game/planning/daily", (req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const dateKey = shanghaiDateKey();
    const now = nowIso();
    state.planning.daily = {
      date: dateKey,
      tomatoTarget: normalizePlanningTarget(req.body?.tomatoTarget, { allowDecimal: true }),
      orderTarget: normalizePlanningTarget(req.body?.orderTarget),
      plantingTarget: normalizePlanningTarget(req.body?.plantingTarget),
      harvestTarget: normalizePlanningTarget(req.body?.harvestTarget),
      note: stringValue(req.body?.note, "").slice(0, 300),
      updatedAt: now
    };
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      message: "今日经营目标已保存",
      ...planningStatePayload(userId, normalized, dateKey, shanghaiWeekId())
    });
  } catch (error) {
    res.status(500).json({ error: "保存今日经营目标失败" });
  }
});

app.post("/api/game/planning/weekly", (req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const weekId = shanghaiWeekId();
    const now = nowIso();
    state.planning.weekly = {
      weekId,
      tomatoTarget: normalizePlanningTarget(req.body?.tomatoTarget, { allowDecimal: true }),
      orderTarget: normalizePlanningTarget(req.body?.orderTarget),
      plantingTarget: normalizePlanningTarget(req.body?.plantingTarget),
      harvestTarget: normalizePlanningTarget(req.body?.harvestTarget),
      note: stringValue(req.body?.note, "").slice(0, 300),
      updatedAt: now
    };
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      message: "本周经营目标已保存",
      ...planningStatePayload(userId, normalized, shanghaiDateKey(), weekId)
    });
  } catch (error) {
    res.status(500).json({ error: "保存本周经营目标失败" });
  }
});

app.get("/api/game/planning/templates", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json(planningTemplatesPayload(state));
  } catch (error) {
    res.status(500).json({ error: "无法读取常用计划模板" });
  }
});

app.post("/api/game/planning/templates/save", (req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const scope = req.body?.type === "weekly" ? "weekly" : req.body?.type === "daily" ? "daily" : null;
    if (!scope) {
      res.status(400).json({ error: "type 只能是 daily 或 weekly" });
      return;
    }
    state.planningTemplates = normalizePlanningTemplatesState(state.planningTemplates);
    if (state.planningTemplates[scope].length >= maxPlanningTemplatesPerScope) {
      res.status(400).json({ error: `最多保留 ${maxPlanningTemplatesPerScope} 个${scope === "daily" ? "今日" : "本周"}模板` });
      return;
    }
    const now = nowIso();
    const templateInput = buildPlanningTemplateFromInput(req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {});
    state.planningTemplates[scope].unshift({
      id: `planning_template_${crypto.randomUUID()}`,
      ...templateInput,
      createdAt: now,
      updatedAt: now
    });
    state.planningTemplates = normalizePlanningTemplatesState(state.planningTemplates);
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      message: `${scope === "daily" ? "今日" : "本周"}计划模板已保存`,
      ...planningTemplatesPayload(normalized)
    });
  } catch (error) {
    if (error instanceof Error && error.message) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "保存计划模板失败" });
  }
});

app.post("/api/game/planning/templates/apply", (req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const scope = req.body?.type === "weekly" ? "weekly" : req.body?.type === "daily" ? "daily" : null;
    const templateId = stringValue(req.body?.templateId, "").trim();
    if (!scope) {
      res.status(400).json({ error: "type 只能是 daily 或 weekly" });
      return;
    }
    if (!templateId) {
      res.status(400).json({ error: "templateId 不能为空" });
      return;
    }
    state.planningTemplates = normalizePlanningTemplatesState(state.planningTemplates);
    const template = findPlanningTemplate(state, scope, templateId);
    if (!template) {
      res.status(404).json({ error: "没有找到这个计划模板" });
      return;
    }
    const now = nowIso();
    if (scope === "daily") {
      const dateKey = shanghaiDateKey();
      state.planning.daily = {
        date: dateKey,
        tomatoTarget: template.tomatoTarget,
        orderTarget: template.orderTarget,
        plantingTarget: template.plantingTarget,
        harvestTarget: template.harvestTarget,
        note: template.note,
        updatedAt: now
      };
    } else {
      const weekId = shanghaiWeekId();
      state.planning.weekly = {
        weekId,
        tomatoTarget: template.tomatoTarget,
        orderTarget: template.orderTarget,
        plantingTarget: template.plantingTarget,
        harvestTarget: template.harvestTarget,
        note: template.note,
        updatedAt: now
      };
    }
    state.updatedAt = now;
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      ok: true,
      message: `已套用到${scope === "daily" ? "今日" : "本周"}目标`,
      templates: normalized.planningTemplates,
      planning: planningStatePayload(userId, normalized, shanghaiDateKey(), shanghaiWeekId())
    });
  } catch (error) {
    res.status(500).json({ error: "套用计划模板失败" });
  }
});

app.post("/api/game/planning/templates/delete", (req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    if (!state) {
      res.status(409).json({ error: "请先启用经营系统", needsInit: true });
      return;
    }
    const scope = req.body?.type === "weekly" ? "weekly" : req.body?.type === "daily" ? "daily" : null;
    const templateId = stringValue(req.body?.templateId, "").trim();
    if (!scope) {
      res.status(400).json({ error: "type 只能是 daily 或 weekly" });
      return;
    }
    if (!templateId) {
      res.status(400).json({ error: "templateId 不能为空" });
      return;
    }
    state.planningTemplates = normalizePlanningTemplatesState(state.planningTemplates);
    const before = state.planningTemplates[scope].length;
    state.planningTemplates[scope] = state.planningTemplates[scope].filter((item) => item.id !== templateId);
    if (state.planningTemplates[scope].length === before) {
      res.status(404).json({ error: "没有找到这个计划模板" });
      return;
    }
    state.updatedAt = nowIso();
    const normalized = normalizeGameState(state);
    setUserSetting(userId, gameStateKey, JSON.stringify(normalized));
    res.json({
      message: "计划模板已删除",
      ...planningTemplatesPayload(normalized)
    });
  } catch (error) {
    res.status(500).json({ error: "删除计划模板失败" });
  }
});

app.get("/api/game/weekly-report/current", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json(weeklyReportPayload(userId, state));
  } catch (error) {
    res.status(500).json({ error: "无法读取本周经营周报" });
  }
});

app.get("/api/game/monthly-report/current", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json(monthlyReportPayload(userId, state));
  } catch (error) {
    res.status(500).json({ error: "无法读取本月经营月报" });
  }
});

app.get("/api/game/achievements/wall", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json(achievementProgress(userId, state));
  } catch (error) {
    res.status(500).json({ error: "无法读取成就墙" });
  }
});

app.get("/api/game/memory-book/state", (_req, res) => {
  try {
    const userId = currentUserId(res);
    const state = readGameState(userId);
    res.json(memoryBookPayload(userId, state));
  } catch (error) {
    res.status(500).json({ error: "无法读取经营纪念册" });
  }
});

app.get("/api/tomatoes/state", (_req, res) => {
  const userId = currentUserId(res);
  const row = get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", [userId, "tomatoes.state.v1"]);
  res.json({ state: row?.value ? JSON.parse(row.value) : null });
});

app.put("/api/tomatoes/state", (req, res) => {
  const userId = currentUserId(res);
  if (!req.body || typeof req.body.state !== "object" || Array.isArray(req.body.state)) {
    res.status(400).json({ error: "state must be an object" });
    return;
  }
  setUserSetting(userId, "tomatoes.state.v1", JSON.stringify(req.body.state));
  res.json({ ok: true, updatedAt: nowIso() });
});

app.get("/api/templates/:name", (req, res) => {
  const allowed = new Set(["普通卡导入模板.xlsx", "单词卡导入模板.xlsx", "选择题卡导入模板.xlsx", "填空题卡导入模板.xlsx"]);
  const name = path.basename(req.params.name);
  if (!allowed.has(name)) {
    res.status(404).json({ error: "模板不存在" });
    return;
  }
  res.download(path.join(templateDir, name), name);
});

app.get("/api/tts/xml", requireSuperuser, (req, res) => {
  const phoneme = normalizePronunciationText(req.query.text) ?? "";
  const fallback = normalizePronunciationFallback(req.query.fallback);
  const override = pronunciationXmlOverride(phoneme, fallback);
  res.json({
    ssml: override?.ssml ?? buildWordPronunciation(fallback, phoneme || undefined).ssml,
    prompt: override?.prompt?.trim() || doubaoTtsPrompt,
    customized: Boolean(override),
    promptCustomized: Boolean(override?.prompt?.trim()),
    maxSsmlLength: maxDoubaoSsmlLength,
    maxPromptLength: maxDoubaoPromptLength
  });
});

app.put("/api/tts/xml", requireSuperuser, async (req, res) => {
  const phoneme = normalizePronunciationText(req.body.text) ?? "";
  const fallback = normalizePronunciationFallback(req.body.fallback);
  if (!isEnglishVoiceLanguage(req.body.language)) {
    res.status(422).json({ error: "英式音标发音当前仅支持英语" });
    return;
  }

  let ssml: string;
  let prompt: string;
  try {
    ssml = normalizeCustomSsml(req.body.ssml);
    prompt = normalizeDoubaoPrompt(req.body.prompt);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }

  try {
    const audio = await synthesizeWithDoubao(phoneme, fallback, ssml, prompt);
    const previous = pronunciationXmlOverride(phoneme, fallback);
    setPronunciationXmlOverride(currentUserId(res), phoneme, fallback, ssml, prompt);
    try {
      await writeDoubaoTtsCache(phoneme, fallback, audio, prompt);
    } catch (error) {
      restorePronunciationXmlOverride(previous, phoneme, fallback);
      throw error;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Pronunciation-Source", "doubao-xml-override");
    res.setHeader("X-Pronunciation-Model", doubaoTtsResourceId);
    res.setHeader("X-Pronunciation-Voice", doubaoTtsVoice);
    res.setHeader("X-Pronunciation-Phoneme", encodeURIComponent(phoneme));
    res.send(audio);
  } catch (error) {
    console.warn("Pronunciation XML synthesis failed", error);
    res.status(502).json({ error: (error as Error).message || "豆包语音合成暂不可用" });
  }
});

app.post("/api/tts", async (req, res) => {
  const phoneme = normalizePronunciationText(req.body.text);
  const fallback = normalizePronunciationFallback(req.body.fallback);
  if (!isEnglishVoiceLanguage(req.body.language)) {
    res.status(422).json({ error: "英式音标发音当前仅支持英语" });
    return;
  }

  try {
    const cachePhoneme = phoneme ?? "";
    const override = pronunciationXmlOverride(cachePhoneme, fallback);
    const prompt = override?.prompt?.trim() || doubaoTtsPrompt;
    const cachedPath = await cachedDoubaoTtsPath(cachePhoneme, fallback, prompt);
    const audio = cachedPath
      ? await fs.promises.readFile(cachedPath)
      : await synthesizeWithDoubao(cachePhoneme, fallback, override?.ssml, prompt)
          .then((result) => writeDoubaoTtsCache(cachePhoneme, fallback, result, prompt).then(() => result));

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Pronunciation-Source", cachedPath ? "cache" : "doubao");
    res.setHeader("X-Pronunciation-Model", doubaoTtsResourceId);
    res.setHeader("X-Pronunciation-Voice", doubaoTtsVoice);
    res.setHeader("X-Pronunciation-Phoneme", encodeURIComponent(cachePhoneme));
    res.send(audio);
  } catch (error) {
    console.warn("Pronunciation synthesis failed", error);
    res.status(502).json({ error: (error as Error).message || "豆包语音合成暂不可用" });
  }
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
  const effectiveFront = typeof req.body.front === "string" && req.body.front.trim() ? req.body.front.trim() : String(current.front ?? "");
  const effectiveBack = typeof req.body.back === "string" && req.body.back.trim() ? req.body.back.trim() : String(current.back ?? "");
  const optionSource = req.body.choices !== undefined
    ? req.body.choices
    : effectiveType === "blank" && req.body.back !== undefined
      ? []
      : String(current.choices ?? "");
  const nextChoices = req.body.choices === undefined && req.body.card_type === undefined && req.body.back === undefined && req.body.front === undefined
    ? null
    : JSON.stringify(normalizedCardOptionsPayload(effectiveType, optionSource, effectiveBack, effectiveFront));
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

app.post("/api/import", upload.single("file"), (req, res) => {
  try {
    const userId = currentUserId(res);
    const deckId = Number(req.body.deckId);
    const deck = get<{ id: number }>("SELECT id FROM decks WHERE id = ? AND user_id = ?", [deckId, userId]);
    if (!deck) throw new Error("卡组不存在");
    const text = req.body.text as string | undefined;
    let rows: Record<string, unknown>[] = [];

    let source = "粘贴表格";
    if (req.file) {
      source = req.file.originalname || "上传文件";
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
    const cardIds = cards.map((card) => createCard(userId, deckId, card));
    const batch = createImportBatch(userId, deckId, cards.length, rows.length - cards.length, source, cardIds);
    res.json({ imported: cards.length, skipped: rows.length - cards.length, batchId: batch.id, createdAt: batch.createdAt });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/import/recent", (req, res) => {
  const userId = currentUserId(res);
  const limit = Number(req.query.limit ?? 5);
  res.json(importBatchRows(userId, limit));
});

app.post("/api/import/:batchId/undo", (req, res) => {
  try {
    const userId = currentUserId(res);
    const batch = get<{ id: string; card_ids: string; undone_at: string }>(
      "SELECT id, card_ids, undone_at FROM import_batches WHERE id = ? AND user_id = ?",
      [String(req.params.batchId), userId]
    );
    if (!batch) throw new Error("导入批次不存在");
    if (batch.undone_at) throw new Error("这次导入已经撤销过");
    const cardIds = parseImportBatchCardIds(batch.card_ids);
    let deleted = 0;
    if (cardIds.length > 0) {
      const placeholders = cardIds.map(() => "?").join(",");
      const ownedCardIds = all<{ id: number }>(
        `SELECT id FROM cards WHERE user_id = ? AND id IN (${placeholders})`,
        [userId, ...cardIds]
      ).map((row) => Number(row.id));
      if (ownedCardIds.length > 0) {
        deleted = ownedCardIds.length;
        const ownedPlaceholders = ownedCardIds.map(() => "?").join(",");
        run(`DELETE FROM reviews WHERE card_id IN (${ownedPlaceholders})`, ownedCardIds);
        run(`DELETE FROM cards WHERE user_id = ? AND id IN (${ownedPlaceholders})`, [userId, ...ownedCardIds]);
      }
    }
    run("UPDATE import_batches SET undone_at = ? WHERE id = ? AND user_id = ?", [nowIso(), batch.id, userId]);
    res.json({ ok: true, deleted });
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

  const next = nextReviewState(Number(current.stage), rating, new Date(), {
    known_count: Number(current.known_count),
    fuzzy_count: Number(current.fuzzy_count),
    unknown_count: Number(current.unknown_count)
  });
  const cardId = Number(req.params.cardId);
  const previousDailyTask = dailyTaskSnapshot(ensureDailyTask(userId));
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

  updateDailyTaskProgress(userId, cardId, rating, Number(current.stage));
  dailyTaskSummary(userId);
  res.json({ ...next, previous: { ...current, dailyTaskPrevious: previousDailyTask } });
});

app.post("/api/reviews/:cardId/practice", (req, res) => {
  const userId = currentUserId(res);
  const cardId = Number(req.params.cardId);
  const rating = req.body.rating as ReviewRating;
  if (!["known", "fuzzy", "unknown"].includes(rating)) {
    res.status(400).json({ error: "请选择认识、模糊或不认识" });
    return;
  }
  const card = cardRow(userId, cardId);
  if (!card) {
    res.status(404).json({ error: "复习记录不存在" });
    return;
  }
  const previousDailyTask = dailyTaskSnapshot(ensureDailyTask(userId));
  updateDailyPracticeMastery(userId, cardId, rating);
  dailyTaskSummary(userId);
  res.json({
    stage: Number(card.stage),
    dueAt: String(card.due_at),
    previous: { dailyTaskPrevious: previousDailyTask }
  });
});

app.post("/api/reviews/:cardId/practice/restore", (req, res) => {
  const userId = currentUserId(res);
  const cardId = Number(req.params.cardId);
  const card = get<{ id: number }>("SELECT id FROM cards WHERE id = ? AND user_id = ?", [cardId, userId]);
  if (!card) {
    res.status(404).json({ error: "复习记录不存在" });
    return;
  }
  restoreDailyTaskSnapshot(userId, req.body.dailyTaskPrevious ?? req.body);
  dailyTaskSummary(userId);
  res.json({ ok: true });
});

app.post("/api/reviews/:cardId/restore", (req, res) => {
  const userId = currentUserId(res);
  const cardId = Number(req.params.cardId);
  const card = get<{ id: number }>("SELECT id FROM cards WHERE id = ? AND user_id = ?", [cardId, userId]);
  if (!card) {
    res.status(404).json({ error: "复习记录不存在" });
    return;
  }
  const restoredDailyTask = restoreDailyTaskSnapshot(userId, req.body.dailyTaskPrevious);
  if (!restoredDailyTask && Math.max(0, Number(req.body.stage ?? 0)) === 0) removeDailyNewCard(userId, cardId);
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
  const goal = Math.max(1, Math.floor(Number(req.body.dailyWordGoal ?? req.body.dailyNewGoal ?? 20)));
  setUserSetting(userId, "dailyWordGoal", String(goal));
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
    notifications: getUserSetting(userId, "notifications", "off"),
    autoSpeak: getUserSetting(userId, "autoSpeak", "off"),
    dailyWordGoal: getDailyGoal(userId),
    studyTextScale: clampStudyTextScale(getUserSetting(userId, "studyTextScale", "1")),
    studyTextAlign: getUserSetting(userId, "studyTextAlign", "center") === "left" ? "left" : "center",
    studyChoiceLayout: ["one", "two"].includes(getUserSetting(userId, "studyChoiceLayout", "auto")) ? getUserSetting(userId, "studyChoiceLayout", "auto") : "auto",
    studyLineHeight: clampStudyLineHeight(getUserSetting(userId, "studyLineHeight", "1.5")),
    studyFontFamily: normalizeStudyFontFamily(getUserSetting(userId, "studyFontFamily", "system"))
  });
});

app.put("/api/settings", (req, res) => {
  const userId = currentUserId(res);
  for (const key of ["theme", "notifications", "autoSpeak", "dailyWordGoal", "studyTextScale", "studyTextAlign", "studyChoiceLayout", "studyLineHeight", "studyFontFamily"]) {
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
    if (key === "dailyWordGoal" && typeof req.body[key] === "number") setUserSetting(userId, key, String(Math.max(1, Math.floor(req.body[key]))));
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
