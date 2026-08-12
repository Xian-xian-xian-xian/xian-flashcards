import { describe, expect, it } from "vitest";
import { currentWeekMakeupDates, dailyStreak, isoWeekIdForDateKey } from "./daily-checkin.js";

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
