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

type GrindStudyWordsAction =
  | { type: "answer"; weight: number }
  | { type: "continue" }
  | { type: "rest" };

export function updateGrindStudyWords(current: number, action: GrindStudyWordsAction) {
  if (action.type === "rest") return 0;
  if (action.type === "answer") return Math.max(0, current) + Math.max(0, action.weight);
  return Math.max(0, current);
}
