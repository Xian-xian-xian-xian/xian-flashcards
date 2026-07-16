import { describe, expect, it } from "vitest";
import { shouldUsePractice } from "./study-session";

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
