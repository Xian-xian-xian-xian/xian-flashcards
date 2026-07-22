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

export function ratingShortcutForKey(key: string): ReviewRating | null {
  if (key === "1" || key === "<") return "unknown";
  if (key === "2" || key === ">") return "fuzzy";
  if (key === "3" || key === "?") return "known";
  return null;
}

type GrindStudyWordsAction =
  | { type: "answer"; weight: number }
  | { type: "continue" }
  | { type: "reset" };

export function updateGrindStudyWords(current: number, action: GrindStudyWordsAction) {
  if (action.type === "reset") return 0;
  if (action.type === "answer") return Math.max(0, current) + Math.max(0, action.weight);
  return Math.max(0, current);
}

export function isPhrasePartOfSpeech(value: string) {
  return /(?:^|[^a-z])phr\.(?=$|[^a-z])/i.test(value);
}
