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

export type ReviewHistory = {
  known_count?: number;
  fuzzy_count?: number;
  unknown_count?: number;
};

function knownIntervalMultiplier(history: ReviewHistory) {
  const knownCount = Math.max(0, Number(history.known_count ?? 0));
  const fuzzyCount = Math.max(0, Number(history.fuzzy_count ?? 0));
  const unknownCount = Math.max(0, Number(history.unknown_count ?? 0));
  if (knownCount >= (fuzzyCount + unknownCount) * 2 + 3) return 1;
  if (unknownCount >= 3) return 0.6;
  if (fuzzyCount >= 3) return 0.8;
  return 1;
}

function shouldKeepKnownCardInFirstStage(currentStage: number, history: ReviewHistory) {
  const knownCount = Math.max(0, Number(history.known_count ?? 0));
  const fuzzyCount = Math.max(0, Number(history.fuzzy_count ?? 0));
  const unknownCount = Math.max(0, Number(history.unknown_count ?? 0));
  return currentStage <= 1 && knownCount === 0 && fuzzyCount + unknownCount > 0;
}

function fuzzyIntervalMs(currentStage: number) {
  if (currentStage <= 2) return 30 * 60 * 1000;
  if (currentStage <= 5) return 12 * 60 * 60 * 1000;
  if (currentStage <= 8) return 24 * 60 * 60 * 1000;
  return 3 * 24 * 60 * 60 * 1000;
}

export function nextReviewState(
  currentStage: number,
  rating: ReviewRating,
  now = new Date(),
  history: ReviewHistory = {}
) {
  let nextStage = currentStage;
  let intervalMs = EBBINGHAUS_INTERVALS_MS[0];

  if (rating === "known") {
    nextStage = shouldKeepKnownCardInFirstStage(currentStage, history)
      ? 1
      : Math.min(currentStage + 1, EBBINGHAUS_INTERVALS_MS.length);
    const baseIntervalMs = EBBINGHAUS_INTERVALS_MS[nextStage - 1] ?? EBBINGHAUS_INTERVALS_MS.at(-1)!;
    intervalMs = Math.round(baseIntervalMs * knownIntervalMultiplier(history));
  }

  if (rating === "fuzzy") {
    nextStage = Math.max(currentStage, 1);
    intervalMs = fuzzyIntervalMs(currentStage);
  }

  if (rating === "unknown") {
    if (currentStage <= 3) {
      nextStage = 1;
      intervalMs = EBBINGHAUS_INTERVALS_MS[0];
    } else if (currentStage <= 7) {
      nextStage = 2;
      intervalMs = 30 * 60 * 1000;
    } else {
      nextStage = Math.max(1, currentStage - 4);
      intervalMs = 30 * 60 * 1000;
    }
  }

  return {
    stage: nextStage,
    dueAt: new Date(now.getTime() + intervalMs).toISOString()
  };
}
