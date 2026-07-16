import { describe, expect, it } from "vitest";
import { resolveStudySwipe } from "./study-gestures";

describe("手机学习卡片滑动评级", () => {
  it("左滑不会，右滑掌握，下滑模糊", () => {
    expect(resolveStudySwipe(-90, 8)).toBe("unknown");
    expect(resolveStudySwipe(90, -8)).toBe("known");
    expect(resolveStudySwipe(5, 90, 0, 0)).toBe("fuzzy");
  });

  it("忽略短距离、方向不明确、向上滚动和非顶部下滑", () => {
    expect(resolveStudySwipe(-40, 2)).toBeNull();
    expect(resolveStudySwipe(90, 85)).toBeNull();
    expect(resolveStudySwipe(0, -100, 0, 40)).toBeNull();
    expect(resolveStudySwipe(0, 100, 24, 4)).toBeNull();
  });
});
