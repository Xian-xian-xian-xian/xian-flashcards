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
});
