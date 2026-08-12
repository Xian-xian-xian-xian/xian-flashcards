import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "flashcards.sqlite");
fs.mkdirSync(dataDir, { recursive: true });

let db: Database;

function persist() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export async function initDb() {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.resolve(process.cwd(), "node_modules/sql.js/dist", file)
  });
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

  exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      parent_id INTEGER,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      language TEXT DEFAULT 'en-US',
      daily_goal INTEGER DEFAULT 20,
      reminder_time TEXT DEFAULT '20:00',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      deck_id INTEGER NOT NULL,
      card_type TEXT DEFAULT 'basic',
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      phonetic TEXT DEFAULT '',
      example TEXT DEFAULT '',
      mnemonic TEXT DEFAULT '',
      note TEXT DEFAULT '',
      choices TEXT DEFAULT '',
      favorite INTEGER DEFAULT 0,
      paused INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      card_id INTEGER PRIMARY KEY,
      stage INTEGER DEFAULT 0,
      due_at TEXT NOT NULL,
      last_rating TEXT DEFAULT '',
      known_count INTEGER DEFAULT 0,
      fuzzy_count INTEGER DEFAULT 0,
      unknown_count INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      deck_id INTEGER,
      mode TEXT NOT NULL,
      total INTEGER DEFAULT 0,
      correct INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS study_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER,
      deck_id INTEGER,
      deck_name TEXT DEFAULT '',
      deck_path TEXT DEFAULT '',
      card_type TEXT DEFAULT 'basic',
      front TEXT NOT NULL,
      back TEXT DEFAULT '',
      phonetic TEXT DEFAULT '',
      example TEXT DEFAULT '',
      mnemonic TEXT DEFAULT '',
      note TEXT DEFAULT '',
      choices TEXT DEFAULT '',
      event_kind TEXT NOT NULL,
      rating TEXT NOT NULL,
      stage_before INTEGER NOT NULL,
      stage_after INTEGER NOT NULL,
      study_date TEXT NOT NULL,
      answered_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE SET NULL,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_study_events_user_date
      ON study_events(user_id, study_date, answered_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(user_id, key),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_tasks (
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      daily_new_goal INTEGER DEFAULT 20,
      review_card_ids TEXT DEFAULT '[]',
      new_card_ids TEXT DEFAULT '[]',
      new_study_count INTEGER DEFAULT 0,
      review_study_count INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_checkin_makeups (
      user_id INTEGER NOT NULL,
      week_id TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_daily_checkin_makeups_user_week
      ON daily_checkin_makeups(user_id, week_id, date);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pronunciation_ssml_overrides (
      cache_key TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      phoneme TEXT NOT NULL,
      ssml TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      updated_by INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      imported INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      source TEXT DEFAULT '',
      card_ids TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      undone_at TEXT DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
  `);

  const deckColumns = all<{ name: string }>("PRAGMA table_info(decks)").map((column) => column.name);
  if (!deckColumns.includes("user_id")) {
    exec("ALTER TABLE decks ADD COLUMN user_id INTEGER");
  }
  if (!deckColumns.includes("parent_id")) {
    exec("ALTER TABLE decks ADD COLUMN parent_id INTEGER");
  }
  const cardColumns = all<{ name: string }>("PRAGMA table_info(cards)").map((column) => column.name);
  if (!cardColumns.includes("user_id")) {
    exec("ALTER TABLE cards ADD COLUMN user_id INTEGER");
  }
  if (!cardColumns.includes("card_type")) {
    exec("ALTER TABLE cards ADD COLUMN card_type TEXT DEFAULT 'basic'");
  }
  if (!cardColumns.includes("phonetic")) {
    exec("ALTER TABLE cards ADD COLUMN phonetic TEXT DEFAULT ''");
  }
  if (!cardColumns.includes("mnemonic")) {
    exec("ALTER TABLE cards ADD COLUMN mnemonic TEXT DEFAULT ''");
  }
  if (!cardColumns.includes("choices")) {
    exec("ALTER TABLE cards ADD COLUMN choices TEXT DEFAULT ''");
  }
  if (!cardColumns.includes("paused")) {
    exec("ALTER TABLE cards ADD COLUMN paused INTEGER DEFAULT 0");
  }
  const sessionColumns = all<{ name: string }>("PRAGMA table_info(study_sessions)").map((column) => column.name);
  if (!sessionColumns.includes("user_id")) {
    exec("ALTER TABLE study_sessions ADD COLUMN user_id INTEGER");
  }
  const studyEventColumns = all<{ name: string }>("PRAGMA table_info(study_events)").map((column) => column.name);
  if (!studyEventColumns.includes("deck_path")) {
    exec("ALTER TABLE study_events ADD COLUMN deck_path TEXT DEFAULT ''");
  }
  const dailyTaskColumns = all<{ name: string }>("PRAGMA table_info(daily_tasks)").map((column) => column.name);
  if (!dailyTaskColumns.includes("new_card_ids")) {
    exec("ALTER TABLE daily_tasks ADD COLUMN new_card_ids TEXT DEFAULT '[]'");
  }
  if (!dailyTaskColumns.includes("new_mastered_card_ids")) {
    exec("ALTER TABLE daily_tasks ADD COLUMN new_mastered_card_ids TEXT DEFAULT '[]'");
  }
  if (!dailyTaskColumns.includes("review_mastered_card_ids")) {
    exec("ALTER TABLE daily_tasks ADD COLUMN review_mastered_card_ids TEXT DEFAULT '[]'");
  }
  if (!dailyTaskColumns.includes("new_study_count")) {
    exec("ALTER TABLE daily_tasks ADD COLUMN new_study_count INTEGER DEFAULT -1");
  }
  if (!dailyTaskColumns.includes("review_study_count")) {
    exec("ALTER TABLE daily_tasks ADD COLUMN review_study_count INTEGER DEFAULT -1");
  }
  const pronunciationOverrideColumns = all<{ name: string }>("PRAGMA table_info(pronunciation_ssml_overrides)").map((column) => column.name);
  if (!pronunciationOverrideColumns.includes("prompt")) {
    exec("ALTER TABLE pronunciation_ssml_overrides ADD COLUMN prompt TEXT DEFAULT ''");
  }
  persist();
}

export function exec(sql: string) {
  db.exec(sql);
}

export function run(sql: string, params: SqlValue[] = []) {
  const statement = db.prepare(sql);
  try {
    statement.run(params);
  } finally {
    statement.free();
  }
  persist();
}

export function all<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  const rows: T[] = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject() as T);
  } finally {
    statement.free();
  }
  return rows;
}

export function get<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []) {
  return all<T>(sql, params)[0];
}

export function lastTableId(table: "decks" | "cards" | "study_sessions" | "study_events" | "users") {
  return Number(get<{ id: number }>(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`)?.id ?? 0);
}

export function nowIso() {
  return new Date().toISOString();
}

export function getSetting(key: string, fallback: string) {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

export function getUserSetting(userId: number, key: string, fallback: string) {
  const row = get<{ value: string }>("SELECT value FROM user_settings WHERE user_id = ? AND key = ?", [userId, key]);
  return row?.value ?? getSetting(key, fallback);
}

export function setUserSetting(userId: number, key: string, value: string) {
  run(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    [userId, key, value]
  );
}
