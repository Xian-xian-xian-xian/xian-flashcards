import type { BlankAnswerConfig } from "./types";

export const blankAnswerSeparator = "\u001f";
export const maxBlankAlternatives = 8;

const blankMarkerPattern = /(\[\s*\]|_{2,}|（\s*）|\(\s*\))/g;

export function normalizeBlankAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function blankMarkerCount(value: string) {
  return Array.from(value.matchAll(blankMarkerPattern)).length;
}

export function effectiveBlankCount(value: string) {
  return Math.max(1, blankMarkerCount(value));
}

export function splitAlternativeAnswers(value: string) {
  return value
    .split(/\s*(?:或者|或|\bor\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitLegacyBlankAnswerText(value: string) {
  return value
    .split(new RegExp(`[${blankAnswerSeparator}\\n|/／、，,；;]+`))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeAnswerGroup(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => {
      const normalized = normalizeBlankAnswer(item);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, maxBlankAlternatives);
}

export function normalizeBlankAnswerConfig(value: unknown): BlankAnswerConfig | null {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const candidate = source as Partial<BlankAnswerConfig>;
  if (candidate.version !== 1 || !Array.isArray(candidate.answers)) return null;
  const answers = candidate.answers.map(normalizeAnswerGroup);
  if (answers.length === 0 || answers.some((group) => group.length === 0)) return null;
  return {
    version: 1,
    orderless: Boolean(candidate.orderless) && answers.length > 1,
    answers
  };
}

export function legacyBlankAnswerConfig(front: string, back: string): BlankAnswerConfig {
  const count = effectiveBlankCount(front);
  const parts = splitLegacyBlankAnswerText(back);
  const answers = count > 1 && parts.length === count
    ? parts.map((part) => splitAlternativeAnswers(part).slice(0, maxBlankAlternatives))
    : [splitAlternativeAnswers(back).slice(0, maxBlankAlternatives)];
  return {
    version: 1,
    orderless: count > 1 && blankOrderlessGroups(front, count).length > 0,
    answers: answers.map((group) => group.length ? group : [back.trim()]).slice(0, count)
  };
}

export function blankAnswerSummary(config: BlankAnswerConfig) {
  return config.answers.map((group) => group[0]?.trim() ?? "").join("\n");
}

export function blankAnswerDisplay(config: BlankAnswerConfig) {
  return config.answers
    .map((group, index) => `空 ${index + 1}：${group.join(" / ")}`)
    .join("\n");
}

export function blankAnswerSearchText(value: unknown) {
  return normalizeBlankAnswerConfig(value)?.answers.flat().join(" ") ?? "";
}

function matchesAnyAlternative(answer: string, correctAnswer: string) {
  const alternatives = splitAlternativeAnswers(correctAnswer);
  const candidates = alternatives.length > 0 ? alternatives : [correctAnswer];
  return candidates.some((candidate) => normalizeBlankAnswer(answer) === normalizeBlankAnswer(candidate));
}

function answerMatchesGroup(answer: string, group: string[]) {
  return Boolean(answer.trim()) && group.some((candidate) => normalizeBlankAnswer(answer) === normalizeBlankAnswer(candidate));
}

function orderlessAnswersMatch(answers: string[], groups: string[][], groupIndex = 0, used = new Set<number>()): boolean {
  if (groupIndex >= groups.length) return true;
  for (let answerIndex = 0; answerIndex < answers.length; answerIndex += 1) {
    if (used.has(answerIndex) || !answerMatchesGroup(answers[answerIndex], groups[groupIndex])) continue;
    used.add(answerIndex);
    if (orderlessAnswersMatch(answers, groups, groupIndex + 1, used)) return true;
    used.delete(answerIndex);
  }
  return false;
}

export function structuredBlankAnswersMatch(answers: string[], config: BlankAnswerConfig) {
  if (answers.length !== config.answers.length || answers.some((answer) => !answer.trim())) return false;
  if (config.orderless) return orderlessAnswersMatch(answers, config.answers);
  return answers.every((answer, index) => answerMatchesGroup(answer, config.answers[index]));
}

function blankOrderlessGroups(front: string, count: number) {
  const groups: number[][] = [];
  let currentGroup = [0];
  const parts = front.split(blankMarkerPattern);

  for (let index = 0; index < count - 1; index += 1) {
    const separator = parts[index * 2 + 2] ?? "";
    if (/[和与及、，,；;\/／]/.test(separator)) {
      currentGroup.push(index + 1);
      continue;
    }
    if (currentGroup.length > 1) groups.push(currentGroup);
    currentGroup = [index + 1];
  }

  if (currentGroup.length > 1) groups.push(currentGroup);
  return groups;
}

function legacyBlankAnswersMatch(front: string, back: string, answer: string) {
  const count = blankMarkerCount(front);
  const answers = answer.split(blankAnswerSeparator).map((item) => item.trim());
  const correctAnswers = splitLegacyBlankAnswerText(back);
  if (count > 1 && correctAnswers.length === count) {
    const matched = Array.from({ length: count }, () => false);
    for (const group of blankOrderlessGroups(front, count)) {
      const remaining = group.map((index) => answers[index]);
      if (remaining.some((item) => !item.trim())) return false;
      for (const index of group) {
        const matchedAnswerIndex = remaining.findIndex((item) => matchesAnyAlternative(item, correctAnswers[index]));
        if (matchedAnswerIndex === -1) return false;
        remaining.splice(matchedAnswerIndex, 1);
      }
      group.forEach((index) => { matched[index] = true; });
    }
    return answers.every((item, index) => matched[index] || Boolean(item.trim()) && matchesAnyAlternative(item, correctAnswers[index]));
  }
  if (count > 1) {
    const display = answers.map((part) => part.trim()).filter(Boolean).join("、");
    return normalizeBlankAnswer(display) === normalizeBlankAnswer(back);
  }
  const userAnswers = splitLegacyBlankAnswerText(answer);
  if (userAnswers.length === 1 && correctAnswers.length === 1) return matchesAnyAlternative(userAnswers[0], correctAnswers[0]);
  if (userAnswers.length > 1 && correctAnswers.length === userAnswers.length) {
    return userAnswers.map(normalizeBlankAnswer).sort().join("\n") === correctAnswers.map(normalizeBlankAnswer).sort().join("\n");
  }
  return normalizeBlankAnswer(answer) === normalizeBlankAnswer(back);
}

export function blankAnswersMatch(front: string, back: string, value: unknown, answer: string) {
  const config = normalizeBlankAnswerConfig(value);
  if (!config) return legacyBlankAnswersMatch(front, back, answer);
  const answers = answer.split(blankAnswerSeparator).map((item) => item.trim());
  return structuredBlankAnswersMatch(answers, config);
}
