import { describe, expect, it } from "vitest";
import { shouldUsePractice, studyAnswerWeight } from "./study-session";

describe("学习会话评分路由", () => {
  it("新卡先模糊再掌握时重新提交长期排程", () => {
    expect(shouldUsePractice({
      alreadySubmitted: true,
      alreadyMastered: false,
      startedAsNew: true,
      rating: "known"
    })).toBe(false);
  });

  it("其他同轮重复评分仍使用短期练习", () => {
    expect(shouldUsePractice({
      alreadySubmitted: true,
      alreadyMastered: false,
      startedAsNew: true,
      rating: "fuzzy"
    })).toBe(true);
    expect(shouldUsePractice({
      alreadySubmitted: true,
      alreadyMastered: false,
      startedAsNew: false,
      rating: "known"
    })).toBe(true);
    expect(shouldUsePractice({
      alreadySubmitted: true,
      alreadyMastered: true,
      startedAsNew: true,
      rating: "known"
    })).toBe(true);
  });

  it("本轮第一次评分始终提交长期排程", () => {
    expect(shouldUsePractice({
      alreadySubmitted: false,
      alreadyMastered: false,
      startedAsNew: true,
      rating: "fuzzy"
    })).toBe(false);
  });
});

describe("学习数量加权", () => {
  it("新卡首次学习计 5，之后每次复习都计 1", () => {
    expect(studyAnswerWeight({ startedAsNew: true, alreadySubmitted: false })).toBe(5);
    expect(studyAnswerWeight({ startedAsNew: true, alreadySubmitted: true })).toBe(1);
  });

  it("旧卡每次复习都计 1", () => {
    expect(studyAnswerWeight({ startedAsNew: false, alreadySubmitted: false })).toBe(1);
    expect(studyAnswerWeight({ startedAsNew: false, alreadySubmitted: true })).toBe(1);
  });
});
