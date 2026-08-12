import { describe, expect, it } from "vitest";
import { isTaskClaimEventType } from "./game-events.js";

describe("game event compatibility", () => {
  it("recognizes both current and legacy task reward events", () => {
    expect(isTaskClaimEventType("task_board_reward_claimed")).toBe(true);
    expect(isTaskClaimEventType("task_claimed")).toBe(true);
    expect(isTaskClaimEventType("seed_planted")).toBe(false);
  });
});
