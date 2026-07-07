type CardType = "basic" | "word" | "choice" | "blank";

function normalizeCardType(value: unknown): CardType {
  const text = String(value ?? "").trim().toLowerCase();
  if (["word", "单词卡", "单词"].includes(text)) return "word";
  if (["choice", "选择题卡", "选择题", "multiple_choice"].includes(text)) return "choice";
  if (["blank", "填空题卡", "填空题", "cloze"].includes(text)) return "blank";
  return "basic";
}

function hasText(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function rowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (key in row && hasText(row[key])) return row[key];
  }
  return undefined;
}

function hasAnyKey(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => key in row);
}

function splitChoiceText(value: string) {
  return value
    .split(/[|\n]+|[；;](?=\s*\S)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeChoices(value: unknown, fallback: string[] = []) {
  let raw: unknown[] = fallback;
  if (Array.isArray(value)) raw = value;
  else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      raw = Array.isArray(parsed) ? parsed : fallback;
    } catch {
      raw = fallback;
    }
  } else if (typeof value === "string") {
    raw = splitChoiceText(value);
  }
  return Array.from(new Set(raw.map((item: unknown) => String(item ?? "").trim()).filter(Boolean))).slice(0, 8);
}

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function optionKey(value: string) {
  const normalized = normalizeAnswer(value);
  const match = normalized.match(/^([a-h])(?:[\s.)、:：-]+|$)/i);
  return match?.[1] ?? normalized;
}

function answersMatch(choice: string, answer: string) {
  return normalizeAnswer(choice) === normalizeAnswer(answer) || optionKey(choice) === optionKey(answer);
}

function dedupeChoiceOptions(choices: string[]) {
  return choices.reduce<string[]>((items, choice) => {
    const existingIndex = items.findIndex((item) => answersMatch(item, choice));
    if (existingIndex === -1) return [...items, choice];
    if (choice.length > items[existingIndex].length) {
      const nextItems = [...items];
      nextItems[existingIndex] = choice;
      return nextItems;
    }
    return items;
  }, []);
}

function addAnswerChoice(choices: string[], answer: string) {
  if (!answer.trim() || choices.some((choice) => answersMatch(choice, answer))) return choices;
  return [...choices, answer.trim()];
}

function importChoiceValues(row: Record<string, unknown>) {
  const optionValues = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    return rowValue(row, [`option${number}`, `Option${number}`, `选项${number}`, `选项 ${number}`]);
  });
  const combinedOptions = rowValue(row, ["options", "Options", "选项", "候选项"]);
  return normalizeChoices([
    ...optionValues,
    ...splitChoiceText(String(combinedOptions ?? ""))
  ]);
}

function inferCardType(row: Record<string, unknown>, front: string, choices: string[]): CardType {
  const explicit = rowValue(row, ["card_type", "type", "类型", "卡片类型", "题型"]);
  if (explicit !== undefined) return normalizeCardType(explicit);
  if (choices.length > 0 || hasAnyKey(row, ["option1", "Option1", "选项1", "options", "Options", "选项", "候选项"])) return "choice";
  if (/(\[\s*\]|_{2,}|（\s*）|\(\s*\))/.test(front)) return "blank";
  if (hasAnyKey(row, ["word", "单词", "phonetic", "音标", "meaning", "释义"])) return "word";
  return "basic";
}

function normalizedChoicePayload(cardType: CardType, choices: string[] | string, answer: string) {
  return cardType === "choice" ? addAnswerChoice(dedupeChoiceOptions(normalizeChoices(choices)), answer).slice(0, 8) : [];
}

function normalizeImportedExample(row: Record<string, unknown>, back: string, cardType: CardType) {
  const example = String(rowValue(row, ["example", "解析", "例句", "说明"]) ?? "").trim();
  return cardType === "basic" && normalizeAnswer(example) === normalizeAnswer(back) ? "" : example;
}

export function normalizeImportRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const values = Object.values(row).map((value) => String(value ?? "").trim());
      const choices = importChoiceValues(row);
      const front = String(rowValue(row, ["front", "question", "word", "题目", "正面", "单词"]) ?? values[0] ?? "").trim();
      const back = String(rowValue(row, ["back", "answer", "meaning", "答案", "背面", "释义"]) ?? values[1] ?? "").trim();
      const cardType = inferCardType(row, front, choices);
      return {
        card_type: cardType,
        front,
        back,
        phonetic: String(rowValue(row, ["phonetic", "音标"]) ?? "").trim(),
        example: normalizeImportedExample(row, back, cardType),
        mnemonic: String(rowValue(row, ["mnemonic", "助记"]) ?? "").trim(),
        note: String(rowValue(row, ["note", "备注", "注记"]) ?? "").trim(),
        choices: normalizedChoicePayload(cardType, choices, back)
      };
    })
    .filter((row) => row.front && row.back);
}
