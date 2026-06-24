import type { Card, Deck, ReviewRating, Settings, Stats } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: options?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json();
}

export const api = {
  decks: () => request<Deck[]>("/api/decks"),
  createDeck: (payload: Partial<Deck> & { name: string; parentId?: number | null }) =>
    request<{ id: number }>("/api/decks", { method: "POST", body: JSON.stringify(payload) }),
  updateDeck: (id: number, payload: Partial<Deck> & { parentId?: number | null }) =>
    request<{ ok: true }>(`/api/decks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteDeck: (id: number) => request<{ ok: true }>(`/api/decks/${id}`, { method: "DELETE" }),
  cards: (deckId: number) => request<Card[]>(`/api/decks/${deckId}/cards`),
  createCard: (deckId: number, payload: { front: string; back: string; example?: string; note?: string }) =>
    request<{ id: number }>(`/api/decks/${deckId}/cards`, { method: "POST", body: JSON.stringify(payload) }),
  updateCard: (id: number, payload: Partial<Card>) =>
    request<{ ok: true }>(`/api/cards/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCard: (id: number) => request<{ ok: true }>(`/api/cards/${id}`, { method: "DELETE" }),
  dueCards: (deckId?: number, limit = 50) =>
    request<Card[]>(`/api/reviews/due?limit=${limit}${deckId ? `&deckId=${deckId}` : ""}`),
  answer: (cardId: number, rating: ReviewRating) =>
    request<{ stage: number; dueAt: string }>(`/api/reviews/${cardId}/answer`, {
      method: "POST",
      body: JSON.stringify({ rating })
    }),
  stats: () => request<Stats>("/api/stats"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  importCards: (form: FormData) =>
    request<{ imported: number; skipped: number }>("/api/import", { method: "POST", body: form })
};
