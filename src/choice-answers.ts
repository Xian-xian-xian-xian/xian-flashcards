export function normalizeChoiceAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function choiceOptionKey(value: string) {
  const normalized = normalizeChoiceAnswer(value);
  const match = normalized.match(/^([a-h])(?:[\s.)、:：-]+|$)/i);
  return match?.[1] ?? normalized;
}

export function choiceAnswersMatch(choice: string, answer: string) {
  return normalizeChoiceAnswer(choice) === normalizeChoiceAnswer(answer) || choiceOptionKey(choice) === choiceOptionKey(answer);
}

/**
 * Correct answers accept explicit separators. Commas only split label-based
 * answers (such as A,C), so normal prose remains a single answer.
 */
export function splitChoiceAnswers(value: string) {
  return value
    .split(/[|\n、]+|[；;](?=\s*\S)|[,，]\s*(?=[A-Ha-h](?:[\s.)、:：-]+|$))/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dedupeChoiceAnswers(answers: string[]) {
  return answers.reduce<string[]>((items, answer) => items.some((item) => choiceAnswersMatch(item, answer)) ? items : [...items, answer], []);
}

export function choiceAnswerSetMatches(selected: string[], correct: string[]) {
  const selectedAnswers = dedupeChoiceAnswers(selected);
  const correctAnswers = dedupeChoiceAnswers(correct);
  return selectedAnswers.length === correctAnswers.length
    && selectedAnswers.length > 0
    && correctAnswers.every((answer) => selectedAnswers.some((item) => choiceAnswersMatch(item, answer)));
}
