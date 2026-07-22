export type StudyEventKind = "new" | "review";
export type StudyEventRating = "known" | "fuzzy" | "unknown";

export type StudyExportEvent = {
  id: number;
  card_id: number | null;
  deck_name: string;
  card_type: string;
  front: string;
  back: string;
  phonetic: string;
  example: string;
  mnemonic: string;
  note: string;
  choices: string;
  event_kind: StudyEventKind;
  rating: StudyEventRating;
  stage_before: number;
  stage_after: number;
  answered_at: string;
};

export const maxStudyExportDays = 14;

const ratingLabels: Record<StudyEventRating, string> = {
  known: "掌握",
  fuzzy: "模糊",
  unknown: "不会"
};

const cardTypeLabels: Record<string, string> = {
  basic: "普通卡",
  word: "单词卡",
  choice: "选择题",
  blank: "填空题"
};

export function previousDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function recentStudyDateKeys(today: string, count = maxStudyExportDays) {
  const dates = [today];
  while (dates.length < count) dates.push(previousDateKey(dates.at(-1)!));
  return dates;
}

export function isAllowedStudyExportDate(date: string, today: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && recentStudyDateKeys(today).includes(date);
}

function markdownBlock(value: string) {
  const text = value.trim();
  if (!text) return "（无）";
  const longestFence = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return `${fence}text\n${text}\n${fence}`;
}

function tableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function shanghaiTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function stageLabel(stage: number) {
  return stage <= 0 ? "第 0 阶段（未开始）" : `第 ${stage} 阶段`;
}

export function buildDailyStudyMarkdown(date: string, events: StudyExportEvent[]) {
  const newCount = events.filter((event) => event.event_kind === "new").length;
  const reviewCount = events.length - newCount;
  const grouped = new Map<string, StudyExportEvent[]>();
  events.forEach((event) => {
    const key = event.card_id === null ? `deleted-${event.id}` : String(event.card_id);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  });

  const lines = [
    `# 学习记录 · ${date}`,
    "",
    `- 新学：${newCount} 次`,
    `- 复习：${reviewCount} 次`,
    `- 合计：${events.length} 次`,
    `- 题目：${grouped.size} 道`,
    ""
  ];

  if (events.length === 0) {
    lines.push("这一天没有学习记录。", "");
    return lines.join("\n");
  }

  Array.from(grouped.values()).forEach((cardEvents, index) => {
    const first = cardEvents[0];
    const cardNewCount = cardEvents.filter((event) => event.event_kind === "new").length;
    const cardReviewCount = cardEvents.length - cardNewCount;
    lines.push(
      `## ${index + 1}. 题目 ${first.card_id ?? "（卡片已删除）"}`,
      "",
      `- 卡组：${first.deck_name || "（未命名）"}`,
      `- 类型：${cardTypeLabels[first.card_type] ?? first.card_type}`,
      `- 新学：${cardNewCount} 次；复习：${cardReviewCount} 次`,
      "",
      "### 题目",
      "",
      markdownBlock(first.front),
      "",
      "### 答案",
      "",
      markdownBlock(first.back),
      ""
    );
    const details = [
      ["音标", first.phonetic],
      ["例句 / 解析", first.example],
      ["助记", first.mnemonic],
      ["备注", first.note],
      ["选项 / 填空配置", first.choices]
    ].filter(([, value]) => value.trim() && value.trim() !== "[]");
    details.forEach(([label, value]) => lines.push(`### ${label}`, "", markdownBlock(value), ""));
    lines.push(
      "### 学习明细",
      "",
      "| 时间 | 学习类型 | 选择 | 阶段变化 | 本次结束后阶段 |",
      "| --- | --- | --- | --- | --- |"
    );
    cardEvents.forEach((event) => {
      lines.push(`| ${tableCell(shanghaiTime(event.answered_at))} | ${event.event_kind === "new" ? "新学" : "复习"} | ${ratingLabels[event.rating]} | ${stageLabel(event.stage_before)} → ${stageLabel(event.stage_after)} | ${stageLabel(event.stage_after)} |`);
    });
    lines.push("");
  });

  return lines.join("\n");
}
