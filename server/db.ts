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
      completed_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

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
  const sessionColumns = all<{ name: string }>("PRAGMA table_info(study_sessions)").map((column) => column.name);
  if (!sessionColumns.includes("user_id")) {
    exec("ALTER TABLE study_sessions ADD COLUMN user_id INTEGER");
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

export function lastTableId(table: "decks" | "cards" | "study_sessions" | "users") {
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
