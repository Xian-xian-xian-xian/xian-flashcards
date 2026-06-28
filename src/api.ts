import type { Card, DailyTask, Deck, ReviewRating, ReviewRemaining, ReviewSnapshot, Settings, Stats, SyncStatus, User } from "./types";

export type CardPayload = {
  card_type?: Card["card_type"];
  front?: string;
  back?: string;
  phonetic?: string;
  example?: string;
  mnemonic?: string;
  note?: string;
  choices?: string | string[];
  favorite?: number;
  baseUpdatedAt?: string;
  force?: boolean;
};

export type ConflictError = Error & { status?: number; serverCard?: Card };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    credentials: "include",
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error ?? `请求失败：${response.status}`) as ConflictError;
    error.status = response.status;
    error.serverCard = body.serverCard;
    throw error;
  }
  return response.json();
}

async function download(url: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `请求失败：${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "flashcards-recent-logs.ndjson");
  return { blob: await response.blob(), filename };
}

export const api = {
  authStatus: () => request<{ authenticated: boolean; user: User | null; canRegister: boolean }>("/api/auth/status"),
  login: (payload: { username: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload: { username: string; password: string }) =>
    request<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  decks: () => request<Deck[]>("/api/decks"),
  createDeck: (payload: Partial<Deck> & { name: string; parentId?: number | null }) =>
    request<{ id: number }>("/api/decks", { method: "POST", body: JSON.stringify(payload) }),
  updateDeck: (id: number, payload: Partial<Deck> & { parentId?: number | null }) =>
    request<{ ok: true }>(`/api/decks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteDeck: (id: number) => request<{ ok: true }>(`/api/decks/${id}`, { method: "DELETE" }),
  cards: (deckId: number) => request<Card[]>(`/api/decks/${deckId}/cards`),
  createCard: (deckId: number, payload: CardPayload) =>
    request<{ id: number }>(`/api/decks/${deckId}/cards`, { method: "POST", body: JSON.stringify(payload) }),
  updateCard: (id: number, payload: CardPayload) =>
    request<{ ok: true; card: Card }>(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCard: (id: number) => request<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" }),
  batchCards: (payload: { cardIds: number[]; action: "move" | "delete"; deckId?: number }) =>
    request<{ ok: true; affected: number }>("/api/cards/batch", { method: "POST", body: JSON.stringify(payload) }),
  dueCards: (deckId?: number, limit = 50, kind: "all" | "review" | "new" = "all") =>
    request<Card[]>(`/api/reviews/due?limit=${limit}&kind=${kind}${deckId ? `&deckId=${deckId}` : ""}`),
  reviewRemaining: (deckId?: number) =>
    request<ReviewRemaining>(`/api/reviews/remaining${deckId ? `?deckId=${deckId}` : ""}`),
  answer: (cardId: number, rating: ReviewRating) =>
    request<{ stage: number; dueAt: string; previous: ReviewSnapshot }>(`/api/reviews/${cardId}/answer`, {
      method: "POST",
      body: JSON.stringify({ rating })
    }),
  restoreReview: (cardId: number, snapshot: ReviewSnapshot) =>
    request<{ ok: true }>(`/api/reviews/${cardId}/restore`, { method: "POST", body: JSON.stringify(snapshot) }),
  stats: () => request<Stats>("/api/stats"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  dailyTask: () => request<DailyTask>("/api/daily-task"),
  saveDailyTaskSettings: (payload: { dailyNewGoal: number }) =>
    request<{ ok: true }>("/api/daily-task/settings", { method: "PUT", body: JSON.stringify(payload) }),
  syncStatus: () => request<SyncStatus>("/api/sync/status"),
  importCards: (form: FormData) =>
    request<{ imported: number; skipped: number }>("/api/import", { method: "POST", body: form }),
  exportRecentLogs: () => download("/api/logs/recent?minutes=10")
};
