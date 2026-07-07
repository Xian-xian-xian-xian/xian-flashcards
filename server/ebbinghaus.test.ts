import { describe, expect, it } from "vitest";
import { nextReviewState } from "./ebbinghaus.js";

const now = new Date("2026-07-04T00:00:00.000Z");
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

function dueInMs(dueAt: string) {
  return new Date(dueAt).getTime() - now.getTime();
}

describe("nextReviewState", () => {
  it("moves new cards into the first stage for all ratings", () => {
    expect(nextReviewState(0, "known", now)).toMatchObject({ stage: 1 });
    expect(dueInMs(nextReviewState(0, "known", now).dueAt)).toBe(5 * minute);

    expect(nextReviewState(0, "fuzzy", now)).toMatchObject({ stage: 1 });
    expect(dueInMs(nextReviewState(0, "fuzzy", now).dueAt)).toBe(30 * minute);

    expect(nextReviewState(0, "unknown", now)).toMatchObject({ stage: 1 });
    expect(dueInMs(nextReviewState(0, "unknown", now).dueAt)).toBe(5 * minute);
  });

  it("keeps early cards in the first review interval after a fuzzy retry becomes known", () => {
    const result = nextReviewState(1, "known", now, { fuzzy_count: 1 });
    expect(result.stage).toBe(1);
    expect(dueInMs(result.dueAt)).toBe(5 * minute);
  });

  it("uses stage-based fuzzy intervals", () => {
    expect(dueInMs(nextReviewState(2, "fuzzy", now).dueAt)).toBe(30 * minute);
    expect(dueInMs(nextReviewState(3, "fuzzy", now).dueAt)).toBe(12 * hour);
    expect(dueInMs(nextReviewState(6, "fuzzy", now).dueAt)).toBe(day);
    expect(dueInMs(nextReviewState(9, "fuzzy", now).dueAt)).toBe(3 * day);
  });

  it("downgrades unknown ratings by current stage band", () => {
    const low = nextReviewState(3, "unknown", now);
    expect(low.stage).toBe(1);
    expect(dueInMs(low.dueAt)).toBe(5 * minute);

    const middle = nextReviewState(7, "unknown", now);
    expect(middle.stage).toBe(2);
    expect(dueInMs(middle.dueAt)).toBe(30 * minute);

    const high = nextReviewState(10, "unknown", now);
    expect(high.stage).toBe(6);
    expect(dueInMs(high.dueAt)).toBe(30 * minute);
  });

  it("shortens known intervals for cards with repeated unknown ratings", () => {
    const result = nextReviewState(2, "known", now, { unknown_count: 3 });
    expect(result.stage).toBe(3);
    expect(dueInMs(result.dueAt)).toBe(Math.round(12 * hour * 0.6));
  });

  it("shortens known intervals for cards with repeated fuzzy ratings", () => {
    const result = nextReviewState(3, "known", now, { fuzzy_count: 3 });
    expect(result.stage).toBe(4);
    expect(dueInMs(result.dueAt)).toBe(Math.round(day * 0.8));
  });

  it("keeps normal known intervals when known history is stable", () => {
    const result = nextReviewState(3, "known", now, {
      known_count: 9,
      fuzzy_count: 2,
      unknown_count: 1
    });
    expect(result.stage).toBe(4);
    expect(dueInMs(result.dueAt)).toBe(day);
  });
});
