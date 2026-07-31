import { describe, expect, it } from "vitest";
import { normalizeImportRows } from "./import-utils.js";

describe("normalizeImportRows", () => {
  it("does not duplicate a basic card back into example", () => {
    const rows = normalizeImportRows([
      {
        card_type: "basic",
        front: "HTTP 404 表示什么？",
        back: "资源不存在或无法找到。",
        example: "资源不存在或无法找到。"
      }
    ]);

    expect(rows).toMatchObject([
      {
        card_type: "basic",
        front: "HTTP 404 表示什么？",
        back: "资源不存在或无法找到。",
        example: ""
      }
    ]);
  });

  it("keeps distinct basic card examples", () => {
    const rows = normalizeImportRows([
      {
        card_type: "basic",
        front: "牛顿第一定律是什么？",
        back: "物体在不受外力或合外力为零时保持静止或匀速直线运动。",
        example: "也称惯性定律。"
      }
    ]);

    expect(rows[0].example).toBe("也称惯性定律。");
  });

  it("splits multiple correct choice answers into individual options", () => {
    const rows = normalizeImportRows([{
      card_type: "choice",
      front: "哪些是质数？",
      options: "A. 2 | B. 4 | C. 5 | D. 6",
      answer: "A、C"
    }]);

    expect(rows[0]).toMatchObject({
      back: "A、C",
      choices: ["A. 2", "B. 4", "C. 5", "D. 6"]
    });
  });

  it("导入多空、每空多答案和乱序开关", () => {
    const rows = normalizeImportRows([{
      card_type: "blank",
      front: "[] and []",
      answer1: "red",
      answer1_alt1: "Red colour",
      answer1_alt2: "red",
      answer2: "blue",
      answer2_alt1: "Blue colour",
      blank_orderless: "yes",
      example: "Either order is accepted."
    }]);

    expect(rows).toEqual([{
      card_type: "blank",
      front: "[] and []",
      back: "red\nblue",
      phonetic: "",
      example: "Either order is accepted.",
      mnemonic: "",
      note: "",
      choices: {
        version: 1,
        orderless: true,
        answers: [["red", "Red colour"], ["blue", "Blue colour"]]
      }
    }]);
  });

  it("支持中文字段和任意编号的第三个空", () => {
    const rows = normalizeImportRows([{
      "卡片类型": "填空题",
      "题目": "[]、[]、[]",
      "答案1": "甲",
      "答案1备选1": "A",
      "答案2": "乙",
      "答案3": "丙",
      "乱序填空": "是"
    }]);

    expect(rows[0]).toMatchObject({
      back: "甲\n乙\n丙",
      choices: { version: 1, orderless: true, answers: [["甲", "A"], ["乙"], ["丙"]] }
    });
  });

  it("结构化答案缺号、缺主答案或与空位数不符时跳过", () => {
    const rows = normalizeImportRows([
      { card_type: "blank", front: "[] []", answer1: "A" },
      { card_type: "blank", front: "[] []", answer1: "A", answer2_alt1: "B" },
      { card_type: "blank", front: "[] []", answer1: "A", answer3: "C" }
    ]);
    expect(rows).toEqual([]);
  });

  it("继续接受旧 back 列填空题", () => {
    const rows = normalizeImportRows([{
      card_type: "blank",
      front: "I eat [] every day.",
      back: "apple 或 an apple",
      note: "legacy"
    }]);
    expect(rows[0]).toMatchObject({ card_type: "blank", back: "apple 或 an apple", choices: [] });
  });

  it("单空行会忽略模板中留空的后续答案列", () => {
    const rows = normalizeImportRows([{
      card_type: "blank",
      front: "I eat [] every day.",
      answer1: "apple",
      answer1_alt1: "an apple",
      answer2: "",
      answer2_alt1: "",
      blank_orderless: "false"
    }]);
    expect(rows[0]).toMatchObject({
      back: "apple",
      choices: { version: 1, orderless: false, answers: [["apple", "an apple"]] }
    });
  });
});
