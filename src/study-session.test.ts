import { describe, expect, it } from "vitest";
import { isPhrasePartOfSpeech, ratingShortcutForKey, shouldUsePractice, studyAnswerWeight, updateGrindStudyWords } from "./study-session";

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

  it("无尽模式继续下一轮时累计，只有明确重置时清零", () => {
    expect(updateGrindStudyWords(8, { type: "continue" })).toBe(8);
    expect(updateGrindStudyWords(8, { type: "answer", weight: 5 })).toBe(13);
    expect(updateGrindStudyWords(13, { type: "reset" })).toBe(0);
  });

  it("手动重置后，下一次作答只从 0 开始累计", () => {
    const reset = updateGrindStudyWords(13, { type: "reset" });
    expect(updateGrindStudyWords(reset, { type: "answer", weight: 1 })).toBe(1);
  });
});

describe("学习评分快捷键", () => {
  it("将数字 1、2、3 映射到不会、模糊、掌握", () => {
    expect(ratingShortcutForKey("1")).toBe("unknown");
    expect(ratingShortcutForKey("2")).toBe("fuzzy");
    expect(ratingShortcutForKey("3")).toBe("known");
    expect(ratingShortcutForKey("4")).toBeNull();
  });
});

describe("短语词性识别", () => {
  it("识别常见的 phr. 词性写法", () => {
    expect(isPhrasePartOfSpeech("phr. 照顾")).toBe(true);
    expect(isPhrasePartOfSpeech("**phr.** 照顾")).toBe(true);
    expect(isPhrasePartOfSpeech("v. 看；phr. 照顾")).toBe(true);
  });

  it("不会把其他文本误判为短语词性", () => {
    expect(isPhrasePartOfSpeech("n. 照料")).toBe(false);
    expect(isPhrasePartOfSpeech("ephrata")).toBe(false);
  });
});
