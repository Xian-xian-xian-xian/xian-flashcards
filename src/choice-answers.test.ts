import { describe, expect, it } from "vitest";
import { choiceAnswerSetMatches, choiceAnswersMatch, splitChoiceAnswers } from "./choice-answers";

describe("multiple choice answers", () => {
  it("recognizes answer labels and common answer separators", () => {
    expect(splitChoiceAnswers("A、C\nD")).toEqual(["A", "C", "D"]);
    expect(splitChoiceAnswers("A,C")).toEqual(["A", "C"]);
    expect(splitChoiceAnswers("A，C")).toEqual(["A", "C"]);
    expect(splitChoiceAnswers("A|C")).toEqual(["A", "C"]);
    expect(choiceAnswersMatch("C. Correct choice", "c")).toBe(true);
  });

  it("keeps commas inside a single correct answer", () => {
    const answer = "RAM中既可写入信息，也可读出信息";
    expect(splitChoiceAnswers(answer)).toEqual([answer]);
    expect(choiceAnswerSetMatches([answer], splitChoiceAnswers(answer))).toBe(true);
  });

  it("requires the exact set of correct options", () => {
    expect(choiceAnswerSetMatches(["A. First", "C. Third"], ["A", "C"])).toBe(true);
    expect(choiceAnswerSetMatches(["A", "C", "D"], ["A", "C"])).toBe(false);
    expect(choiceAnswerSetMatches(["A"], ["A", "C"])).toBe(false);
  });
});
