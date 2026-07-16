import { describe, expect, it } from "vitest";
import { insertImageMarkdown } from "./card-images";

describe("card image markdown insertion", () => {
  it("inserts an uploaded image at the current selection", () => {
    expect(insertImageMarkdown("前文后文", 2, 2, "/api/card-images/1/example.png")).toEqual({
      value: "前文\n![图片](/api/card-images/1/example.png)\n后文",
      cursor: 40
    });
  });

  it("replaces selected text without adding unnecessary surrounding lines", () => {
    expect(insertImageMarkdown("前文\n旧内容\n后文", 3, 6, "/image.gif")).toEqual({
      value: "前文\n![图片](/image.gif)\n后文",
      cursor: 20
    });
  });
});
