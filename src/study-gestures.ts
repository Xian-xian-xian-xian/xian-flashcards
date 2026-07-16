import type { ReviewRating } from "./types";

const swipeThreshold = 72;
const axisDominance = 1.2;
const scrollTopTolerance = 2;

export function resolveStudySwipe(deltaX: number, deltaY: number, startScrollTop = 0, endScrollTop = 0, threshold = swipeThreshold): ReviewRating | null {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (horizontalDistance >= threshold && horizontalDistance > verticalDistance * axisDominance) {
    return deltaX < 0 ? "unknown" : "known";
  }
  if (
    deltaY >= threshold
    && verticalDistance > horizontalDistance * axisDominance
    && startScrollTop <= scrollTopTolerance
    && endScrollTop <= scrollTopTolerance
  ) {
    return "fuzzy";
  }
  return null;
}
