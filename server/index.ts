import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import type { SqlValue } from "sql.js";
import { all, get, getSetting, initDb, lastTableId, nowIso, run, setSetting } from "./db.js";
import { nextReviewState, type ReviewRating } from "./ebbinghaus.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../dist");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

type CardInput = {
  front: string;
  back: string;
  example?: string;
  note?: string;
};

const maxDeckDepth = 5;

function requireText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function deckRows() {
  type DeckRow = Record<string, SqlValue | number>;
  type DeckTotals = { cards: number; due: number };
  const decks = all<Record<string, SqlValue>>(
    `SELECT d.*,
      COUNT(c.id) AS card_count,
      COALESCE(SUM(CASE WHEN r.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_count,
      (SELECT COUNT(*) FROM decks child WHERE child.parent_id = d.id) AS child_count
     FROM decks d
     LEFT JOIN cards c ON c.deck_id = d.id
     LEFT JOIN reviews r ON r.card_id = c.id
     GROUP BY d.id
     ORDER BY d.updated_at DESC`,
    [nowIso()]
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

function getDeckDepth(deckId: number | null): number {
  if (!deckId) return 0;
  const deck = get<{ parent_id: number | null }>("SELECT parent_id FROM decks WHERE id = ?", [deckId]);
  if (!deck) throw new Error("parent deck not found");
  return 1 + getDeckDepth(deck.parent_id === null ? null : Number(deck.parent_id));
}

function descendantDeckIds(deckId: number): number[] {
  const children = all<{ id: number }>("SELECT id FROM decks WHERE parent_id = ?", [deckId]).map((row) => Number(row.id));
  return [deckId, ...children.flatMap((id) => descendantDeckIds(id))];
}

function createCard(deckId: number, input: CardInput) {
  const createdAt = nowIso();
  run(
    `INSERT INTO cards (deck_id, front, back, example, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      deckId,
      requireText(input.front, "front"),
      requireText(input.back, "back"),
      input.example?.trim() ?? "",
      input.note?.trim() ?? "",
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

function cardRows(where = "", params: SqlValue[] = []) {
  return all(
    `SELECT c.*, r.stage, r.due_at, r.last_rating, r.known_count, r.fuzzy_count, r.unknown_count
     FROM cards c
     JOIN reviews r ON r.card_id = c.id
     ${where}
     ORDER BY r.due_at ASC, c.id DESC`,
    params
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: nowIso() });
});

app.get("/api/decks", (_req, res) => {
  res.json(deckRows());
});

app.post("/api/decks", (req, res) => {
  try {
    const createdAt = nowIso();
    const parentId = req.body.parentId === undefined || req.body.parentId === null || req.body.parentId === ""
      ? null
      : Number(req.body.parentId);
    const depth = getDeckDepth(parentId) + 1;
    if (depth > maxDeckDepth) throw new Error(`deck nesting supports up to ${maxDeckDepth} levels`);
    run(
      `INSERT INTO decks (parent_id, name, description, language, daily_goal, reminder_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
    const deckId = Number(req.params.id);
    const parentId =
      req.body.parentId === undefined
        ? undefined
        : req.body.parentId === null || req.body.parentId === ""
          ? null
          : Number(req.body.parentId);
    if (parentId !== undefined) {
      if (parentId === deckId || descendantDeckIds(deckId).includes(Number(parentId))) {
        throw new Error("deck cannot be moved inside itself");
      }
      if (getDeckDepth(parentId) + 1 > maxDeckDepth) {
        throw new Error(`deck nesting supports up to ${maxDeckDepth} levels`);
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
       WHERE id = ?`,
      [
        parentId === undefined ? null : parentId,
        req.body.name?.trim() || null,
        req.body.description?.trim() ?? null,
        req.body.language?.trim() ?? null,
        req.body.dailyGoal ?? null,
        req.body.reminderTime?.trim() ?? null,
        nowIso(),
        deckId
      ]
    );
    if (parentId === null) run("UPDATE decks SET parent_id = NULL WHERE id = ?", [deckId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/decks/:id", (req, res) => {
  const ids = descendantDeckIds(Number(req.params.id));
  const placeholders = ids.map(() => "?").join(",");
  run(`DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE deck_id IN (${placeholders}))`, ids);
  run(`DELETE FROM cards WHERE deck_id IN (${placeholders})`, ids);
  run(`DELETE FROM decks WHERE id IN (${placeholders})`, ids);
  res.json({ ok: true });
});

app.get("/api/decks/:id/cards", (req, res) => {
  res.json(cardRows("WHERE c.deck_id = ?", [Number(req.params.id)]));
});

app.post("/api/decks/:id/cards", (req, res) => {
  try {
    res.status(201).json({ id: createCard(Number(req.params.id), req.body) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.patch("/api/cards/:id", (req, res) => {
  run(
    `UPDATE cards
     SET front = COALESCE(?, front),
         back = COALESCE(?, back),
         example = COALESCE(?, example),
         note = COALESCE(?, note),
         favorite = COALESCE(?, favorite),
         updated_at = ?
     WHERE id = ?`,
    [
      req.body.front?.trim() || null,
      req.body.back?.trim() || null,
      req.body.example?.trim() ?? null,
      req.body.note?.trim() ?? null,
      typeof req.body.favorite === "boolean" || typeof req.body.favorite === "number"
        ? Number(req.body.favorite)
        : null,
      nowIso(),
      Number(req.params.id)
    ]
  );
  res.json({ ok: true });
});

app.delete("/api/cards/:id", (req, res) => {
  run("DELETE FROM reviews WHERE card_id = ?", [Number(req.params.id)]);
  run("DELETE FROM cards WHERE id = ?", [Number(req.params.id)]);
  res.json({ ok: true });
});

function normalizeImportRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const values = Object.values(row).map((value) => String(value ?? "").trim());
      return {
        front: String(row.front ?? row.word ?? row["单词"] ?? values[0] ?? "").trim(),
        back: String(row.back ?? row.meaning ?? row["释义"] ?? values[1] ?? "").trim(),
        example: String(row.example ?? row["例句"] ?? values[2] ?? "").trim(),
        note: String(row.note ?? row["备注"] ?? values[3] ?? "").trim()
      };
    })
    .filter((row) => row.front && row.back);
}

app.post("/api/import", upload.single("file"), (req, res) => {
  try {
    const deckId = Number(req.body.deckId);
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
    cards.forEach((card) => createCard(deckId, card));
    res.json({ imported: cards.length, skipped: rows.length - cards.length });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/reviews/due", (req, res) => {
  const deckId = req.query.deckId ? Number(req.query.deckId) : undefined;
  const limit = Number(req.query.limit ?? 50);
  const now = nowIso();
  const where = deckId ? "WHERE c.deck_id = ? AND r.due_at <= ?" : "WHERE r.due_at <= ?";
  const params = deckId ? [deckId, now, limit] : [now, limit];
  const cards = all(
    `SELECT c.*, d.language, r.stage, r.due_at, r.last_rating
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

app.post("/api/reviews/:cardId/answer", (req, res) => {
  const rating = req.body.rating as ReviewRating;
  if (!["known", "fuzzy", "unknown"].includes(rating)) {
    res.status(400).json({ error: "rating must be known, fuzzy, or unknown" });
    return;
  }

  const current = get<{ stage: number }>("SELECT stage FROM reviews WHERE card_id = ?", [
    Number(req.params.cardId)
  ]);
  if (!current) {
    res.status(404).json({ error: "review not found" });
    return;
  }

  const next = nextReviewState(Number(current.stage), rating);
  run(
    `UPDATE reviews
     SET stage = ?,
         due_at = ?,
         last_rating = ?,
         known_count = known_count + ?,
         fuzzy_count = fuzzy_count + ?,
         unknown_count = unknown_count + ?,
         updated_at = ?
     WHERE card_id = ?`,
    [
      next.stage,
      next.dueAt,
      rating,
      rating === "known" ? 1 : 0,
      rating === "fuzzy" ? 1 : 0,
      rating === "unknown" ? 1 : 0,
      nowIso(),
      Number(req.params.cardId)
    ]
  );

  res.json(next);
});

app.get("/api/stats", (_req, res) => {
  const row = get("SELECT COUNT(c.id) AS total_cards, COALESCE(SUM(CASE WHEN r.stage >= 10 THEN 1 ELSE 0 END), 0) AS mastered_cards, COALESCE(SUM(CASE WHEN r.due_at <= ? THEN 1 ELSE 0 END), 0) AS due_cards FROM cards c JOIN reviews r ON r.card_id = c.id", [
    nowIso()
  ]);
  res.json(row ?? { total_cards: 0, mastered_cards: 0, due_cards: 0 });
});

app.get("/api/settings", (_req, res) => {
  res.json({
    theme: getSetting("theme", "system"),
    voiceLanguage: getSetting("voiceLanguage", "en-US"),
    notifications: getSetting("notifications", "off")
  });
});

app.put("/api/settings", (req, res) => {
  for (const key of ["theme", "voiceLanguage", "notifications"]) {
    if (typeof req.body[key] === "string") setSetting(key, req.body[key]);
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
