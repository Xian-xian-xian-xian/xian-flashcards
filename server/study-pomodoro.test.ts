import { describe, expect, it } from "vitest";
import { studyPomodoroState } from "./study-pomodoro.js";

describe("study timer payload", () => {
  it("keeps countdown and task data while dropping history and attachments", () => {
    const active = { no: 12, taskGoal: "复习英语", durationSeconds: 1500, breakDurationSeconds: 300, remainingSeconds: 100, status: "paused", phase: "focus", endAt: null };
    const state = { activePomodoro: { ...active, attachment: "x".repeat(400_000) }, records: [{ image: "x".repeat(400_000) }] };
    expect(studyPomodoroState(state)).toEqual({ activePomodoro: active });
    expect(JSON.stringify(studyPomodoroState(state)).length).toBeLessThan(300);
  });

  it("returns an empty timer when none is active", () => {
    for (const state of [null, {}, { activePomodoro: null }, { activePomodoro: [] }]) {
      expect(studyPomodoroState(state)).toEqual({ activePomodoro: null });
    }
  });

  it("bounds the task label without changing stored data", () => {
    const state = { activePomodoro: { taskGoal: "学".repeat(5000) } };
    expect(studyPomodoroState(state).activePomodoro?.taskGoal).toHaveLength(1000);
    expect(state.activePomodoro.taskGoal).toHaveLength(5000);
  });
});
