import type { ReviewRating } from "./types";

type PracticeDecision = {
  alreadySubmitted: boolean;
  alreadyMastered: boolean;
  startedAsNew: boolean;
  rating: ReviewRating;
};

export function shouldUsePractice({ alreadySubmitted, alreadyMastered, startedAsNew, rating }: PracticeDecision) {
  if (!alreadySubmitted) return false;
  const isFirstNewCardMastery = startedAsNew && !alreadyMastered && rating === "known";
  return !isFirstNewCardMastery;
}

export function studyAnswerWeight({ startedAsNew, alreadySubmitted }: Pick<PracticeDecision, "startedAsNew" | "alreadySubmitted">) {
  return startedAsNew && !alreadySubmitted ? 5 : 1;
}
