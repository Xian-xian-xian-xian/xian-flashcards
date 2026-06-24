export type ReviewRating = "known" | "fuzzy" | "unknown";

export const EBBINGHAUS_INTERVALS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  2 * 24 * 60 * 60 * 1000,
  4 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  90 * 24 * 60 * 60 * 1000
];

export function nextReviewState(
  currentStage: number,
  rating: ReviewRating,
  now = new Date()
) {
  let nextStage = currentStage;
  let intervalMs = EBBINGHAUS_INTERVALS_MS[0];

  if (rating === "known") {
    nextStage = Math.min(currentStage + 1, EBBINGHAUS_INTERVALS_MS.length);
    intervalMs = EBBINGHAUS_INTERVALS_MS[nextStage - 1] ?? EBBINGHAUS_INTERVALS_MS.at(-1)!;
  }

  if (rating === "fuzzy") {
    nextStage = Math.max(currentStage, 1);
    intervalMs = 30 * 60 * 1000;
  }

  if (rating === "unknown") {
    nextStage = 1;
    intervalMs = EBBINGHAUS_INTERVALS_MS[0];
  }

  return {
    stage: nextStage,
    dueAt: new Date(now.getTime() + intervalMs).toISOString()
  };
}
