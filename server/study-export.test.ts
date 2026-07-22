import { describe, expect, it } from "vitest";
import { buildDailyStudyMarkdown, isAllowedStudyExportDate, recentStudyDateKeys, type StudyExportEvent } from "./study-export";

const baseEvent: StudyExportEvent = {
  id: 1,
  card_id: 42,
  deck_id: 7,
  deck_name: "错题",
  deck_path: "英语 / CET4 / 错题",
  front: "apple",
  back: "苹果",
  event_kind: "new",
  rating: "known",
  stage_before: 0,
  stage_after: 1,
  answered_at: "2026-07-21T02:03:04.000Z"
};

describe("study export", () => {
  it("limits selectable dates to today and the previous 13 days", () => {
    const dates = recentStudyDateKeys("2026-07-22");
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe("2026-07-22");
    expect(dates.at(-1)).toBe("2026-07-09");
    expect(isAllowedStudyExportDate("2026-07-09", "2026-07-22")).toBe(true);
    expect(isAllowedStudyExportDate("2026-07-08", "2026-07-22")).toBe(false);
  });

  it("includes only card faces, folder hierarchy, counts, ratings, and every resulting stage", () => {
    const markdown = buildDailyStudyMarkdown("2026-07-21", [
      baseEvent,
      { ...baseEvent, id: 2, event_kind: "review", rating: "fuzzy", stage_before: 1, stage_after: 1, answered_at: "2026-07-21T03:04:05.000Z" }
    ]);
    expect(markdown).toContain("新学：1 次");
    expect(markdown).toContain("复习：1 次");
    expect(markdown).toContain("apple");
    expect(markdown).toContain("苹果");
    expect(markdown).toContain("大文件夹：英语");
    expect(markdown).toContain("子文件夹：CET4 / 错题");
    expect(markdown).toContain("### 正面");
    expect(markdown).toContain("### 反面");
    expect(markdown).not.toContain("题目 42");
    expect(markdown).toContain("| 掌握 | 第 0 阶段（未开始） → 第 1 阶段 | 第 1 阶段 |");
    expect(markdown).toContain("| 模糊 | 第 1 阶段 → 第 1 阶段 | 第 1 阶段 |");
    expect(markdown).not.toMatch(/音标|解析|助记|备注|选项|卡片类型/);
  });

  it("marks a root-level deck as having no subfolder", () => {
    const markdown = buildDailyStudyMarkdown("2026-07-21", [{ ...baseEvent, deck_name: "英语", deck_path: "英语" }]);
    expect(markdown).toContain("大文件夹：英语");
    expect(markdown).toContain("子文件夹：（无）");
  });

  it("generates a valid empty-day document", () => {
    expect(buildDailyStudyMarkdown("2026-07-21", [])).toContain("这一天没有学习记录。");
  });
});
