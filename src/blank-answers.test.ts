import { describe, expect, it } from "vitest";
import {
  blankAnswerDisplay,
  blankAnswerSeparator,
  blankAnswersMatch,
  normalizeBlankAnswerConfig,
  structuredBlankAnswersMatch
} from "./blank-answers";

const config = {
  version: 1 as const,
  orderless: false,
  answers: [["Apple", "an apple", "apples"], ["香蕉", "banana"]]
};

describe("填空题结构化答案", () => {
  it("每个空可命中任一备选答案并归一化大小写和空格", () => {
    expect(structuredBlankAnswersMatch(["  AN   APPLE ", "BANANA"], config)).toBe(true);
    expect(structuredBlankAnswersMatch(["banana", "apple"], config)).toBe(false);
  });

  it("乱序时严格一一配对，包含重叠备选时也不贪心误判", () => {
    expect(structuredBlankAnswersMatch(["B", "A"], {
      version: 1,
      orderless: true,
      answers: [["A", "B"], ["B"]]
    })).toBe(true);
    expect(structuredBlankAnswersMatch(["B", "B"], {
      version: 1,
      orderless: true,
      answers: [["A"], ["B"]]
    })).toBe(false);
  });

  it("缺少任一空或数量不符时判错", () => {
    expect(structuredBlankAnswersMatch(["apple", ""], config)).toBe(false);
    expect(structuredBlankAnswersMatch(["apple"], config)).toBe(false);
  });

  it("解析 JSON 时去重、限制每组数量并为单空关闭乱序", () => {
    const parsed = normalizeBlankAnswerConfig(JSON.stringify({
      version: 1,
      orderless: true,
      answers: [["A", " a ", "B", "C", "D", "E", "F", "G", "H", "I"]]
    }));
    expect(parsed).toEqual({ version: 1, orderless: false, answers: [["A", "B", "C", "D", "E", "F", "G", "H"]] });
  });

  it("保留旧卡的或答案和并列空位乱序兼容", () => {
    expect(blankAnswersMatch("I eat [] every day.", "apple 或 an apple", "[]", "an apple")).toBe(true);
    expect(blankAnswersMatch("[]、[]", "甲\n乙", "[]", `乙${blankAnswerSeparator}甲`)).toBe(true);
  });

  it("正确答案按空显示所有备选", () => {
    expect(blankAnswerDisplay(config)).toBe("空 1：Apple / an apple / apples\n空 2：香蕉 / banana");
  });
});
