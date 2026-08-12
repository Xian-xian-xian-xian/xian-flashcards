import { describe, expect, it } from "vitest";
import { isReviewDue, reviewUndoExpiresAt, reviewUndoWindowMs } from "./review-security.js";

describe("review API security", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("accepts only valid due timestamps at or before server time", () => {
    expect(isReviewDue("2026-08-12T12:00:00.000Z", now)).toBe(true);
    expect(isReviewDue("2026-08-12T11:59:59.000Z", now)).toBe(true);
    expect(isReviewDue("2026-08-12T12:00:01.000Z", now)).toBe(false);
    expect(isReviewDue("not-a-date", now)).toBe(false);
  });

  it("expires undo tokens after the bounded undo window", () => {
    expect(new Date(reviewUndoExpiresAt(now)).getTime() - now.getTime()).toBe(reviewUndoWindowMs);
  });
});
