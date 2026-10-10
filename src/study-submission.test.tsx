// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import type { Card, DailyTask, Deck, ReviewResult, Settings } from "./types";

const deck = { id: 1, name: "Test", depth: 1, parent_id: null, card_count: 2, total_card_count: 2, due_count: 2 } as Deck;
const card = (id: number): Card => ({ id, deck_id: 1, card_type: "basic", front: `Question ${id}`, back: `Answer ${id}`, stage: 1, due_at: "2026-01-01T00:00:00.000Z", last_rating: "", updated_at: "", phonetic: "", example: "", mnemonic: "", note: "", choices: "", favorite: 0, paused: 0, created_at: "" });
const task: DailyTask = { date: "2026-10-10", new_completed: 0, new_mastered: 0, review_total: 2, review_completed: 0, review_mastered: 0, progress_words: 0, daily_word_goal: 20, completed: false, completed_at: "", streak: 0, checkin_makeup_week: "2026-W41", checkin_makeup_used: 0, checkin_makeup_remaining: 2, checkin_makeup_dates: [] };
const saved = (overrides: Partial<ReviewResult> = {}): ReviewResult => ({ stage: 2, dueAt: "2099-01-01T00:00:00.000Z", dailyTask: task, previous: { undoToken: "token" } as ReviewResult["previous"], study: { remaining: { newRemaining: 0, reviewRemaining: 1 }, dueReviews: [] }, ...overrides });
let container: HTMLDivElement;
let root: Root;

function button(text: string) {
  const result = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === text);
  expect(result, `button: ${text}`).toBeDefined();
  return result!;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function openStudy() {
  await act(async () => root.render(<App />));
  await click("学习");
  expect(container.querySelector(".study-panel")?.textContent).toContain("Question 1");
}

function blockAuxiliaryCalls() {
  vi.mocked(api.dailyTask).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.dueCards).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.reviewRemaining).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.dailyTask).mockClear();
  vi.mocked(api.dueCards).mockClear();
  vi.mocked(api.reviewRemaining).mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  window.localStorage.clear();
  vi.spyOn(api, "authStatus").mockResolvedValue({ authenticated: true, user: { id: 1, username: "test", isSuperuser: false }, canRegister: false });
  vi.spyOn(api, "decks").mockResolvedValue([deck]);
  vi.spyOn(api, "stats").mockResolvedValue({ total_cards: 2, mastered_cards: 0, due_cards: 2 });
  vi.spyOn(api, "settings").mockResolvedValue({ theme: "light", notifications: "off", autoSpeak: "off", soundVolume: 0, speechVolume: 0, dailyWordGoal: 20, studyTextScale: 1, studyPageWidth: 1, studyTextAlign: "center", studyChoiceLayout: "auto", studyLineHeight: 1.5, studyFontFamily: "system" } as Settings);
  vi.spyOn(api, "dailyTask").mockResolvedValue(task);
  vi.spyOn(api, "syncStatus").mockResolvedValue({ serverTime: "", lastSyncAt: "", dataUpdatedAt: "" });
  vi.spyOn(api, "cards").mockResolvedValue([card(1), card(2)]);
  vi.spyOn(api, "dueCards").mockResolvedValue([card(1), card(2)]);
  vi.spyOn(api, "reviewRemaining").mockResolvedValue({ newRemaining: 0, reviewRemaining: 2 });
  vi.spyOn(api, "tomatoState").mockResolvedValue({ state: null });
  vi.spyOn(api, "answer").mockResolvedValue(saved());
  vi.spyOn(api, "practice").mockResolvedValue(saved());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("rating submission critical path", () => {
  it("waits for saving once, ignores double clicks, then advances without timers or auxiliary requests", async () => {
    await openStudy();
    let finish!: (result: ReviewResult) => void;
    vi.mocked(api.answer).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    blockAuxiliaryCalls();
    await act(async () => { button("认识").click(); button("模糊").click(); });
    expect(api.answer).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 1");
    expect(button("提交中").disabled).toBe(true);
    await act(async () => finish(saved()));
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 2");
    expect(button("认识").disabled).toBe(false);
    expect(container.querySelector(".rating-toast")?.textContent).toContain("本次掌握");
    expect(api.dailyTask).not.toHaveBeenCalled();
    expect(api.dueCards).not.toHaveBeenCalled();
    expect(api.reviewRemaining).not.toHaveBeenCalled();
  });

  it("keeps unknown cards in the retry queue and routes repeat ratings to practice", async () => {
    await openStudy();
    blockAuxiliaryCalls();
    await click("不认识");
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 2");
    await click("认识");
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 1");
    await click("认识");
    expect(api.answer).toHaveBeenCalledTimes(2);
    expect(api.practice).toHaveBeenCalledWith(1, "known", { deckId: 1 });
  });

  it("applies newly due grind cards from the saved response without a second request", async () => {
    await openStudy();
    await click("无尽模式");
    await click("开始无尽学习");
    blockAuxiliaryCalls();
    vi.mocked(api.answer).mockResolvedValue(saved({ study: { remaining: { newRemaining: 0, reviewRemaining: 2 }, dueReviews: [card(3)] } }));
    await click("认识");
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 3");
    expect(api.answer).toHaveBeenCalledWith(1, "known", expect.objectContaining({ deckId: 1, grindStartedAt: expect.any(String), excludeIds: [1, 2] }));
    expect(api.dueCards).not.toHaveBeenCalled();
    expect(api.reviewRemaining).not.toHaveBeenCalled();
  });

  it("keeps the card and unlocks the controls after a failed save", async () => {
    await openStudy();
    vi.mocked(api.answer).mockRejectedValue(new Error("网络断开"));
    await click("认识");
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 1");
    expect(button("认识").disabled).toBe(false);
    expect(container.querySelector(".toast.error")?.textContent).toContain("网络断开");
    expect(api.practice).not.toHaveBeenCalled();
  });

  it("does not overlap slow timer polling or block ratings on that poll", async () => {
    await openStudy();
    vi.mocked(api.tomatoState).mockClear();
    vi.mocked(api.tomatoState).mockImplementation(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(api.tomatoState).toHaveBeenCalledTimes(1);
    await click("认识");
    expect(container.querySelector(".study-panel")?.textContent).toContain("Question 2");
    expect(button("认识").disabled).toBe(false);
  });
});
