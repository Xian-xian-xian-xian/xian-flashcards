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

type CardLike = { id: number };

export function removeStudyCardFromQueue<T extends CardLike>(sessionCards: T[], queue: T[], cardId: number) {
  return {
    sessionCards: sessionCards.filter((item) => item.id !== cardId),
    queue: queue.filter((item) => item.id !== cardId)
  };
}

export function isPhrasePartOfSpeech(value: string) {
  return /(?:^|[^a-z])phr\.(?=$|[^a-z])/i.test(value);
}
