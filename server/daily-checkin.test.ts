import { describe, expect, it } from "vitest";
import {
  currentWeekMakeupDates,
  dailyStreak,
  isDailyTaskComplete,
  isoWeekIdForDateKey,
  taskProgressCount,
  withoutTaskCardIds
} from "./daily-checkin.js";

describe("晚上打卡连续天数", () => {
  it("当天未完成时沿用昨日连续天数，完成当天后再加一天", () => {
    const completed = ["2026-08-10", "2026-08-11"];
    expect(dailyStreak(completed, "2026-08-12")).toBe(2);
    expect(dailyStreak([...completed, "2026-08-12"], "2026-08-12")).toBe(3);
  });

  it("补打卡日期只包含本周一到今天之前的未完成日期", () => {
    expect(currentWeekMakeupDates(["2026-08-10"], "2026-08-12")).toEqual(["2026-08-11"]);
    expect(currentWeekMakeupDates([], "2026-08-10")).toEqual([]);
  });

  it("按周一到周日计算自然周", () => {
    expect(isoWeekIdForDateKey("2026-08-10")).toBe(isoWeekIdForDateKey("2026-08-16"));
    expect(isoWeekIdForDateKey("2026-08-17")).not.toBe(isoWeekIdForDateKey("2026-08-16"));
  });
});

describe("每日任务进度", () => {
  it("只有掌握足够新卡且处理全部到期复习才完成", () => {
    expect(isDailyTaskComplete({ dailyNewGoal: 2, newMastered: 2, reviewTotal: 2, reviewCompleted: 2 })).toBe(true);
    expect(isDailyTaskComplete({ dailyNewGoal: 2, newMastered: 1, reviewTotal: 2, reviewCompleted: 20 })).toBe(false);
    expect(isDailyTaskComplete({ dailyNewGoal: 2, newMastered: 20, reviewTotal: 2, reviewCompleted: 1 })).toBe(false);
  });

  it("按任务中的唯一卡片计数，忽略重复和任务外卡片", () => {
    expect(taskProgressCount([1, 2, 3], [1, 1, 2, 99])).toBe(2);
  });

  it("删除卡片时同时去重并清理任务队列", () => {
    expect(withoutTaskCardIds([1, 2, 2, 3], [2, 99])).toEqual([1, 3]);
  });
});
