import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import AlignCenter from "lucide-react/dist/esm/icons/align-center";
import AlignLeft from "lucide-react/dist/esm/icons/align-left";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Bell from "lucide-react/dist/esm/icons/bell";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Brain from "lucide-react/dist/esm/icons/brain";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import Edit3 from "lucide-react/dist/esm/icons/edit-3";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import FileSpreadsheet from "lucide-react/dist/esm/icons/file-spreadsheet";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import HelpCircle from "lucide-react/dist/esm/icons/help-circle";
import Home from "lucide-react/dist/esm/icons/home";
import ImageIcon from "lucide-react/dist/esm/icons/image";
import Info from "lucide-react/dist/esm/icons/info";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Moon from "lucide-react/dist/esm/icons/moon";
import MoveRight from "lucide-react/dist/esm/icons/move-right";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Rows2 from "lucide-react/dist/esm/icons/rows-2";
import Save from "lucide-react/dist/esm/icons/save";
import Search from "lucide-react/dist/esm/icons/search";
import SettingsIcon from "lucide-react/dist/esm/icons/settings";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Square from "lucide-react/dist/esm/icons/square";
import SquareCheck from "lucide-react/dist/esm/icons/square-check";
import Star from "lucide-react/dist/esm/icons/star";
import Sun from "lucide-react/dist/esm/icons/sun";
import Target from "lucide-react/dist/esm/icons/target";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Type from "lucide-react/dist/esm/icons/type";
import UserIcon from "lucide-react/dist/esm/icons/user";
import Volume2 from "lucide-react/dist/esm/icons/volume-2";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, type CardPayload, type ConflictError } from "./api";
import type { Card, CardType, DailyTask, Deck, ReviewRating, ReviewRemaining, ReviewSnapshot, Settings, Stats, SyncStatus, ThemeMode, User } from "./types";

type View = "home" | "deck" | "study" | "import" | "settings" | "about";
type SyncState = "idle" | "syncing" | "success" | "error" | "conflict";
type StudyMode = "review" | "new" | "grind";
type ReviewResult = { stage: number; dueAt: string; previous: ReviewSnapshot };
type PracticeResult = { stage: number; dueAt: string; previous: Pick<ReviewSnapshot, "dailyTaskPrevious"> };
type KatexRuntime = { renderToString: (value: string, options: { displayMode?: boolean; throwOnError: boolean; trust: boolean; strict: "ignore" }) => string };

declare global {
  interface Window {
    katex?: KatexRuntime;
  }
}

const version = "0.4.3";
const logExportPressCount = 6;
const logExportKey = "a";
const logExportResetMs = 1800;
const blankAnswerSeparator = "\u001f";
const studyRootDeckStoragePrefix = "xian-flashcards-study-root-deck";

const cardTypeLabels: Record<CardType, string> = {
  basic: "普通卡",
  word: "单词卡",
  choice: "选择题卡",
  blank: "填空题卡"
};

const emptyDailyTask: DailyTask = {
  date: "",
  daily_new_goal: 20,
  new_completed: 0,
  new_mastered: 0,
  review_total: 0,
  review_completed: 0,
  review_mastered: 0,
  completed: false,
  completed_at: "",
  streak: 0
};

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSpeechLanguage(value?: string) {
  const language = String(value ?? "").trim();
  if (language.toLowerCase().startsWith("en")) return "en-GB";
  return language || "en-GB";
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

function parseChoices(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    // Fall through to separator parsing.
  }
  return splitChoiceText(value);
}

type MarkdownBlock =
  | { type: "code"; language: string; content: string }
  | { type: "math"; content: string }
  | { type: "blank"; count: number }
  | { type: "text"; content: string };

function splitChoiceText(value: string) {
  return value
    .split(/[|\n]+|[；;](?=\s*\S)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitBlankAnswerText(value: string) {
  return value
    .split(new RegExp(`[${blankAnswerSeparator}\\n|/／、，,；;]+`))
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitAlternativeAnswers(value: string) {
  return value
    .split(/\s*(?:或者|或|\bor\b)\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesAnyAlternative(answer: string, correctAnswer: string) {
  const alternatives = splitAlternativeAnswers(correctAnswer);
  const candidates = alternatives.length > 0 ? alternatives : [correctAnswer];
  return candidates.some((candidate) => normalizeAnswer(answer) === normalizeAnswer(candidate));
}

function blankAnswerPartMatches(answer: string, correctAnswer: string) {
  return Boolean(answer.trim()) && matchesAnyAlternative(answer, correctAnswer);
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

function pushMarkdownTextBlocks(blocks: MarkdownBlock[], value: string) {
  value.split(/(\n{2,})/).forEach((part) => {
    if (!part) return;
    if (/^\n{2,}$/.test(part)) {
      blocks.push({ type: "blank", count: part.length - 1 });
      return;
    }
    const content = part.replace(/^\n+|\n+$/g, "").trim();
    if (content) blocks.push({ type: "text", content });
  });
}

function markdownBlocks(value: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/(^|\n)([*_]{2})[ \t]*(```[\w-]*\n[\s\S]*?\n?```)[ \t]*\2(?=\n|$)/g, "$1$3");
  const pattern = /```([\w-]*)[ \t]*\n([\s\S]*?)\n?```|\$\$\n?([\s\S]*?)\n?\$\$|\\\[\n?([\s\S]*?)\n?\\\]|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|split)\}([\s\S]*?)\\end\{(?:equation\*?|align\*?|gather\*?|multline\*?|split)\}/g;
  let lastIndex = 0;

  normalized.replace(pattern, (match, language, code, dollarMath, bracketMath, environment, environmentMath, offset) => {
    const before = normalized.slice(lastIndex, offset);
    pushMarkdownTextBlocks(blocks, before);
    if (match.startsWith("```")) {
      blocks.push({ type: "code", language: String(language || "").trim(), content: String(code ?? "").replace(/\n$/, "") });
    } else {
      const math = dollarMath ?? bracketMath ?? (environment ? `\\begin{${environment}}${environmentMath ?? ""}\\end{${environment}}` : "");
      blocks.push({ type: "math", content: String(math).trim() });
    }
    lastIndex = offset + match.length;
    return match;
  });

  pushMarkdownTextBlocks(blocks, normalized.slice(lastIndex));
  return blocks;
}

const escapedMarkdownPattern = /\\([\\`*_#+\-.!|>~$])/g;

function protectEscapedMarkdown(value: string) {
  const escaped: string[] = [];
  const text = value.replace(escapedMarkdownPattern, (_match, char) => {
    const token = `\uE000${escaped.length}\uE001`;
    escaped.push(char);
    return token;
  });
  const restore = (part: string) => part.replace(/\uE000(\d+)\uE001/g, (_match, index) => escaped[Number(index)] ?? "");
  return { text, restore };
}

const blankMarkerPattern = /(\[\s*\]|_{2,}|（\s*）|\(\s*\))/g;

const inlineMarkdownPattern = /(!\[[^\]]*]\([^)]+\)|\\\((.*?)\\\)|\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|split)\}(.+?)\\end\{(?:equation\*?|align\*?|gather\*?|multline\*?|split)\}|\$([^$\n]+)\$|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*|_[^_]+_)/g;
const bareMathPattern = /((?:\\[a-zA-Z]+\s*)?[A-Za-z][A-Za-z0-9]*\s*\([^)\n]*\)\s*=\s*[A-Za-z0-9{}()[\]^_+\-\\\s]+|[A-Za-z0-9{}()[\]^_+\-\\]+\s*=\s*[A-Za-z0-9{}()[\]^_+\-\\\s]+)/g;

function sanitizeLatex(value: string) {
  return value
    .replace(/\\notag\b/g, "")
    .replace(/\\begin\{equation\*?\}/g, "")
    .replace(/\\end\{equation\*?\}/g, "")
    .trim();
}

function looksLikeBareMath(value: string) {
  const text = value.trim();
  if (!text || /[\u4e00-\u9fff]/.test(text)) return false;
  if (/^\\[a-zA-Z]+/.test(text)) return true;
  if (!/[=^_{}\\]/.test(text)) return false;
  if (/[<>]/.test(text)) return false;
  return /^[A-Za-z0-9\s()[\]{}.,;:+\-*/=^_\\]+$/.test(text);
}

function MathText(props: { value: string; displayMode?: boolean }) {
  const html = useMemo(() => window.katex?.renderToString(sanitizeLatex(props.value), {
    displayMode: props.displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore"
  }), [props.value, props.displayMode]);
  if (!html) return <span className={props.displayMode ? "math-block" : "math-inline"}>{props.value}</span>;
  return <span className={props.displayMode ? "math-block" : "math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
}

function pushPlainTextWithBareMath(nodes: ReactNode[], value: string, restore: (part: string) => string) {
  let lastIndex = 0;
  value.replace(bareMathPattern, (match, _formula, offset) => {
    if (offset > lastIndex) nodes.push(restore(value.slice(lastIndex, offset)));
    const restored = restore(match);
    nodes.push(looksLikeBareMath(restored) ? <MathText key={nodes.length} value={restored} /> : restored);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < value.length) nodes.push(restore(value.slice(lastIndex)));
}

function renderInlineMarkdown(value: string) {
  const nodes: ReactNode[] = [];
  const protectedValue = protectEscapedMarkdown(value);
  const source = protectedValue.text;
  let lastIndex = 0;
  source.replace(inlineMarkdownPattern, (match, _image, parenMath, environment, environmentMath, dollarMath, offset) => {
    if (offset > lastIndex) pushPlainTextWithBareMath(nodes, source.slice(lastIndex, offset), protectedValue.restore);
    if (match.startsWith("![")) {
      const image = match.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      nodes.push(image ? <img key={nodes.length} src={protectedValue.restore(image[2]).trim()} alt={protectedValue.restore(image[1])} loading="lazy" /> : protectedValue.restore(match));
    } else if (parenMath !== undefined) {
      nodes.push(<MathText key={nodes.length} value={protectedValue.restore(parenMath)} />);
    } else if (environment) {
      nodes.push(<MathText key={nodes.length} value={protectedValue.restore(`\\begin{${environment}}${environmentMath ?? ""}\\end{${environment}}`)} />);
    } else if (dollarMath !== undefined) {
      nodes.push(<MathText key={nodes.length} value={protectedValue.restore(dollarMath)} />);
    } else if (match.startsWith("**") || match.startsWith("__")) {
      nodes.push(<strong key={nodes.length}>{protectedValue.restore(match.slice(2, -2))}</strong>);
    } else if (match.startsWith("~~")) {
      nodes.push(<del key={nodes.length}>{protectedValue.restore(match.slice(2, -2))}</del>);
    } else if (match.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{protectedValue.restore(match.slice(1, -1))}</code>);
    } else if (match.startsWith("[")) {
      const link = match.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(link ? <a key={nodes.length} href={protectedValue.restore(link[2])} target="_blank" rel="noreferrer">{protectedValue.restore(link[1])}</a> : protectedValue.restore(match));
    } else {
      nodes.push(<em key={nodes.length}>{protectedValue.restore(match.slice(1, -1))}</em>);
    }
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < source.length) pushPlainTextWithBareMath(nodes, source.slice(lastIndex), protectedValue.restore);
  return nodes;
}

function renderInlineMarkdownWithBlanks(value: string, renderBlank?: (key: string) => ReactNode) {
  if (!renderBlank) return renderInlineMarkdown(value);
  const nodes: ReactNode[] = [];
  value.split(blankMarkerPattern).forEach((part, index) => {
    if (!part) return;
    if (blankMarkerPattern.test(part)) {
      blankMarkerPattern.lastIndex = 0;
      nodes.push(renderBlank(`blank-${index}`));
      return;
    }
    blankMarkerPattern.lastIndex = 0;
    nodes.push(...renderInlineMarkdown(part));
  });
  blankMarkerPattern.lastIndex = 0;
  return nodes;
}

function renderMarkdownLines(lines: string[], renderBlank?: (key: string) => ReactNode) {
  return lines.map((line, lineIndex) => <span key={lineIndex} className="markdown-line">{renderInlineMarkdownWithBlanks(line, renderBlank)}</span>);
}

function renderMarkdownTextBlock(content: string, index: number, renderBlank?: (key: string) => ReactNode) {
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(content)) return <hr key={index} className="markdown-divider" />;
  const lines = content.split("\n");
  if (lines.some((line) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line))) {
    const nodes: ReactNode[] = [];
    let paragraph: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      nodes.push(renderMarkdownTextBlock(paragraph.join("\n"), nodes.length, renderBlank));
      paragraph = [];
    };
    lines.forEach((line) => {
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushParagraph();
        nodes.push(<hr key={nodes.length} className="markdown-divider" />);
      } else {
        paragraph.push(line);
      }
    });
    flushParagraph();
    return <span key={index} className="markdown-fragment">{nodes}</span>;
  }
  const heading = content.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    return <strong key={index} className={`markdown-heading level-${level}`}>{renderInlineMarkdownWithBlanks(heading[2], renderBlank)}</strong>;
  }
  if (lines.every((line) => /^\s*> ?/.test(line))) {
    return <blockquote key={index}>{renderMarkdownLines(lines.map((line) => line.replace(/^\s*> ?/, "")), renderBlank)}</blockquote>;
  }
  if (lines.every((line) => /^\s*[-+*]\s+/.test(line))) {
    return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInlineMarkdownWithBlanks(line.replace(/^\s*[-+*]\s+/, ""), renderBlank)}</li>)}</ul>;
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return <ol key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInlineMarkdownWithBlanks(line.replace(/^\s*\d+[.)]\s+/, ""), renderBlank)}</li>)}</ol>;
  }
  if (lines.length >= 2 && lines.every((line) => /^\s*\|.*\|\s*$/.test(line)) && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[1])) {
    const rows = lines.filter((_, rowIndex) => rowIndex !== 1).map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    return (
      <span key={index} className="markdown-table-wrap">
        <table>
          <thead><tr>{rows[0].map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdownWithBlanks(cell, renderBlank)}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdownWithBlanks(cell, renderBlank)}</td>)}</tr>)}</tbody>
        </table>
      </span>
    );
  }
  return <span key={index} className="markdown-paragraph">{renderMarkdownLines(lines, renderBlank)}</span>;
}

function MarkdownText(props: { value: string; className?: string; renderBlank?: (key: string) => ReactNode }) {
  const blocks = markdownBlocks(props.value);
  if (blocks.length === 0) return null;
  return (
    <span className={`markdown-text ${props.className ?? ""}`}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <span key={index} className="code-block">
              {block.language && <span className="code-language">{block.language}</span>}
              <code>{block.content}</code>
            </span>
          );
        }
        if (block.type === "math") return <MathText key={index} value={block.content} displayMode />;
        if (block.type === "blank") return <span key={index} className="markdown-blank-line" style={{ "--blank-lines": String(block.count) } as CSSProperties} />;
        return renderMarkdownTextBlock(block.content, index, props.renderBlank);
      })}
    </span>
  );
}

function scrollToPageTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
}

function FeedbackBlock(props: { label: string; value: string; kind: "explanation" | "other" }) {
  if (!props.value.trim()) return null;
  return (
    <div className={`feedback-block ${props.kind}`}>
      <span>{props.label}</span>
      <MarkdownText value={props.value} />
    </div>
  );
}

function LabeledMarkdown(props: { label: string; value: string }) {
  if (!props.value.trim()) return null;
  return (
    <span className="labeled-markdown">
      <span className="labeled-markdown-label">{props.label}</span>
      <MarkdownText value={props.value} />
    </span>
  );
}

function hasBlankMarker(value: string) {
  blankMarkerPattern.lastIndex = 0;
  const found = blankMarkerPattern.test(value);
  blankMarkerPattern.lastIndex = 0;
  return found;
}

function blankMarkerCount(value: string) {
  blankMarkerPattern.lastIndex = 0;
  const count = Array.from(value.matchAll(blankMarkerPattern)).length;
  blankMarkerPattern.lastIndex = 0;
  return count;
}

function blankIndexFromKey(key: string) {
  const sourceIndex = Number(key.replace("blank-", ""));
  return Number.isFinite(sourceIndex) ? Math.floor(sourceIndex / 2) : 0;
}

function splitBlankAnswers(value: string, count: number) {
  const parts = value.split(blankAnswerSeparator);
  return Array.from({ length: Math.max(1, count) }, (_, index) => parts[index] ?? "");
}

function setBlankAnswerPart(value: string, count: number, index: number, nextPart: string) {
  const parts = splitBlankAnswers(value, count);
  parts[index] = nextPart;
  return parts.join(blankAnswerSeparator);
}

function displayBlankAnswer(value: string) {
  return value.split(blankAnswerSeparator).map((part) => part.trim()).filter(Boolean).join("、");
}

function isWordCard(card: Card) {
  return card.card_type === "word";
}

function correctAnswer(card: Card) {
  return card.back;
}

function isCorrectAnswer(card: Card, answer: string) {
  if (card.card_type === "blank") {
    const count = blankMarkerCount(card.front);
    const answers = splitBlankAnswers(answer, count).map((item) => item.trim());
    const correctAnswers = splitBlankAnswerText(card.back);
    if (count > 1 && correctAnswers.length === count) {
      const matched = Array.from({ length: count }, () => false);
      for (const group of blankOrderlessGroups(card.front, count)) {
        const remaining = group.map((index) => answers[index]);
        if (remaining.some((item) => !item.trim())) return false;
        for (const index of group) {
          const matchedAnswerIndex = remaining.findIndex((item) => matchesAnyAlternative(item, correctAnswers[index]));
          if (matchedAnswerIndex === -1) return false;
          remaining.splice(matchedAnswerIndex, 1);
        }
        group.forEach((index) => { matched[index] = true; });
      }
      return answers.every((item, index) => matched[index] || blankAnswerPartMatches(item, correctAnswers[index]));
    }
    if (count > 1) return normalizeAnswer(displayBlankAnswer(answer)) === normalizeAnswer(card.back);
    const userAnswers = splitBlankAnswerText(answer);
    if (userAnswers.length === 1 && correctAnswers.length === 1) return matchesAnyAlternative(userAnswers[0], correctAnswers[0]);
    if (userAnswers.length > 1 && correctAnswers.length === userAnswers.length) {
      return userAnswers.map(normalizeAnswer).sort().join("\n") === correctAnswers.map(normalizeAnswer).sort().join("\n");
    }
  }
  const normalized = normalizeAnswer(answer);
  return normalized === normalizeAnswer(correctAnswer(card));
}

function inferCardType(front: string, back: string, choices: string[], phonetic: string, mnemonic: string): CardType {
  if (choices.length > 0) return "choice";
  if (/(\[\s*\]|_{2,}|（\s*）|\(\s*\))/.test(front)) return "blank";
  if (phonetic.trim() || mnemonic.trim()) return "word";
  return back.trim().length > 0 ? "basic" : "word";
}

function dueText(value: string) {
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  if (Number.isNaN(date.getTime())) return "时间未知";
  if (diff <= 0) return "现在到期";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}

function reviewStageIntervalText(stage: number) {
  const intervals = ["5 分钟", "30 分钟", "12 小时", "1 天", "2 天", "4 天", "7 天", "15 天", "30 天", "90 天"];
  if (stage <= 0) return "首次学习";
  return intervals[Math.min(stage, intervals.length) - 1] ?? intervals.at(-1)!;
}

function studyScheduleText(card: Card) {
  if (card.stage <= 0) return "新卡 · 首次学习";
  return `阶段 ${card.stage} · ${reviewStageIntervalText(card.stage)}`;
}

function fullDateTime(value: string) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function studyRootDeckStorageKey(userId: number) {
  return `${studyRootDeckStoragePrefix}:${userId}`;
}

function readStoredStudyRootDeckId(userId: number, decks: Deck[]) {
  const storedId = Number(window.localStorage.getItem(studyRootDeckStorageKey(userId)));
  return Number.isFinite(storedId) && decks.some((deck) => deck.id === storedId && deck.depth === 1) ? storedId : null;
}

function writeStoredStudyRootDeckId(userId: number | null, deckId: number | null) {
  if (!userId || !deckId) return;
  window.localStorage.setItem(studyRootDeckStorageKey(userId), String(deckId));
}

function nextStudyQueue(queue: Card[], card: Card, rating: ReviewRating, result: { stage: number; dueAt: string }) {
  const rest = queue.slice(1);
  if (rating === "known") return rest;
  const repeatCard = { ...card, stage: result.stage, due_at: result.dueAt, last_rating: rating };
  const repeatIndex = Math.min(rating === "unknown" ? 1 : 3, rest.length);
  return [...rest.slice(0, repeatIndex), repeatCard, ...rest.slice(repeatIndex)];
}

function clampGrindGroupSize(value: unknown) {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return 15;
  return Math.min(100, Math.max(1, size));
}

function appendUniqueCards(cards: Card[], nextCards: Card[]) {
  const seen = new Set(cards.map((card) => card.id));
  return [
    ...cards,
    ...nextCards.filter((card) => {
      if (seen.has(card.id)) return false;
      seen.add(card.id);
      return true;
    })
  ];
}

function playAnswerSound(result: "right" | "wrong") {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(result === "right" ? 0.2 : 0.12, context.currentTime + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (result === "right" ? 0.58 : 0.18));

    const tones = result === "right"
      ? [
          { frequency: 523.25, start: 0, length: 0.16 },
          { frequency: 659.25, start: 0.07, length: 0.17 },
          { frequency: 783.99, start: 0.14, length: 0.2 },
          { frequency: 1046.5, start: 0.25, length: 0.28 }
        ]
      : [
          { frequency: 220, start: 0, length: 0.12 },
          { frequency: 165, start: 0.055, length: 0.12 }
        ];
    tones.forEach(({ frequency, start, length }) => {
      const oscillator = context.createOscillator();
      oscillator.type = result === "right" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
      oscillator.connect(master);
      oscillator.start(context.currentTime + start);
      oscillator.stop(context.currentTime + start + length);
    });
    if (result === "right") {
      [1568, 2093, 2637].forEach((frequency, index) => {
        const sparkle = context.createOscillator();
        const sparkleGain = context.createGain();
        sparkle.type = "triangle";
        sparkle.frequency.setValueAtTime(frequency, context.currentTime + 0.12 + index * 0.075);
        sparkleGain.gain.setValueAtTime(0.0001, context.currentTime + 0.12 + index * 0.075);
        sparkleGain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.135 + index * 0.075);
        sparkleGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25 + index * 0.075);
        sparkle.connect(sparkleGain).connect(context.destination);
        sparkle.start(context.currentTime + 0.12 + index * 0.075);
        sparkle.stop(context.currentTime + 0.27 + index * 0.075);
      });
    }
    window.setTimeout(() => context.close().catch(() => undefined), result === "right" ? 760 : 360);
  } catch {
    // Browsers can deny audio startup until a user gesture; feedback still works without sound.
  }
}

function playCompletionSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.25);

    [392, 523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index % 2 === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.09);
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.04 + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32 + index * 0.09);
      oscillator.connect(gain).connect(master);
      oscillator.start(context.currentTime + index * 0.09);
      oscillator.stop(context.currentTime + 0.38 + index * 0.09);
    });

    [1568, 2093, 2637, 3136].forEach((frequency, index) => {
      const sparkle = context.createOscillator();
      const gain = context.createGain();
      sparkle.type = "triangle";
      sparkle.frequency.setValueAtTime(frequency, context.currentTime + 0.45 + index * 0.07);
      gain.gain.setValueAtTime(0.0001, context.currentTime + 0.45 + index * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.47 + index * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.62 + index * 0.07);
      sparkle.connect(gain).connect(master);
      sparkle.start(context.currentTime + 0.45 + index * 0.07);
      sparkle.stop(context.currentTime + 0.68 + index * 0.07);
    });
    window.setTimeout(() => context.close().catch(() => undefined), 1500);
  } catch {
    // Completion animation still gives feedback when audio is unavailable.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type LocalFontData = {
  family: string;
  fullName: string;
  postscriptName: string;
};

const studyFontOptions: Array<{ value: string; label: string }> = [
  { value: "system", label: "系统" },
  { value: "rounded", label: "圆体" },
  { value: "serif", label: "宋体" },
  { value: "mono", label: "等宽" }
];

function cssQuotedFontFamily(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function studyFontStack(value: string) {
  const preset: Record<string, string> = {
    system: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
    rounded: "ui-rounded, \"PingFang SC\", \"Microsoft YaHei\", \"Hiragino Sans GB\", sans-serif",
    serif: "\"Noto Serif CJK SC\", \"Songti SC\", SimSun, serif",
    mono: "\"SFMono-Regular\", Consolas, \"Liberation Mono\", \"Microsoft YaHei Mono\", monospace"
  };
  return preset[value] ?? `${cssQuotedFontFamily(value)}, ${preset.system}`;
}

async function queryInstalledFonts() {
  const queryLocalFonts = (window as Window & { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!queryLocalFonts) throw new Error("当前浏览器不支持读取系统字体");
  const fonts = await queryLocalFonts();
  return Array.from(new Set(fonts.map((font) => font.family).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [canRegister, setCanRegister] = useState(false);
  const [view, setView] = useState<View>("home");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [studyRootDeckId, setStudyRootDeckId] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [stats, setStats] = useState<Stats>({ total_cards: 0, mastered_cards: 0, due_cards: 0 });
  const [settings, setSettings] = useState<Settings>({
    theme: "system",
    voiceLanguage: "en-GB",
    notifications: "off",
    autoSpeak: "off",
    dailyNewGoal: 20,
    studyTextScale: 1,
    studyTextAlign: "center",
    studyChoiceLayout: "auto",
    studyLineHeight: 1.5,
    studyFontFamily: "system"
  });
  const [dailyTask, setDailyTask] = useState<DailyTask>(emptyDailyTask);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [conflict, setConflict] = useState<{ id: number; payload: CardPayload; serverCard: Card } | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);

  const rootDecks = useMemo(() => decks.filter((deck) => deck.depth === 1), [decks]);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];
  const studyRootDeck = rootDecks.find((deck) => deck.id === studyRootDeckId) ?? rootDecks[0];
  const filteredCards = useMemo(() => {
    const query = normalizeAnswer(search);
    return cards.filter((card) => {
      if (!query) return true;
      return normalizeAnswer(`${card.front} ${card.phonetic} ${card.back} ${card.example} ${card.mnemonic} ${card.note} ${parseChoices(card.choices).join(" ")}`).includes(query);
    });
  }, [cards, search]);

  async function refresh(options: { silent?: boolean } = {}) {
    if (!options.silent) setSyncState("syncing");
    try {
      const [nextDecks, nextStats, nextSettings, nextDailyTask, nextSyncStatus] = await Promise.all([
        api.decks(),
        api.stats(),
        api.settings(),
        api.dailyTask(),
        api.syncStatus()
      ]);
      setDecks(nextDecks);
      setStats(nextStats);
      setSettings(nextSettings);
      setDailyTask(nextDailyTask);
      setSyncStatus(nextSyncStatus);
      applyTheme(nextSettings.theme);
      setSelectedDeckId((current) => current && nextDecks.some((deck) => deck.id === current) ? current : nextDecks[0]?.id ?? null);
      const fallbackRootId = nextDecks.find((deck) => deck.depth === 1)?.id ?? null;
      const nextRootId = (studyRootDeckId && nextDecks.some((deck) => deck.id === studyRootDeckId && deck.depth === 1))
        ? studyRootDeckId
        : user
          ? readStoredStudyRootDeckId(user.id, nextDecks) ?? fallbackRootId
          : fallbackRootId;
      setStudyRootDeckId(nextRootId);
      writeStoredStudyRootDeckId(user?.id ?? null, nextRootId);
      const rootId = nextRootId;
      setDueCards(rootId ? await api.dueCards(rootId, 80) : []);
      if (!options.silent) setSyncState("success");
    } catch (error) {
      setSyncState("error");
      showToast((error as Error).message, "error");
    }
  }

  async function loadCards(deckId: number) {
    setCards(await api.cards(deckId));
  }

  async function afterMutation(message?: string) {
    if (selectedDeckId) await loadCards(selectedDeckId);
    await refresh({ silent: true });
    setSyncState("success");
    if (message) showToast(message);
  }

  function showToast(message: string, kind: "success" | "error" = "success") {
    setToast({ message, kind });
  }

  async function withPending<T>(key: string, action: () => Promise<T>) {
    if (pending[key]) return undefined;
    setPending((current) => ({ ...current, [key]: true }));
    try {
      return await action();
    } catch (error) {
      showToast((error as Error).message, "error");
      return undefined;
    } finally {
      setPending((current) => ({ ...current, [key]: false }));
    }
  }

  async function updateCardWithConflict(id: number, payload: CardPayload) {
    let updatedCard: Card | null = null;
    try {
      const result = await api.updateCard(id, payload);
      updatedCard = result.card;
    } catch (error) {
      const nextError = error as ConflictError;
      if (nextError.status === 409 && nextError.serverCard) {
        setConflict({ id, payload, serverCard: nextError.serverCard });
        setSyncState("conflict");
        return;
      }
      throw error;
    }
    await afterMutation();
    return updatedCard;
  }

  function selectStudyRootDeck(id: number) {
    setStudyRootDeckId(id);
    writeStoredStudyRootDeckId(user?.id ?? null, id);
  }

  useEffect(() => {
    api.authStatus()
      .then((status) => {
        setUser(status.user);
        setCanRegister(status.canRegister);
        if (status.authenticated) return refresh();
      })
      .catch((error) => showToast(error.message, "error"))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user) refresh().catch((error) => showToast(error.message, "error"));
  }, [user?.id]);

  useEffect(() => {
    if (selectedDeckId) loadCards(selectedDeckId).catch((error) => showToast(error.message, "error"));
  }, [selectedDeckId]);

  useEffect(() => {
    if (!studyRootDeckId) return;
    api.dueCards(studyRootDeckId, 80).then(setDueCards).catch((error) => showToast(error.message, "error"));
  }, [studyRootDeckId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => {
      if (settings.theme === "system") applyTheme("system");
    };
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [settings.theme]);

  useEffect(() => {
    let pressCount = 0;
    let resetTimer = 0;
    const reset = () => {
      pressCount = 0;
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = 0;
    };
    const downloadRecentLogs = async () => {
      try {
        const { blob, filename } = await api.exportRecentLogs();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast("已导出最近 10 分钟日志");
      } catch (error) {
        showToast((error as Error).message, "error");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key.toLowerCase() !== logExportKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      pressCount += 1;
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(reset, logExportResetMs);
      if (pressCount < logExportPressCount) return;
      reset();
      downloadRecentLogs();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      reset();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => refresh({ silent: true }), 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [user?.id, studyRootDeckId]);

  useEffect(() => {
    if (settings.notifications !== "on" || dueCards.length === 0 || Notification.permission !== "granted") return;
    const timer = window.setTimeout(() => {
      new Notification("该复习啦", {
        body: `${studyRootDeck?.name ?? "当前卡组"} 有 ${dueCards.length} 张卡片到期。`
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dueCards.length, settings.notifications, studyRootDeck?.name]);

  function speakWithBrowser(text: string, language?: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = normalizeSpeechLanguage(language ?? selectedDeck?.language ?? settings.voiceLanguage);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function speak(text: string, language?: string) {
    const speechLanguage = normalizeSpeechLanguage(language ?? selectedDeck?.language ?? settings.voiceLanguage);
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    window.speechSynthesis.cancel();
    if (!speechLanguage.toLowerCase().startsWith("en")) {
      speakWithBrowser(text, speechLanguage);
      return;
    }
    try {
      const blob = await api.synthesizeSpeech({ text, language: speechLanguage });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      speechAudioRef.current = audio;
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
    } catch (error) {
      console.warn("阿里云英式发音不可用，回退到浏览器发音", error);
      speakWithBrowser(text, speechLanguage);
    }
  }

  async function handleAnswer(card: Card, rating: ReviewRating) {
    try {
      const result = await api.answer(card.id, rating);
      setDailyTask(await api.dailyTask());
      return result;
    } catch (error) {
      showToast((error as Error).message, "error");
      throw error;
    }
  }

  async function handlePractice(card: Card, rating: ReviewRating) {
    try {
      const result = await api.practice(card.id, rating);
      setDailyTask(await api.dailyTask());
      return result;
    } catch (error) {
      showToast((error as Error).message, "error");
      throw error;
    }
  }

  if (!authChecked) {
    return <div className="auth-shell"><div className="auth-panel"><p className="eyebrow">闪记</p><h1>正在检查登录状态</h1></div></div>;
  }

  if (!user) {
    return <LoginView canRegister={canRegister} onAuthed={(nextUser) => { setUser(nextUser); setCanRegister(false); }} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark">闪</span>
          <span>闪记</span>
        </div>
        <div className="user-pill">
          <UserIcon />
          <span>{user.username}</span>
        </div>
        <NavButton icon={<Home />} label="首页" active={view === "home"} onClick={() => setView("home")} />
        <NavButton icon={<BookOpen />} label="卡组" active={view === "deck"} onClick={() => setView("deck")} />
        <NavButton icon={<Brain />} label="学习" active={view === "study"} onClick={() => setView("study")} />
        <NavButton icon={<FileSpreadsheet />} label="导入" active={view === "import"} onClick={() => setView("import")} />
        <NavButton icon={<SettingsIcon />} label="设置" active={view === "settings"} onClick={() => setView("settings")} />
        <NavButton icon={<Info />} label="关于" active={view === "about"} onClick={() => setView("about")} />
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">严格艾宾浩斯复习</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="top-actions">
            <button className={`sync-button ${syncState}`} title="同步" disabled={syncState === "syncing"} onClick={() => withPending("sync", () => refresh())}>
              <RefreshCw />
              <span>{syncLabel(syncState)}</span>
            </button>
            <button className="icon-button" title="切换主题" disabled={Boolean(pending.theme)} onClick={() => saveTheme(settings.theme === "dark" ? "light" : "dark")}>
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="icon-button" title="通知" disabled={Boolean(pending.notify)} onClick={enableNotifications}>
              <Bell />
            </button>
            <button className="icon-button" title="退出登录" disabled={Boolean(pending.logout)} onClick={logout}>
              <LogOut />
            </button>
          </div>
        </header>

        {toast && <button className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.message}</button>}
        {conflict && (
          <ConflictDialog
            conflict={conflict}
            onKeepServer={async () => {
              setConflict(null);
              await afterMutation("已保留服务器版本");
            }}
            onOverwrite={async () => {
              await api.updateCard(conflict.id, { ...conflict.payload, force: true, baseUpdatedAt: conflict.serverCard.updated_at });
              setConflict(null);
              await afterMutation("已覆盖为本机版本");
            }}
          />
        )}

        {view === "home" && (
          <HomeView
            decks={decks}
            rootDecks={rootDecks}
            dueCards={dueCards}
            dailyTask={dailyTask}
            stats={stats}
            onOpenDeck={(id) => {
              setSelectedDeckId(id);
              setView("deck");
            }}
            onStudy={(id) => {
              selectStudyRootDeck(id);
              setView("study");
            }}
          />
        )}

        {view === "deck" && (
          <DeckView
            decks={decks}
            selectedDeckId={selectedDeckId}
            cards={filteredCards}
            search={search}
            onSearch={setSearch}
            onSelectDeck={setSelectedDeckId}
            onCreateDeck={async (name, parentId) => {
              try {
                const result = await api.createDeck({ name, parentId, language: settings.voiceLanguage });
                setSelectedDeckId(result.id);
                await afterMutation();
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onUpdateDeck={async (id, name) => {
              try {
                await api.updateDeck(id, { name });
                await afterMutation();
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onDeleteDeck={async (id) => {
              try {
                await api.deleteDeck(id);
                setSelectedDeckId(null);
                await afterMutation();
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onCreateCard={async (payload) => {
              try {
                if (!selectedDeckId) return;
                await api.createCard(selectedDeckId, payload);
                await afterMutation();
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onUpdateCard={updateCardWithConflict}
            onDeleteCard={async (id) => {
              try {
                await api.deleteCard(id);
                await afterMutation();
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onBatchCards={async (cardIds, action, deckId) => {
              try {
                const result = await api.batchCards({ cardIds, action, deckId });
                await afterMutation(action === "delete" ? `已删除 ${result.affected} 张卡片` : `已移动 ${result.affected} 张卡片`);
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onToggleFavorite={async (card) => {
              try {
                await updateCardWithConflict(card.id, { favorite: card.favorite ? 0 : 1, baseUpdatedAt: card.updated_at });
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onSpeak={speak}
          />
        )}

        {view === "study" && (
          <StudyView
            cards={dueCards}
            rootDecks={rootDecks}
            selectedRootDeckId={studyRootDeckId}
            onSelectRootDeck={selectStudyRootDeck}
            selectedDeck={studyRootDeck}
            studyTextScale={settings.studyTextScale}
            studyTextAlign={settings.studyTextAlign}
            studyChoiceLayout={settings.studyChoiceLayout}
            studyLineHeight={settings.studyLineHeight}
            studyFontFamily={settings.studyFontFamily}
            onStudyTextScale={async (studyTextScale) => {
              await api.saveSettings({ studyTextScale });
              setSettings((current) => ({ ...current, studyTextScale }));
            }}
            onStudyTextAlign={async (studyTextAlign) => {
              await api.saveSettings({ studyTextAlign });
              setSettings((current) => ({ ...current, studyTextAlign }));
            }}
            onStudyChoiceLayout={async (studyChoiceLayout) => {
              await api.saveSettings({ studyChoiceLayout });
              setSettings((current) => ({ ...current, studyChoiceLayout }));
            }}
            onStudyLineHeight={async (studyLineHeight) => {
              await api.saveSettings({ studyLineHeight });
              setSettings((current) => ({ ...current, studyLineHeight }));
            }}
            onStudyFontFamily={async (studyFontFamily) => {
              await api.saveSettings({ studyFontFamily });
              setSettings((current) => ({ ...current, studyFontFamily }));
            }}
            autoSpeak={settings.autoSpeak === "on"}
            onAnswer={handleAnswer}
            onPractice={handlePractice}
            onUndoAnswer={async (card, snapshot) => {
              try {
                await api.restoreReview(card.id, snapshot);
                await afterMutation("已撤销上一张");
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onUndoPractice={async (card, snapshot) => {
              try {
                await api.restorePractice(card.id, snapshot);
                await afterMutation("已撤销上一张");
              } catch (error) {
                showToast((error as Error).message, "error");
                throw error;
              }
            }}
            onUpdateCard={updateCardWithConflict}
            onSpeak={speak}
          />
        )}

        {view === "import" && (
          <ImportView
            decks={decks}
            selectedDeckId={selectedDeckId}
            onSelectDeck={setSelectedDeckId}
            onImported={async (message) => afterMutation(message)}
            onError={(message) => showToast(message, "error")}
          />
        )}

        {view === "settings" && (
          <SettingsView
            settings={settings}
            onThemeChange={saveTheme}
            onSave={async (next) => {
              await withPending("settings", async () => {
                const previous = settings;
                const merged = { ...settings, ...next };
                setSettings(merged);
                applyTheme(merged.theme);
                try {
                  if (next.dailyNewGoal !== undefined) await api.saveDailyTaskSettings({ dailyNewGoal: Number(next.dailyNewGoal) });
                  await api.saveSettings(next);
                  await afterMutation("设置已保存");
                } catch (error) {
                  setSettings(previous);
                  applyTheme(previous.theme);
                  throw error;
                }
              });
            }}
            onNotify={enableNotifications}
            saving={Boolean(pending.settings)}
            notifying={Boolean(pending.notify)}
          />
        )}

        {view === "about" && <AboutView syncStatus={syncStatus} />}
      </main>
    </div>
  );

  async function saveTheme(theme: ThemeMode) {
    await withPending("theme", async () => {
      const previous = settings.theme;
      setSettings((current) => ({ ...current, theme }));
      applyTheme(theme);
      try {
        await api.saveSettings({ theme });
        await afterMutation("主题已保存");
      } catch (error) {
        setSettings((current) => ({ ...current, theme: previous }));
        applyTheme(previous);
        throw error;
      }
    });
  }

  async function enableNotifications() {
    await withPending("notify", async () => {
      if (!("Notification" in window)) {
        showToast("当前浏览器不支持通知", "error");
        return;
      }
      const permission = await Notification.requestPermission();
      const enabled = permission === "granted";
      await api.saveSettings({ notifications: enabled ? "on" : "off" });
      setSettings((current) => ({ ...current, notifications: enabled ? "on" : "off" }));
      await afterMutation(enabled ? "通知已开启" : "通知未授权");
    });
  }

  async function logout() {
    await withPending("logout", async () => {
      await api.logout();
      setUser(null);
      setDecks([]);
      setCards([]);
      setDueCards([]);
      setSelectedDeckId(null);
      setStudyRootDeckId(null);
      setView("home");
    });
  }
}

function LoginView(props: { canRegister: boolean; onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">(props.canRegister ? "register" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = mode === "register"
        ? await api.register({ username, password })
        : await api.login({ username, password });
      props.onAuthed(result.user);
    } catch (nextError) {
      setError((nextError as Error).message);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <span className="brand-mark">闪</span>
          <span>闪记</span>
        </div>
        <p className="eyebrow">{mode === "register" ? "首次设置管理员账号" : "登录后访问你的卡片"}</p>
        <h1>{mode === "register" ? "创建账号" : "登录"}</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} /></label>
          <label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} /></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-button"><UserIcon />{mode === "register" ? "创建并登录" : "登录"}</button>
        </form>
        {props.canRegister && (
          <button className="text-button" type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "已有账号，去登录" : "首次使用，创建账号"}
          </button>
        )}
      </section>
    </div>
  );
}

function viewTitle(view: View) {
  return {
    home: "今日任务",
    deck: "卡组管理",
    study: "按卡组学习",
    import: "批量导入",
    settings: "设置",
    about: "关于"
  }[view];
}

function syncLabel(state: SyncState) {
  return {
    idle: "同步",
    syncing: "同步中",
    success: "已同步",
    error: "同步失败",
    conflict: "有冲突"
  }[state];
}

function NavButton(props: { icon: JSX.Element; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function HomeView(props: {
  decks: Deck[];
  rootDecks: Deck[];
  dueCards: Card[];
  dailyTask: DailyTask;
  stats: Stats;
  onOpenDeck: (id: number) => void;
  onStudy: (id: number) => void;
}) {
  const mastered = props.stats.total_cards ? Math.round((props.stats.mastered_cards / props.stats.total_cards) * 100) : 0;
  const dailyTarget = Math.max(props.dailyTask.daily_new_goal + props.dailyTask.review_total, 1);
  const dailyDone = Math.min(props.dailyTask.new_mastered, props.dailyTask.daily_new_goal) + Math.min(props.dailyTask.review_completed, props.dailyTask.review_total);
  const dailyProgress = props.dailyTask.completed ? 100 : Math.round((dailyDone / dailyTarget) * 100);
  const reviewMasterRate = props.dailyTask.review_total ? Math.round((props.dailyTask.review_mastered / props.dailyTask.review_total) * 100) : 0;
  return (
    <section className="stack">
      <div className={`hero-panel daily-hero ${props.dailyTask.completed ? "complete" : ""}`}>
        <div className="daily-glow" aria-hidden="true" />
        <div>
          <p className="eyebrow">今日打卡</p>
          <div className="streak-heading">
            <h2>{props.dailyTask.completed ? "已完成" : `${props.dailyTask.new_mastered}/${props.dailyTask.daily_new_goal} 新学掌握`}</h2>
            <span className={`streak-badge ${props.dailyTask.completed ? "done" : ""}`}><CheckCircle2 />连续 {props.dailyTask.streak} 天</span>
          </div>
          <p>新学接触 {props.dailyTask.new_completed} · 复习处理 {props.dailyTask.review_completed}/{props.dailyTask.review_total} · 掌握 {props.dailyTask.review_mastered} 张</p>
          <div className="daily-progress" aria-label={`今日进度 ${dailyProgress}%`}>
            <span style={{ width: `${dailyProgress}%` }} />
          </div>
        </div>
        <div className="daily-medal" aria-hidden="true">
          <Sparkles />
          <strong>{dailyProgress}%</strong>
        </div>
        <button className="primary-button" disabled={props.rootDecks.length === 0} onClick={() => props.rootDecks[0] && props.onStudy(props.rootDecks[0].id)}>
          <Sparkles />开始学习
        </button>
      </div>

      <div className="metric-grid">
        <Metric label="总卡片" value={props.stats.total_cards || 0} />
        <Metric label="已掌握" value={`${mastered}%`} />
        <Metric label="到期复习" value={props.stats.due_cards || 0} />
      </div>

      <div className="task-strip">
        <TaskItem icon={<Target />} label="每日新学" value={`${props.dailyTask.new_mastered}/${props.dailyTask.daily_new_goal} 掌握 · 接触 ${props.dailyTask.new_completed}`} done={props.dailyTask.new_mastered >= props.dailyTask.daily_new_goal} />
        <TaskItem icon={<ListChecks />} label="既有复习" value={`${props.dailyTask.review_completed}/${props.dailyTask.review_total} 处理 · 掌握率 ${reviewMasterRate}%`} done={props.dailyTask.review_completed >= props.dailyTask.review_total} />
        <TaskItem icon={<CheckCircle2 />} label="连续打卡" value={`${props.dailyTask.streak} 天`} done={props.dailyTask.completed} />
      </div>

      <div className="section-heading"><h2>大卡组复习</h2></div>
      <div className="deck-grid">
        {props.rootDecks.map((deck) => (
          <button className="deck-card" key={deck.id} onClick={() => props.onStudy(deck.id)}>
            <span className="deck-icon"><BookOpen /></span>
            <strong>{deck.name}</strong>
            <span>{deck.total_card_count || deck.card_count || 0} 张 · {deck.due_count || 0} 到期</span>
          </button>
        ))}
        {props.decks.length === 0 && <EmptyState text="先创建一个卡组，再导入表格或手动添加卡片。" />}
      </div>

      <div className="section-heading"><h2>即将复习</h2></div>
      <div className="list">
        {props.dueCards.slice(0, 6).map((card) => (
          <div className="list-row" key={card.id}>
            <strong>{card.front}</strong>
            <span>{cardTypeLabels[card.card_type]} · {card.back}</span>
          </div>
        ))}
        {props.dueCards.length === 0 && <EmptyState text="暂无到期卡片。新卡学习后会进入艾宾浩斯队列。" />}
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string | number }) {
  return <div className="metric"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function TaskItem(props: { icon: JSX.Element; label: string; value: string; done: boolean }) {
  return (
    <div className={`task-item ${props.done ? "done" : ""}`}>
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function DeckView(props: {
  decks: Deck[];
  selectedDeckId: number | null;
  cards: Card[];
  search: string;
  onSearch: (value: string) => void;
  onSelectDeck: (id: number) => void;
  onCreateDeck: (name: string, parentId?: number | null) => Promise<void>;
  onUpdateDeck: (id: number, name: string) => Promise<void>;
  onDeleteDeck: (id: number) => Promise<void>;
  onCreateCard: (payload: CardPayload) => Promise<void>;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<Card | null | undefined>;
  onDeleteCard: (id: number) => Promise<void>;
  onBatchCards: (cardIds: number[], action: "move" | "delete", deckId?: number) => Promise<void>;
  onToggleFavorite: (card: Card) => Promise<void>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [deckName, setDeckName] = useState("");
  const [parentDeckId, setParentDeckId] = useState<number | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<number | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [openDeckMenuId, setOpenDeckMenuId] = useState<number | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [detailCard, setDetailCard] = useState<Card | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [batchTargetDeckId, setBatchTargetDeckId] = useState<number | null>(props.selectedDeckId);
  const [deckPanelCollapsed, setDeckPanelCollapsed] = useState(false);
  const [busy, setBusy] = useState("");

  const allVisibleSelected = props.cards.length > 0 && props.cards.every((card) => selectedCardIds.includes(card.id));

  useEffect(() => {
    setSelectedCardIds((ids) => ids.filter((id) => props.cards.some((card) => card.id === id)));
  }, [props.cards]);

  useEffect(() => {
    setBatchTargetDeckId(props.selectedDeckId);
  }, [props.selectedDeckId]);

  async function addDeck(event: FormEvent) {
    event.preventDefault();
    if (!deckName.trim() || busy) return;
    setBusy("create-deck");
    try {
      await props.onCreateDeck(deckName.trim(), parentDeckId);
      setDeckName("");
      setParentDeckId(null);
    } finally {
      setBusy("");
    }
  }

  function toggleCard(id: number) {
    setSelectedCardIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  function toggleAllCards() {
    setSelectedCardIds(allVisibleSelected ? [] : props.cards.map((card) => card.id));
  }

  async function batchDelete() {
    if (selectedCardIds.length === 0 || busy) return;
    if (!window.confirm(`删除选中的 ${selectedCardIds.length} 张卡片？`)) return;
    setBusy("batch-delete");
    try {
      await props.onBatchCards(selectedCardIds, "delete");
      setSelectedCardIds([]);
    } finally {
      setBusy("");
    }
  }

  async function batchMove() {
    if (selectedCardIds.length === 0 || !batchTargetDeckId || busy) return;
    setBusy("batch-move");
    try {
      await props.onBatchCards(selectedCardIds, "move", batchTargetDeckId);
      setSelectedCardIds([]);
    } finally {
      setBusy("");
    }
  }

  async function deleteCard(card: Card) {
    if (busy) return;
    if (!window.confirm(`删除「${card.front}」这张卡片？`)) return;
    setBusy(`delete-card-${card.id}`);
    try {
      await props.onDeleteCard(card.id);
    } finally {
      setBusy("");
    }
  }

  async function toggleFavorite(card: Card) {
    if (busy) return;
    setBusy(`favorite-${card.id}`);
    try {
      await props.onToggleFavorite(card);
    } finally {
      setBusy("");
    }
  }

  function selectDeck(id: number) {
    props.onSelectDeck(id);
    setDeckPanelCollapsed(true);
  }

  return (
    <section className={`two-column deck-workspace ${deckPanelCollapsed ? "deck-panel-collapsed" : ""}`}>
      <div className="panel deck-sidebar-panel">
        <div className="panel-heading">
          <h2>卡组</h2>
          <button className="mini-button" title="隐藏卡组列表" onClick={() => setDeckPanelCollapsed(true)}><PanelLeftClose /></button>
        </div>
        <form className="inline-form" onSubmit={addDeck}>
          <input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="新卡组名称" />
          <select value={parentDeckId ?? ""} onChange={(event) => setParentDeckId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">顶层</option>
            {props.decks.filter((deck) => deck.depth < 5).map((deck) => (
              <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>
            ))}
          </select>
          <button className="icon-button strong" title="创建卡组" disabled={busy === "create-deck"}><Plus /></button>
        </form>
        <div className="deck-list">
          {props.decks.map((deck) => (
            <div className={`deck-list-row depth-${Math.min(deck.depth, 5)}`} key={deck.id}>
              <button className={`deck-list-item ${deck.id === props.selectedDeckId ? "active" : ""}`} onClick={() => selectDeck(deck.id)}>
                <span className="deck-name">{deck.depth > 1 && <i />}<strong>{deck.name}</strong></span>
                <span className="deck-count">{deck.total_card_count || deck.card_count || 0} 张</span>
              </button>
              <div className="deck-menu">
                <button className="mini-button" title="更多操作" onClick={() => setOpenDeckMenuId((current) => current === deck.id ? null : deck.id)}><MoreHorizontal /></button>
                {openDeckMenuId === deck.id && (
                  <div className="deck-menu-popover">
                    <button disabled={deck.depth >= 5} onClick={() => { setParentDeckId(deck.id); setDeckName(`${deck.name} / `); setOpenDeckMenuId(null); }}><FolderPlus /><span>子卡组</span></button>
                    <button onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setOpenDeckMenuId(null); scrollToPageTop(); }}><Edit3 /><span>编辑</span></button>
                    <button className="danger" disabled={Boolean(busy)} onClick={async () => { setOpenDeckMenuId(null); if (window.confirm(`删除「${deck.name}」及其子卡组和卡片？`)) { setBusy(`delete-deck-${deck.id}`); try { await props.onDeleteDeck(deck.id); } finally { setBusy(""); } } }}><Trash2 /><span>删除</span></button>
                  </div>
                )}
              </div>
              {editingDeckId === deck.id && (
                <form className="edit-row" onSubmit={async (event) => { event.preventDefault(); if (editingDeckName.trim() && !busy) { setBusy(`edit-deck-${deck.id}`); try { await props.onUpdateDeck(deck.id, editingDeckName.trim()); setEditingDeckId(null); } finally { setBusy(""); } } }}>
                  <input value={editingDeckName} onChange={(event) => setEditingDeckName(event.target.value)} />
                  <button className="mini-button strong" title="保存卡组" disabled={busy === `edit-deck-${deck.id}`}><Save /></button>
                  <button className="mini-button" title="取消" type="button" onClick={() => setEditingDeckId(null)}><XCircle /></button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide-panel">
        <div className="toolbar">
          {deckPanelCollapsed && (
            <button className="mini-button" title="显示卡组列表" onClick={() => setDeckPanelCollapsed(false)}><PanelLeftOpen /></button>
          )}
          <div className="search"><Search /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索题目、答案、选项、例句" /></div>
        </div>
        <CardEditor onSubmit={props.onCreateCard} />
        {editingCard && <CardEditor card={editingCard} onCancel={() => setEditingCard(null)} onSubmit={async (payload) => { await props.onUpdateCard(editingCard.id, { ...payload, baseUpdatedAt: editingCard.updated_at }); setEditingCard(null); }} />}
        <div className="batch-toolbar">
          <button className="mini-button" title="全选" onClick={toggleAllCards}>{allVisibleSelected ? <SquareCheck /> : <Square />}</button>
          <strong>{selectedCardIds.length ? `已选 ${selectedCardIds.length} 张` : "批量管理"}</strong>
          <select value={batchTargetDeckId ?? ""} onChange={(event) => setBatchTargetDeckId(event.target.value ? Number(event.target.value) : null)}>
            <option value="" disabled>移动到卡组</option>
            {props.decks.map((deck) => <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>)}
          </select>
          <button className="primary-button secondary-button" disabled={selectedCardIds.length === 0 || !batchTargetDeckId || Boolean(busy)} onClick={batchMove}><MoveRight />{busy === "batch-move" ? "移动中" : "移动"}</button>
          <button className="primary-button danger-button" disabled={selectedCardIds.length === 0 || Boolean(busy)} onClick={batchDelete}><Trash2 />{busy === "batch-delete" ? "删除中" : "删除"}</button>
        </div>
        <div className="card-list">
          {props.cards.map((card) => (
            <article className="word-card" key={card.id}>
              <div>
                <div className="word-title">
                  <button className="mini-button" title="选择卡片" onClick={() => toggleCard(card.id)}>{selectedCardIds.includes(card.id) ? <SquareCheck /> : <Square />}</button>
                  <strong>{card.front}</strong>
                  <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
                  {isWordCard(card) && card.phonetic && <span className="phonetic">{card.phonetic}</span>}
                  <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front)}><Volume2 /></button>
                  <button className={`mini-button ${card.favorite ? "starred" : ""}`} title="收藏" disabled={busy === `favorite-${card.id}`} onClick={() => toggleFavorite(card)}><Star /></button>
                  <button className="mini-button" title="详情" onClick={() => setDetailCard(card)}><Eye /></button>
                  <button className="mini-button" title="编辑" onClick={() => { setEditingCard(card); scrollToPageTop(); }}><Edit3 /></button>
                </div>
                <p>{card.back}</p>
                {card.example && <small>{card.example}</small>}
                {parseChoices(card.choices).length > 0 && <small>选项：{parseChoices(card.choices).join(" / ")}</small>}
                {isWordCard(card) && card.mnemonic && <small>助记：{card.mnemonic}</small>}
              </div>
              <div className="card-meta">
                <span>阶段 {card.stage}/10</span>
                <span>下次 {dueText(card.due_at)}</span>
                <button className="mini-button danger" title="删除" disabled={busy === `delete-card-${card.id}`} onClick={() => deleteCard(card)}><Trash2 /></button>
              </div>
            </article>
          ))}
          {props.cards.length === 0 && <EmptyState text="这个卡组还没有卡片。" />}
        </div>
      </div>
      {detailCard && <CardDetail card={detailCard} onClose={() => setDetailCard(null)} />}
    </section>
  );
}

function CardEditor(props: { card?: Card; onSubmit: (payload: CardPayload) => Promise<void>; onCancel?: () => void }) {
  const [front, setFront] = useState(props.card?.front ?? "");
  const [phonetic, setPhonetic] = useState(props.card?.phonetic ?? "");
  const [back, setBack] = useState(props.card?.back ?? "");
  const [example, setExample] = useState(props.card?.example ?? "");
  const [mnemonic, setMnemonic] = useState(props.card?.mnemonic ?? "");
  const [note, setNote] = useState(props.card?.note ?? "");
  const [choices, setChoices] = useState(parseChoices(props.card?.choices).join(" | "));
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(props.card && (props.card.phonetic || props.card.example || props.card.mnemonic || props.card.note || parseChoices(props.card.choices).length > 0)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFront(props.card?.front ?? "");
    setPhonetic(props.card?.phonetic ?? "");
    setBack(props.card?.back ?? "");
    setExample(props.card?.example ?? "");
    setMnemonic(props.card?.mnemonic ?? "");
    setNote(props.card?.note ?? "");
    setChoices(parseChoices(props.card?.choices).join(" | "));
    setAdvancedOpen(Boolean(props.card && (props.card.phonetic || props.card.example || props.card.mnemonic || props.card.note || parseChoices(props.card.choices).length > 0)));
  }, [props.card?.id, props.card?.updated_at]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!front.trim() || !back.trim() || saving) return;
    setSaving(true);
    try {
      const parsedChoices = parseChoices(choices);
      const cardType = inferCardType(front, back, parsedChoices, phonetic, mnemonic);
      await props.onSubmit({
        card_type: cardType,
        front,
        back,
        phonetic,
        example,
        mnemonic,
        note,
        choices: cardType === "choice" ? parsedChoices : []
      });
      if (!props.card) {
        setFront("");
        setPhonetic("");
        setBack("");
        setExample("");
        setMnemonic("");
        setNote("");
        setChoices("");
        setAdvancedOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`card-form ${props.card ? "edit-card-form" : ""}`} onSubmit={submit}>
      <SmartTextField value={front} onChange={setFront} placeholder="正面 / 题目，填空题使用 [] 表示空格" required allowImageInsert />
      <SmartTextField value={back} onChange={setBack} placeholder="背面 / 正确答案" required allowImageInsert />
      <button className="primary-button secondary-button" type="button" onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal />高级字段</button>
      {advancedOpen && (
        <div className="advanced-fields">
          <SmartTextField value={choices} onChange={setChoices} placeholder="选择题选项，用 |、; 分隔，或一行一个选项" multilineThreshold={28} />
          <SmartTextField value={phonetic} onChange={setPhonetic} placeholder="音标（可选）" />
          <SmartTextField value={example} onChange={setExample} placeholder="例句 / 说明 / 解析（可选）" />
          <SmartTextField value={mnemonic} onChange={setMnemonic} placeholder="助记（可选）" />
          <SmartTextField value={note} onChange={setNote} placeholder="备注（可选）" />
        </div>
      )}
      <button className="primary-button" disabled={saving}>{props.card ? <Save /> : <Plus />}{saving ? "处理中" : props.card ? "保存" : "添加"}</button>
      {props.onCancel && <button className="primary-button secondary-button" type="button" disabled={saving} onClick={props.onCancel}><XCircle />取消</button>}
    </form>
  );
}

function SmartTextField(props: { value: string; onChange: (value: string) => void; placeholder: string; required?: boolean; multilineThreshold?: number; allowImageInsert?: boolean }) {
  const expanded = props.value.length > (props.multilineThreshold ?? 42) || props.value.includes("\n");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const textarea = (
    <textarea
      ref={ref}
      className={`smart-textarea ${expanded ? "expanded" : "compact"}`}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      rows={expanded ? Math.min(8, Math.max(3, props.value.split("\n").length + 1)) : 1}
      required={props.required}
    />
  );
  if (!props.allowImageInsert) return textarea;
  function insertImage() {
    const url = window.prompt("图片地址（支持 https://、data:image/... 或可访问的图片链接）");
    if (!url?.trim()) return;
    const imageMarkdown = `![图片](${url.trim()})`;
    const element = ref.current;
    const start = element?.selectionStart ?? props.value.length;
    const end = element?.selectionEnd ?? props.value.length;
    const prefix = start > 0 && !/\s$/.test(props.value.slice(0, start)) ? "\n" : "";
    const suffix = end < props.value.length && !/^\s/.test(props.value.slice(end)) ? "\n" : "";
    const nextValue = `${props.value.slice(0, start)}${prefix}${imageMarkdown}${suffix}${props.value.slice(end)}`;
    props.onChange(nextValue);
    window.requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + prefix.length + imageMarkdown.length;
      element?.setSelectionRange(cursor, cursor);
    });
  }
  return (
    <span className="smart-field with-image-insert">
      {textarea}
      <button className="mini-button smart-image-button" type="button" title="插入图片" onClick={insertImage}><ImageIcon /></button>
    </span>
  );
}

function StudyView(props: {
  cards: Card[];
  rootDecks: Deck[];
  selectedRootDeckId: number | null;
  onSelectRootDeck: (id: number) => void;
  selectedDeck?: Deck;
  studyTextScale: number;
  studyTextAlign: Settings["studyTextAlign"];
  studyChoiceLayout: Settings["studyChoiceLayout"];
  studyLineHeight: number;
  studyFontFamily: Settings["studyFontFamily"];
  onStudyTextScale: (scale: number) => Promise<void>;
  onStudyTextAlign: (align: Settings["studyTextAlign"]) => Promise<void>;
  onStudyChoiceLayout: (layout: Settings["studyChoiceLayout"]) => Promise<void>;
  onStudyLineHeight: (lineHeight: number) => Promise<void>;
  onStudyFontFamily: (fontFamily: Settings["studyFontFamily"]) => Promise<void>;
  autoSpeak: boolean;
  onAnswer: (card: Card, rating: ReviewRating) => Promise<ReviewResult>;
  onPractice: (card: Card, rating: ReviewRating) => Promise<PracticeResult>;
  onUndoAnswer: (card: Card, snapshot: ReviewSnapshot) => Promise<void>;
  onUndoPractice: (card: Card, snapshot: Pick<ReviewSnapshot, "dailyTaskPrevious">) => Promise<void>;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<Card | null | undefined>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [studyMode, setStudyMode] = useState<StudyMode>("review");
  const [sessionLimit, setSessionLimit] = useState(20);
  const [grindGroupSize, setGrindGroupSize] = useState(15);
  const [grindGroupNumber, setGrindGroupNumber] = useState(0);
  const [grindGroupStartedAt, setGrindGroupStartedAt] = useState("");
  const [grindMessage, setGrindMessage] = useState("");
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [queue, setQueue] = useState<Card[]>([]);
  const [masteredIds, setMasteredIds] = useState<number[]>([]);
  const [longTermSubmittedIds, setLongTermSubmittedIds] = useState<number[]>([]);
  const [history, setHistory] = useState<Array<{
    card: Card;
    previous: ReviewSnapshot | Pick<ReviewSnapshot, "dailyTaskPrevious">;
    practice: boolean;
    sessionCards: Card[];
    queue: Card[];
    masteredIds: number[];
    longTermSubmittedIds: number[];
    grindGroupNumber: number;
    grindGroupStartedAt: string;
    grindMessage: string;
    flipped: boolean;
    answer: string;
    checked: "right" | "wrong" | null;
    selectedChoice: string;
  }>>([]);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<"right" | "wrong" | null>(null);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [editingStudyCard, setEditingStudyCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState("");
  const [scaleDraft, setScaleDraft] = useState(props.studyTextScale);
  const [scaleSaving, setScaleSaving] = useState(false);
  const [activeTextTool, setActiveTextTool] = useState<"scale" | "lineHeight" | "align" | "choiceLayout" | "font" | null>(null);
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontStatus, setFontStatus] = useState("点击读取系统字体");
  const [remaining, setRemaining] = useState<ReviewRemaining>({ newRemaining: 0, reviewRemaining: 0 });
  const [immersive, setImmersive] = useState(false);
  const [answerDockOpen, setAnswerDockOpen] = useState(true);
  const [answerDockWidth, setAnswerDockWidth] = useState(300);
  const [cardMotion, setCardMotion] = useState<"entering" | "leaving" | "idle">("entering");
  const [cardRevision, setCardRevision] = useState(0);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [completionPlayed, setCompletionPlayed] = useState(false);
  const answerLayoutRef = useRef<HTMLDivElement | null>(null);
  const studyScrollRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const card = queue[0];

  useEffect(() => {
    if (studyMode === "grind") {
      resetSession();
      setGrindMessage("请选择大卡组并点击开始死学。");
      return;
    }
    startSession().catch((error) => console.error(error));
  }, [studyMode, props.selectedRootDeckId]);

  useEffect(() => {
    loadRemaining().catch((error) => console.error(error));
  }, [props.selectedRootDeckId]);

  useEffect(() => {
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setSelectedChoice("");
    setCelebrationKey(0);
    setAnswerDockOpen(true);
    setEditingStudyCard(null);
    setCardMotion("entering");
    const timer = window.setTimeout(() => setCardMotion("idle"), 220);
    if (props.autoSpeak && card && isWordCard(card)) props.onSpeak(card.front, card.language ?? props.selectedDeck?.language);
    return () => window.clearTimeout(timer);
  }, [card?.id, cardRevision, props.autoSpeak]);

  useEffect(() => {
    if (sessionCards.length > 0 && !card && !completionPlayed) {
      playCompletionSound();
      setCompletionPlayed(true);
    }
  }, [card, completionPlayed, sessionCards.length]);

  useEffect(() => {
    setScaleDraft(props.studyTextScale);
  }, [props.studyTextScale]);

  useEffect(() => {
    document.documentElement.classList.toggle("study-immersive-active", immersive);
    return () => document.documentElement.classList.remove("study-immersive-active");
  }, [immersive]);

  useEffect(() => {
    const onFullscreen = () => setImmersive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  function resetSession() {
    setSessionCards([]);
    setQueue([]);
    setMasteredIds([]);
    setLongTermSubmittedIds([]);
    setHistory([]);
    setGrindGroupNumber(0);
    setGrindGroupStartedAt("");
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setSelectedChoice("");
    setCelebrationKey(0);
    setAnswerDockOpen(true);
    setCompletionPlayed(false);
    setEditingStudyCard(null);
    setCardRevision((value) => value + 1);
    setCardMotion("entering");
  }

  async function startSession(nextLimit = sessionLimit) {
    if (!props.selectedRootDeckId || busyRef.current) return;
    busyRef.current = true;
    setBusy("session");
    try {
      const nextCards = await api.dueCards(props.selectedRootDeckId, Math.max(1, nextLimit), studyMode === "new" ? "new" : "review");
      setSessionCards(nextCards);
      setQueue(nextCards);
      setMasteredIds([]);
      setLongTermSubmittedIds([]);
      setHistory([]);
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice("");
      setCelebrationKey(0);
      setAnswerDockOpen(true);
      setCompletionPlayed(false);
      setEditingStudyCard(null);
      setCardRevision(0);
      setCardMotion("entering");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function loadGrindCards(excludeIds: number[] = [], targetSize = grindGroupSize) {
    if (!props.selectedRootDeckId) return [];
    const target = clampGrindGroupSize(targetSize);
    const excluded = new Set(excludeIds);
    const reviewCards = (await api.dueCards(props.selectedRootDeckId, Math.min(200, target + excluded.size + 20), "review"))
      .filter((item) => !excluded.has(item.id));
    const selectedReviewCards = reviewCards.slice(0, target);
    if (selectedReviewCards.length >= target) return selectedReviewCards;
    selectedReviewCards.forEach((item) => excluded.add(item.id));
    const newCards = (await api.dueCards(props.selectedRootDeckId, Math.min(200, target - selectedReviewCards.length + excluded.size + 20), "new"))
      .filter((item) => !excluded.has(item.id))
      .slice(0, target - selectedReviewCards.length);
    return [...selectedReviewCards, ...newCards];
  }

  async function startGrindSession(nextGroupSize = grindGroupSize) {
    const size = clampGrindGroupSize(nextGroupSize);
    setGrindGroupSize(size);
    if (!props.selectedRootDeckId) {
      setGrindMessage("请先选择一个大卡组。");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("session");
    try {
      const startedAt = new Date().toISOString();
      const nextCards = await loadGrindCards([], size);
      resetSession();
      setGrindGroupNumber(nextCards.length > 0 ? 1 : 0);
      setGrindGroupStartedAt(nextCards.length > 0 ? startedAt : "");
      setSessionCards(nextCards);
      setQueue(nextCards);
      setCompletionPlayed(false);
      setGrindMessage(nextCards.length > 0 ? "死学模式已开始。" : "死学完成：当前大类下暂无到期复习卡和新卡。");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function loadRemaining() {
    if (!props.selectedRootDeckId) {
      setRemaining({ newRemaining: 0, reviewRemaining: 0 });
      return;
    }
    setRemaining(await api.reviewRemaining(props.selectedRootDeckId));
  }

  async function dueReviewInterrupts(nextQueue: Card[]) {
    if (studyMode !== "grind" || !props.selectedRootDeckId) return [];
    const queuedIds = new Set(nextQueue.map((item) => item.id));
    return (await api.dueCards(props.selectedRootDeckId, 100, "review"))
      .filter((item) => !queuedIds.has(item.id) && (!grindGroupStartedAt || item.due_at > grindGroupStartedAt));
  }

  async function rate(rating: ReviewRating) {
    if (!card || busyRef.current) return;
    busyRef.current = true;
    setBusy(`rate-${rating}`);
    const beforeQueue = queue;
    const beforeSessionCards = sessionCards;
    const beforeMasteredIds = masteredIds;
    const beforeLongTermSubmittedIds = longTermSubmittedIds;
    try {
      const practice = beforeLongTermSubmittedIds.includes(card.id);
      const result = practice ? await props.onPractice(card, rating) : await props.onAnswer(card, rating);
      const nextMasteredIds = rating === "known" && !beforeMasteredIds.includes(card.id)
        ? [...beforeMasteredIds, card.id]
        : beforeMasteredIds;
      const nextLongTermSubmittedIds = practice || beforeLongTermSubmittedIds.includes(card.id)
        ? beforeLongTermSubmittedIds
        : [...beforeLongTermSubmittedIds, card.id];
      let nextSessionCards = beforeSessionCards;
      let nextQueue = nextStudyQueue(beforeQueue, card, rating, result);
      let finalMasteredIds = nextMasteredIds;
      let finalLongTermSubmittedIds = nextLongTermSubmittedIds;
      if (studyMode === "grind") {
        const interrupts = await dueReviewInterrupts(nextQueue);
        if (interrupts.length > 0) {
          nextQueue = [...interrupts, ...nextQueue];
          nextSessionCards = appendUniqueCards(nextSessionCards, interrupts);
        }
        if (nextQueue.length === 0) {
          const latestRemaining = await api.reviewRemaining(props.selectedRootDeckId ?? undefined);
          if (latestRemaining.reviewRemaining > 0 || latestRemaining.newRemaining > 0) {
            const nextGroup = await loadGrindCards([], grindGroupSize);
            if (nextGroup.length > 0) {
              const nextGroupStartedAt = new Date().toISOString();
              nextSessionCards = nextGroup;
              nextQueue = nextGroup;
              finalMasteredIds = [];
              finalLongTermSubmittedIds = [];
              setGrindGroupNumber((value) => value + 1);
              setGrindGroupStartedAt(nextGroupStartedAt);
              setGrindMessage("本组完成，开始下一组。");
            } else {
              setGrindMessage("死学完成：当前大类下暂无到期复习卡和新卡。");
            }
          } else {
            setGrindMessage("死学完成：当前大类下暂无到期复习卡和新卡。");
          }
        }
      }
      setHistory((items) => [...items, {
        card,
        previous: result.previous,
        practice,
        sessionCards: beforeSessionCards,
        queue: beforeQueue,
        masteredIds: beforeMasteredIds,
        longTermSubmittedIds: beforeLongTermSubmittedIds,
        grindGroupNumber,
        grindGroupStartedAt,
        grindMessage,
        flipped,
        answer,
        checked,
        selectedChoice
      }]);
      setCardMotion("leaving");
      await delay(140);
      setSessionCards(nextSessionCards);
      setQueue(nextQueue);
      setMasteredIds(finalMasteredIds);
      setLongTermSubmittedIds(finalLongTermSubmittedIds);
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice("");
      setCelebrationKey(0);
      setCardRevision((value) => value + 1);
      setCardMotion("entering");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function undo() {
    const previous = history.at(-1);
    if (!previous || busyRef.current) return;
    busyRef.current = true;
    setBusy("undo");
    try {
      if (previous.practice) {
        await props.onUndoPractice(previous.card, previous.previous as Pick<ReviewSnapshot, "dailyTaskPrevious">);
      } else {
        await props.onUndoAnswer(previous.card, previous.previous as ReviewSnapshot);
      }
      setHistory((items) => items.slice(0, -1));
      setSessionCards(previous.sessionCards);
      setQueue(previous.queue);
      setMasteredIds(previous.masteredIds);
      setLongTermSubmittedIds(previous.longTermSubmittedIds);
      setGrindGroupNumber(previous.grindGroupNumber);
      setGrindGroupStartedAt(previous.grindGroupStartedAt);
      setGrindMessage(previous.grindMessage);
      setFlipped(previous.flipped);
      setAnswer(previous.answer);
      setChecked(previous.checked);
      setSelectedChoice(previous.selectedChoice);
      setCompletionPlayed(false);
      setCardRevision((value) => value + 1);
      setCardMotion("entering");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function checkWritten() {
    if (!card) return;
    setSelectedChoice("");
    const result = isCorrectAnswer(card, answer) ? "right" : "wrong";
    playAnswerSound(result);
    if (result === "right") setCelebrationKey((key) => key + 1);
    setChecked(result);
  }

  function submitBlankAnswer(event: FormEvent) {
    event.preventDefault();
    if (!displayBlankAnswer(answer) || busy) return;
    checkWritten();
  }

  function checkChoice(choice: string) {
    if (!card || checked) return;
    setSelectedChoice(choice);
    const result = answersMatch(choice, card.back) ? "right" : "wrong";
    playAnswerSound(result);
    if (result === "right") setCelebrationKey((key) => key + 1);
    setChecked(result);
  }

  const choices = useMemo(() => {
    if (!card) return [];
    const baseChoices = dedupeChoiceOptions(parseChoices(card.choices));
    const source = card.card_type === "choice"
      ? baseChoices.some((choice) => answersMatch(choice, card.back)) ? baseChoices : [...baseChoices, card.back]
      : sessionCards.filter((item) => item.id !== card.id).slice(0, 3).map((item) => item.back).concat(card.back);
    return dedupeChoiceOptions(source).sort(() => 0.5 - Math.random());
  }, [card?.id, sessionCards]);

  const displayCorrect = card ? choices.find((choice) => answersMatch(choice, card.back)) ?? card.back : "";

  const completed = masteredIds.length;
  const total = sessionCards.length;
  const explanation = card?.example ?? "";
  const otherNote = card?.note ?? "";
  const explanationText = [explanation, otherNote].filter(Boolean).join("\n\n");
  const explanationIsLong = explanationText.length > 80 || /\n|```|\$\$/.test(explanationText);
  const showAnswerDock = Boolean(card && checked && explanationIsLong && answerDockOpen);
  const showManualRatings = card ? card.card_type !== "choice" && card.card_type !== "blank" || checked !== null : false;
  const currentBlankCount = card?.card_type === "blank" ? blankMarkerCount(card.front) : 1;
  const displayedBlankAnswer = displayBlankAnswer(answer);

  const scale = scaleDraft;
  const studyStyle = {
    "--study-face-min": `${Math.round(32 * scale)}px`,
    "--study-face-max": `${Math.round(72 * scale)}px`,
    "--study-word-min": `${Math.round(34 * scale)}px`,
    "--study-word-max": `${Math.round(64 * scale)}px`,
    "--study-phonetic-min": `${Math.round(18 * scale)}px`,
    "--study-phonetic-max": `${Math.round(28 * scale)}px`,
    "--study-back-min": `${Math.round(20 * scale)}px`,
    "--study-back-max": `${Math.round(30 * scale)}px`,
    "--study-small-size": `${Math.round(16 * scale)}px`,
    "--study-question-size": `${Math.round(24 * scale)}px`,
    "--study-choice-size": `${Math.round(16 * scale)}px`,
    "--study-result-size": `${Math.round(16 * scale)}px`,
    "--study-text-align": props.studyTextAlign,
    "--study-line-height": String(props.studyLineHeight),
    "--study-font-family": studyFontStack(props.studyFontFamily),
    "--answer-dock-width": `${answerDockWidth}px`
  } as CSSProperties & Record<string, string>;

  async function saveScale(nextScale: number) {
    setScaleDraft(nextScale);
    setScaleSaving(true);
    try {
      await props.onStudyTextScale(nextScale);
    } finally {
      setScaleSaving(false);
    }
  }

  async function saveTextAlign(nextAlign: Settings["studyTextAlign"]) {
    if (nextAlign === props.studyTextAlign) return;
    await props.onStudyTextAlign(nextAlign);
  }

  async function saveChoiceLayout(nextLayout: Settings["studyChoiceLayout"]) {
    if (nextLayout === props.studyChoiceLayout) return;
    await props.onStudyChoiceLayout(nextLayout);
  }

  async function saveLineHeight(nextLineHeight: number) {
    if (Math.abs(nextLineHeight - props.studyLineHeight) < 0.01) return;
    await props.onStudyLineHeight(nextLineHeight);
  }

  async function saveFontFamily(nextFontFamily: Settings["studyFontFamily"]) {
    if (nextFontFamily === props.studyFontFamily) return;
    await props.onStudyFontFamily(nextFontFamily);
  }

  async function loadFonts() {
    setFontLoading(true);
    setFontStatus("读取中");
    try {
      const fonts = await queryInstalledFonts();
      setInstalledFonts(fonts);
      setFontStatus(fonts.length > 0 ? `已读取 ${fonts.length} 个系统字体` : "没有读取到可用字体");
    } catch (error) {
      setInstalledFonts([]);
      setFontStatus((error as Error).message);
    } finally {
      setFontLoading(false);
    }
  }

  function replaceSessionCard(nextCard: Card) {
    setSessionCards((items) => items.map((item) => item.id === nextCard.id ? nextCard : item));
    setQueue((items) => items.map((item) => item.id === nextCard.id ? nextCard : item));
    setHistory((items) => items.map((item) => ({
      ...item,
      card: item.card.id === nextCard.id ? nextCard : item.card,
      queue: item.queue.map((queuedCard) => queuedCard.id === nextCard.id ? nextCard : queuedCard)
    })));
  }

  async function saveStudyCard(payload: CardPayload) {
    if (!editingStudyCard) return;
    const updatedCard = await props.onUpdateCard(editingStudyCard.id, { ...payload, baseUpdatedAt: editingStudyCard.updated_at });
    if (updatedCard) replaceSessionCard(updatedCard);
    setEditingStudyCard(null);
  }

  async function toggleImmersive() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      setImmersive(false);
      return;
    }
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
    setImmersive(true);
  }

  function editCurrentStudyCard() {
    if (!card) return;
    setEditingStudyCard(card);
    window.requestAnimationFrame(() => {
      studyScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      scrollToPageTop();
    });
  }

  function resizeAnswerDock(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("resizing-answer-dock");

    const updateWidth = (clientX: number) => {
      const viewportWidth = window.innerWidth;
      const layoutRect = answerLayoutRef.current?.getBoundingClientRect();
      const layoutRight = layoutRect?.right ?? viewportWidth;
      const layoutWidth = layoutRect?.width ?? viewportWidth;
      const minWidth = Math.min(240, Math.max(180, viewportWidth - 160));
      const maxWidth = Math.min(560, Math.max(260, layoutWidth * 0.58));
      setAnswerDockWidth(Math.round(Math.max(minWidth, Math.min(maxWidth, layoutRight - clientX))));
    };

    const onPointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("resizing-answer-dock");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };

    updateWidth(event.clientX);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
  }

  return (
    <section className={`stack study-view ${immersive ? "immersive" : ""}`}>
      <div className="panel study-selector">
        <label>
          大卡组
          <select value={props.selectedRootDeckId ?? ""} onChange={(event) => props.onSelectRootDeck(Number(event.target.value))}>
            <option value="" disabled>选择大卡组</option>
            {props.rootDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.due_count || 0} 到期</option>)}
          </select>
        </label>
        <div className="study-session-controls">
          <div className="study-remaining" aria-label="剩余卡片">
            <span>新学剩余 {remaining.newRemaining}</span>
            <span>复习剩余 {remaining.reviewRemaining}</span>
          </div>
          <div className="mode-tabs compact-tabs">
            <button className={studyMode === "review" ? "active" : ""} onClick={() => setStudyMode("review")}>复习</button>
            <button className={studyMode === "new" ? "active" : ""} onClick={() => setStudyMode("new")}>新学</button>
            <button className={studyMode === "grind" ? "active" : ""} onClick={() => setStudyMode("grind")}>死学模式</button>
          </div>
          {studyMode === "grind" ? (
            <>
              <label>
                每组卡片数
                <input type="number" min={1} max={100} value={grindGroupSize} onChange={(event) => setGrindGroupSize(clampGrindGroupSize(event.target.value))} />
              </label>
              <button className="primary-button" disabled={busy === "session" || !props.selectedRootDeckId} onClick={() => startGrindSession()}><Sparkles />{busy === "session" ? "载入中" : "开始死学"}</button>
            </>
          ) : (
            <>
              <label>
                {studyMode === "new" ? "新学张数" : "复习张数"}
                <input type="number" min={1} max={200} value={sessionLimit} onChange={(event) => {
                  const next = Math.max(1, Number(event.target.value) || 1);
                  setSessionLimit(next);
                }} />
              </label>
              <button className="primary-button" disabled={busy === "session"} onClick={() => startSession()}><Sparkles />{busy === "session" ? "载入中" : "开始"}</button>
            </>
          )}
        </div>
        {studyMode === "grind" && (
          <div className="study-remaining" aria-label="死学模式状态">
            <span>当前模式：死学模式</span>
            <span>大类：{props.selectedDeck?.name ?? "未选择"}</span>
            <span>第 {grindGroupNumber || 0} 组</span>
            <span>本组目标 {grindGroupSize}</span>
            <span>已加入 {sessionCards.length}</span>
            {grindMessage && <span>{grindMessage}</span>}
          </div>
        )}
      </div>

      {!card ? total > 0 ? (
        studyMode === "grind" && grindMessage.startsWith("死学完成")
          ? <EmptyState text="死学完成：当前大类下暂无到期复习卡和新卡。" />
          : <StudyComplete total={total} completed={completed} onRestart={() => studyMode === "grind" ? startGrindSession() : startSession()} busy={busy === "session"} />
      ) : <EmptyState text={studyMode === "grind" ? (props.selectedRootDeckId ? "请选择开始死学。" : "请先选择一个大卡组。") : studyMode === "new" ? "这个大卡组暂无可新学卡片。" : "这个大卡组暂无到期复习卡片。"} /> : (
        <div key={`${card.id}-${cardRevision}`} className={`study-panel ${cardMotion} align-${props.studyTextAlign} ${checked === "right" ? "celebrating" : ""}`} style={studyStyle}>
          {checked === "right" && (
            <div className="answer-celebration" key={celebrationKey} aria-hidden="true">
              <span className="celebration-ring" />
              <span className="celebration-badge"><CheckCircle2 />太棒了</span>
              {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
            </div>
          )}
          <div className="study-fixed-top">
            <div className="progress-line" style={{ "--progress-ratio": String(Math.min(completed / Math.max(total, 1), 1)) } as CSSProperties}>
              <span>{completed}</span>
              <div><i /></div>
              <span>{total}</span>
            </div>
            <div className="study-actions">
              {studyMode === "grind" && <span className="type-pill">死学模式</span>}
              {studyMode === "grind" && <span className="type-pill">{props.selectedDeck?.name ?? "当前大类"}</span>}
              {studyMode === "grind" && <span className="type-pill">第 {grindGroupNumber} 组</span>}
              {studyMode === "grind" && <span className="type-pill">目标 {grindGroupSize} · 已加入 {sessionCards.length}</span>}
              <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
              <span className="type-pill study-schedule-pill" title={`下次复习：${fullDateTime(card.due_at)}（${dueText(card.due_at)}）`}>{studyScheduleText(card)}</span>
              <span className="type-pill">待掌握 {queue.length}</span>
              <span className="type-pill">新学剩余 {remaining.newRemaining}</span>
              <span className="type-pill">复习剩余 {remaining.reviewRemaining}</span>
              <TextToolButton icon={<SlidersHorizontal />} title="学习字号" active={activeTextTool === "scale"} onClick={() => setActiveTextTool(activeTextTool === "scale" ? null : "scale")}>
                {activeTextTool === "scale" && (
                  <div className="text-tool-popover">
                    {[0.85, 1, 1.15, 1.25, 1.35].map((value) => (
                      <button key={value} className={Math.abs(scaleDraft - value) < 0.01 ? "active" : ""} onClick={() => saveScale(value)}>{scaleSaving && Math.abs(scaleDraft - value) < 0.01 ? "保存中" : `${Math.round(value * 100)}%`}</button>
                    ))}
                  </div>
                )}
              </TextToolButton>
              <TextToolButton icon={<MoreHorizontal />} title="学习行距" active={activeTextTool === "lineHeight"} onClick={() => setActiveTextTool(activeTextTool === "lineHeight" ? null : "lineHeight")}>
                {activeTextTool === "lineHeight" && (
                  <div className="text-tool-popover compact">
                    {[1.2, 1.4, 1.5, 1.6, 1.8, 2].map((value) => (
                      <button key={value} className={Math.abs(props.studyLineHeight - value) < 0.01 ? "active" : ""} onClick={() => saveLineHeight(value)}>{value.toFixed(value === 2 ? 0 : 1)}</button>
                    ))}
                  </div>
                )}
              </TextToolButton>
              <TextToolButton icon={props.studyTextAlign === "left" ? <AlignLeft /> : <AlignCenter />} title="学习文本对齐" active={activeTextTool === "align"} onClick={() => setActiveTextTool(activeTextTool === "align" ? null : "align")}>
                {activeTextTool === "align" && (
                  <div className="text-tool-popover compact">
                    <button className={props.studyTextAlign === "left" ? "active" : ""} onClick={() => saveTextAlign("left")}><AlignLeft />左对齐</button>
                    <button className={props.studyTextAlign === "center" ? "active" : ""} onClick={() => saveTextAlign("center")}><AlignCenter />居中</button>
                  </div>
                )}
              </TextToolButton>
              <TextToolButton icon={props.studyChoiceLayout === "one" ? <Rows2 /> : <Columns2 />} title="选项列数" active={activeTextTool === "choiceLayout"} onClick={() => setActiveTextTool(activeTextTool === "choiceLayout" ? null : "choiceLayout")}>
                {activeTextTool === "choiceLayout" && (
                  <div className="text-tool-popover compact">
                    <button className={props.studyChoiceLayout === "auto" ? "active" : ""} onClick={() => saveChoiceLayout("auto")}><SlidersHorizontal />自动</button>
                    <button className={props.studyChoiceLayout === "one" ? "active" : ""} onClick={() => saveChoiceLayout("one")}><Rows2 />一列</button>
                    <button className={props.studyChoiceLayout === "two" ? "active" : ""} onClick={() => saveChoiceLayout("two")}><Columns2 />两列</button>
                  </div>
                )}
              </TextToolButton>
              <TextToolButton icon={<Type />} title="学习字体" active={activeTextTool === "font"} onClick={() => setActiveTextTool(activeTextTool === "font" ? null : "font")}>
                {activeTextTool === "font" && (
                  <div className="text-tool-popover font-popover">
                    {studyFontOptions.map((option) => (
                      <button key={option.value} className={props.studyFontFamily === option.value ? "active" : ""} onClick={() => saveFontFamily(option.value)}>{option.label}</button>
                    ))}
                    <button onClick={loadFonts}>{fontLoading ? "读取中" : "读取系统字体"}</button>
                    <small>{fontStatus}</small>
                    {installedFonts.map((font) => (
                      <button key={font} className={props.studyFontFamily === font ? "active" : ""} style={{ fontFamily: studyFontStack(font) }} onClick={() => saveFontFamily(font)}>{font}</button>
                    ))}
                  </div>
                )}
              </TextToolButton>
              <button
                className={`mini-button ${showAnswerDock ? "active" : ""}`}
                title={answerDockOpen ? "隐藏题目参考" : "显示题目参考"}
                disabled={!checked || !explanationIsLong}
                onClick={() => setAnswerDockOpen((open) => !open)}
              >
                {answerDockOpen ? <EyeOff /> : <Eye />}
              </button>
              <button className="mini-button" title={immersive ? "退出沉浸学习" : "沉浸学习"} onClick={toggleImmersive}>{immersive ? <Minimize2 /> : <Maximize2 />}</button>
              <button className="mini-button" title="撤销上一张" disabled={history.length === 0 || Boolean(busy)} onClick={undo}><ArrowLeft /></button>
              <button className="mini-button" title="编辑当前卡片" onClick={editCurrentStudyCard}><Edit3 /></button>
              <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front, card.language ?? props.selectedDeck?.language)}><Volume2 /></button>
            </div>
          </div>
          <div className="study-scroll" ref={studyScrollRef}>
            {editingStudyCard && <CardEditor card={editingStudyCard} onCancel={() => setEditingStudyCard(null)} onSubmit={saveStudyCard} />}
            {card.card_type !== "choice" && card.card_type !== "blank" && (
              <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)}>
                <span className="flip-card-inner">
                  <span className="flip-card-face flip-card-front"><CardFront card={card} /></span>
                  <span className="flip-card-face flip-card-back"><CardBack card={card} /></span>
                </span>
              </button>
            )}
            {card.card_type === "choice" && (
              <div ref={answerLayoutRef} className={`answer-layout ${showAnswerDock ? "with-dock" : ""}`}>
                <div className={`question-box choice-question ${choiceLayoutClass(choices, props.studyChoiceLayout)}`}>
                  <MarkdownText value={card.front} className="question-text" />
                  <ChoiceArea choices={choices} answer={card.back} selected={selectedChoice} checked={checked} layout={props.studyChoiceLayout} onChoose={checkChoice}>
                    {checked && <AnswerFeedback checked={checked} correct={displayCorrect} explanation={explanation} other={otherNote} selected={selectedChoice} />}
                  </ChoiceArea>
                </div>
                {showAnswerDock && (
                  <QuestionDock
                    card={card}
                    choices={choices}
                    selected={selectedChoice}
                    answer={card.back}
                    onResize={resizeAnswerDock}
                    onClose={() => setAnswerDockOpen(false)}
                  />
                )}
              </div>
            )}
            {card.card_type === "blank" && (
              <div ref={answerLayoutRef} className={`answer-layout ${showAnswerDock ? "with-dock" : ""}`}>
                <div className={`question-box choice-question blank-question ${choiceLayoutClass([card.front, card.example], props.studyChoiceLayout)}`}>
                  <form className="blank-answer-form" onSubmit={submitBlankAnswer}>
                    <MarkdownText
                      value={card.front}
                      className="question-text blank-question-text"
                      renderBlank={(key) => (
                        <input
                          key={key}
                          className={`blank-inline-input ${checked ?? ""}`}
                          value={splitBlankAnswers(answer, currentBlankCount)[blankIndexFromKey(key)] ?? ""}
                          onChange={(event) => {
                            setAnswer(setBlankAnswerPart(answer, currentBlankCount, blankIndexFromKey(key), event.target.value));
                            setChecked(null);
                          }}
                          aria-label="填空答案"
                          autoComplete="off"
                          disabled={Boolean(busy)}
                        />
                      )}
                    />
                    {!hasBlankMarker(card.front) && (
                      <input
                        className={`blank-inline-input standalone ${checked ?? ""}`}
                        value={answer}
                        onChange={(event) => { setAnswer(event.target.value); setChecked(null); }}
                        aria-label="填空答案"
                        autoComplete="off"
                        disabled={Boolean(busy)}
                      />
                    )}
                    <button className="primary-button blank-submit-button" disabled={Boolean(busy) || !displayedBlankAnswer}>{busy ? "提交中" : "提交"}</button>
                  </form>
                  {checked && <AnswerFeedback checked={checked} correct={correctAnswer(card)} explanation={explanation} other={otherNote} selected={displayedBlankAnswer} />}
                </div>
                {showAnswerDock && (
                  <QuestionDock
                    card={card}
                    selected={displayedBlankAnswer}
                    answer={correctAnswer(card)}
                    onResize={resizeAnswerDock}
                    onClose={() => setAnswerDockOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
          {showManualRatings && (
            <div className="rating-row">
              <button className="rating unknown" disabled={Boolean(busy)} onClick={() => rate("unknown")}><XCircle />{busy === "rate-unknown" ? "提交中" : "不认识"}</button>
              <button className="rating fuzzy" disabled={Boolean(busy)} onClick={() => rate("fuzzy")}><RotateCcw />{busy === "rate-fuzzy" ? "提交中" : "模糊"}</button>
              <button className="rating known" disabled={Boolean(busy)} onClick={() => rate("known")}><CheckCircle2 />{busy === "rate-known" ? "提交中" : "认识"}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QuestionDock(props: { card: Card; choices?: string[]; selected: string; answer: string; onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void; onClose: () => void }) {
  return (
    <aside className="question-dock" aria-label="题目参考">
      <button className="question-dock-resizer" type="button" aria-label="调整题目参考宽度" onPointerDown={props.onResize} />
      <div className="question-dock-title">
        <strong>题目参考</strong>
        <button className="mini-button" title="隐藏题目参考" onClick={props.onClose}><XCircle /></button>
      </div>
      <div className="question-dock-body">
        <MarkdownText
          value={props.card.front}
          className="question-dock-prompt"
          renderBlank={props.card.card_type === "blank" ? (key) => <span key={key} className="blank-dock-gap" /> : undefined}
        />
        {props.choices && props.choices.length > 0 && (
          <div className="question-dock-options">
            {props.choices.map((choice, index) => (
              <div key={`${choice}-${index}`} className={answersMatch(choice, props.answer) ? "correct" : choice === props.selected ? "selected" : ""}>
                <MarkdownText value={choice} />
              </div>
            ))}
          </div>
        )}
        {props.selected && <small>你的答案：<MarkdownText value={props.selected} /></small>}
      </div>
    </aside>
  );
}

function TextToolButton(props: { icon: ReactNode; title: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="text-tool">
      <button className={`mini-button ${props.active ? "active" : ""}`} title={props.title} onClick={props.onClick}>
        {props.icon}
      </button>
      {props.children}
    </div>
  );
}

function StudyComplete(props: { total: number; completed: number; onRestart: () => void; busy: boolean }) {
  return (
    <section className="study-complete-panel">
      <div className="finish-burst" aria-hidden="true">
        <span className="finish-orbit" />
        {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
      </div>
      <div className="finish-medal" aria-hidden="true"><Sparkles /></div>
      <p className="eyebrow">本轮完成</p>
      <h2>{props.completed}/{props.total}</h2>
      <p>这一组已经全部掌握，今天的脑力很亮。</p>
      <button className="primary-button" disabled={props.busy} onClick={props.onRestart}><Sparkles />{props.busy ? "载入中" : "再来一轮"}</button>
    </section>
  );
}

function CardFront(props: { card: Card }) {
  if (props.card.card_type === "blank") return <MarkdownText value={props.card.front} renderBlank={(key) => <span key={key} className="blank-dock-gap" />} />;
  if (props.card.card_type === "choice") return <MarkdownText value={props.card.front} />;
  if (!isWordCard(props.card)) return <span className="basic-face"><MarkdownText value={props.card.front} /></span>;
  return <span className="word-face"><span className="word-text"><MarkdownText value={props.card.front} /></span>{props.card.phonetic && <em>{props.card.phonetic}</em>}</span>;
}

function CardBack(props: { card: Card }) {
  if (!isWordCard(props.card)) {
    return (
      <span className="basic-back">
        <span className="basic-face"><MarkdownText value={props.card.front} /></span>
        <span className="basic-answer"><MarkdownText value={props.card.back} /></span>
        {props.card.example && <small><MarkdownText value={props.card.example} /></small>}
      </span>
    );
  }
  return (
    <span className="word-back">
      <span className="word-text"><MarkdownText value={props.card.front} /></span>
      {props.card.phonetic && <em>{props.card.phonetic}</em>}
      <span className="word-meaning"><MarkdownText value={props.card.back} /></span>
      {props.card.example && <small><MarkdownText value={props.card.example} /></small>}
      <LabeledMarkdown label="助记" value={props.card.mnemonic} />
    </span>
  );
}

function choiceLayoutClass(choices: string[], layout: Settings["studyChoiceLayout"]) {
  if (layout === "one") return "long";
  if (layout === "two") return "short";
  const maxLength = Math.max(0, ...choices.map((choice) => choice.length));
  const totalLength = choices.reduce((sum, choice) => sum + choice.length, 0);
  return maxLength > 34 || totalLength > 120 || choices.length > 5
    ? "long"
    : maxLength > 16 || totalLength > 64
      ? "medium"
      : "short";
}

function ChoiceArea(props: {
  choices: string[];
  answer: string;
  selected: string;
  checked: "right" | "wrong" | null;
  layout: Settings["studyChoiceLayout"];
  onChoose: (choice: string) => void;
  children: ReactNode;
}) {
  const layoutClass = choiceLayoutClass(props.choices, props.layout);
  return (
    <div className={`choice-area ${layoutClass}`}>
      <div className={`choice-grid ${layoutClass}`}>
        {props.choices.map((choice, index) => {
          const isSelected = choice === props.selected;
          const isAnswer = answersMatch(choice, props.answer);
          const state = props.checked ? (isAnswer ? "correct" : isSelected ? "wrong" : "") : undefined;
          return (
            <button
              className={state}
              disabled={props.checked !== null}
              key={`${choice}-${index}`}
              onClick={() => props.onChoose(choice)}
            >
              <MarkdownText value={choice} />
            </button>
          );
        })}
      </div>
      {props.children}
    </div>
  );
}

function AnswerFeedback(props: { checked: "right" | "wrong"; correct: string; explanation: string; other: string; selected: string }) {
  const right = props.checked === "right";
  return (
    <div className={`result ${right ? "right" : "wrong"}`}>
      <strong>{right ? "回答正确" : "回答错误"}</strong>
      {!right && props.selected && <span>你的答案：<MarkdownText value={props.selected} /></span>}
      <span>正确答案：<MarkdownText value={props.correct} /></span>
      <FeedbackBlock label="解析" value={props.explanation} kind="explanation" />
      <FeedbackBlock label="其他" value={props.other} kind="other" />
    </div>
  );
}

function ImportView(props: { decks: Deck[]; selectedDeckId: number | null; onSelectDeck: (id: number) => void; onImported: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [text, setText] = useState("card_type,front,back,option1,option2,option3,option4\nchoice,Which one means apple?,苹果,苹果,香蕉,橙子,葡萄\nblank,I eat [] every day.,apple,,,,");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!props.selectedDeckId || importing) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.set("deckId", String(props.selectedDeckId));
      if (file) form.set("file", file);
      else form.set("text", text);
      const result = await api.importCards(form);
      await props.onImported(`导入 ${result.imported} 张，跳过 ${result.skipped} 行`);
    } catch (error) {
      props.onError((error as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const templates = ["普通卡导入模板.xlsx", "单词卡导入模板.xlsx", "选择题卡导入模板.xlsx", "填空题卡导入模板.xlsx"];

  return (
    <section className="panel">
      <form className="import-form" onSubmit={submit}>
        <label>目标卡组<select value={props.selectedDeckId ?? ""} onChange={(event) => props.onSelectDeck(Number(event.target.value))}><option value="" disabled>选择卡组</option>{props.decks.map((deck) => <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>)}</select></label>
        <div className="template-links" aria-label="导入模板">
          {templates.map((name) => <a key={name} href={`/api/templates/${encodeURIComponent(name)}`} download>{name.replace("导入模板.xlsx", "")}</a>)}
        </div>
        <label>上传 CSV/TSV/XLSX<input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>或粘贴表格<textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} /></label>
        <p className="hint">可自动识别题型：有选项列会导入为选择题，题干含 [] 或连续下划线会导入为填空题；也支持显式 card_type/type/卡片类型。</p>
        <button className="primary-button" disabled={importing || !props.selectedDeckId}><FileSpreadsheet />{importing ? "导入中" : "开始导入"}</button>
      </form>
    </section>
  );
}

function SettingsView(props: { settings: Settings; onThemeChange: (theme: ThemeMode) => Promise<void>; onSave: (settings: Partial<Settings>) => Promise<void>; onNotify: () => Promise<void>; saving: boolean; notifying: boolean }) {
  const [draft, setDraft] = useState<Settings>(props.settings);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  function updateDraft(next: Partial<Settings>) {
    const merged = { ...draft, ...next };
    setDraft(merged);
    if (next.theme) applyTheme(merged.theme);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await props.onSave(draft);
  }

  function changeTheme(theme: ThemeMode) {
    updateDraft({ theme });
    props.onThemeChange(theme).catch(() => undefined);
  }

  return (
    <form className="panel settings-panel" onSubmit={save}>
      <label>主题<select value={draft.theme} onChange={(event) => changeTheme(event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">暗黑</option></select></label>
      <label>默认发音语言<select value={normalizeSpeechLanguage(draft.voiceLanguage)} onChange={(event) => updateDraft({ voiceLanguage: event.target.value })}><option value="en-GB">英语-英国 en-GB</option><option value="ja-JP">日语 ja-JP</option><option value="ko-KR">韩语 ko-KR</option><option value="fr-FR">法语 fr-FR</option><option value="de-DE">德语 de-DE</option></select></label>
      <label>自动发音<select value={draft.autoSpeak} onChange={(event) => updateDraft({ autoSpeak: event.target.value as Settings["autoSpeak"] })}><option value="off">关闭</option><option value="on">开启</option></select></label>
      <label>每日新学目标<input type="number" min={0} value={draft.dailyNewGoal} onChange={(event) => updateDraft({ dailyNewGoal: Number(event.target.value) })} /></label>
      <div className="settings-actions">
        <button className="primary-button" disabled={props.saving}><Save />{props.saving ? "保存中" : "保存设置"}</button>
        <button className="primary-button secondary-button" type="button" disabled={props.notifying} onClick={props.onNotify}><Bell />{props.notifying ? "授权中" : "开启浏览器通知"}</button>
      </div>
      <div className="schedule-box"><h3>艾宾浩斯间隔</h3><p>5 分钟 · 30 分钟 · 12 小时 · 1 天 · 2 天 · 4 天 · 7 天 · 15 天 · 30 天 · 90 天</p></div>
    </form>
  );
}

function AboutView(props: { syncStatus: SyncStatus | null }) {
  return (
    <section className="panel about-panel">
      <div className="about-title"><Info /><div><p className="eyebrow">闪记</p><h2>版本 {version}</h2></div></div>
      <div className="schedule-box changelog-box">
        <h3>更新日志</h3>
        <div className="changelog-row"><strong>0.4.3</strong><span>2026-07-05</span><p>学习过程中显示当前卡片的长期复习阶段和对应复习间隔，方便判断下一次复习节奏。</p></div>
        <div className="changelog-row"><strong>0.4.2</strong><span>2026-07-05</span><p>增强 Markdown 中 LaTeX 公式渲染；普通卡恢复正常字号，翻面后保留正面并在下方显示答案，正面加粗且答案不加粗。</p></div>
        <div className="changelog-row"><strong>0.3.12</strong><span>2026-07-04</span><p>修正 loongeric_v2 音色对应模型为 cosyvoice-v2，避免阿里云合成失败后回退到浏览器女声。</p></div>
        <div className="changelog-row"><strong>0.3.11</strong><span>2026-07-04</span><p>英语单词发音音色切换为阿里云 CosyVoice 的 loongeric_v2，并清理旧音色缓存后重新生成。</p></div>
        <div className="changelog-row"><strong>0.3.10</strong><span>2026-07-04</span><p>英语单词发音改为优先调用阿里云 CosyVoice v3 的 loongeric_v3 英式男声音色，并按模型和音色在后端缓存生成音频。</p></div>
        <div className="changelog-row"><strong>0.3.9</strong><span>2026-07-01</span><p>英语单词发音改为优先使用 Wiktionary/Commons 真人词典音频，并在后端缓存；找不到真人录音时自动回退浏览器发音。</p></div>
        <div className="changelog-row"><strong>0.3.8</strong><span>2026-07-01</span><p>发音升级为后端离线 Piper 英式英语语音包；英语朗读统一使用 en-GB，离线包不可用时自动回退浏览器发音。</p></div>
        <div className="changelog-row"><strong>0.3.7</strong><span>2026-07-01</span><p>修复单词卡导入时助记/注记误填相邻列、学习页例句编辑同步、例句注记字重和默认英式英语发音选项。</p></div>
        <div className="changelog-row"><strong>0.3.6</strong><span>2026-06-29</span><p>修复最后一张卡片选择“模糊/不认识”后重复同一张卡时，学习面板停留在离场动画导致黑屏的问题。</p></div>
        <div className="changelog-row"><strong>0.3.5</strong><span>2026-06-28</span><p>修复学习页最后一张选择“不认识/模糊”时可能退出本轮的问题；学习评分不再触发整站刷新，错题会稳定留在当前队列重复。</p></div>
        <div className="changelog-row"><strong>0.3.4</strong><span>2026-06-28</span><p>填空题答案支持“或/或者/or”多候选任一正确；学习页记住上次大卡组；主题下拉会即时保存，避免同步后回到旧主题。</p></div>
        <div className="changelog-row"><strong>0.3.3</strong><span>2026-06-28</span><p>修复浅色模式解析/其他文字颜色、空行间距、填空输入框间距、多空答案分隔和并列空位乱序判定；跟随系统主题会响应系统暗黑模式变化。</p></div>
        <div className="changelog-row"><strong>0.3.2</strong><span>2026-06-28</span><p>填空题解析改为提交后显示；编辑字段在短文本状态也支持换行；填空输入框去掉下划线、占位文字和加粗样式。</p></div>
        <div className="changelog-row"><strong>0.3.1</strong><span>2026-06-28</span><p>填空题学习页改为选择题同款题干版式；题干空位直接替换为输入框，支持 Markdown、回车提交和自动判定。</p></div>
        <div className="changelog-row"><strong>0.2.17</strong><span>2026-06-28</span><p>统一其他和助记字段的 Markdown 换行展示；空行间距改为真实一行的 35%；连续按 6 次 a 可导出最近 10 分钟日志。</p></div>
        <div className="changelog-row"><strong>0.2.16</strong><span>2026-06-28</span><p>增强 Markdown 转义和空行显示；学习页顶部增加题目参考显示开关；修复尾部分号选项被丢弃。</p></div>
        <div className="changelog-row"><strong>0.2.15</strong><span>2026-06-28</span><p>修复加粗包裹代码块时的渲染；编辑时立即回到页面顶部；学习反馈按钮贴底三等分显示。</p></div>
        <div className="changelog-row"><strong>0.2.14</strong><span>2026-06-27</span><p>题目参考改为屏幕固定区域，滚动学习内容时不再跟随；选项改为无序号紧凑显示。</p></div>
        <div className="changelog-row"><strong>0.2.13</strong><span>2026-06-27</span><p>调整学习页评级按钮宽度、题目参考位置和答题反馈字号；补齐 Markdown 分割线、标题、引用、表格等展示，并让换行跟随学习行距。</p></div>
        <div className="changelog-row"><strong>0.2.12</strong><span>2026-06-27</span><p>答题后的题干选项参考固定在屏幕右侧，支持拖动中间分隔调整左右占比，并修正解析按 Markdown 原文加粗展示。</p></div>
        <div className="changelog-row"><strong>0.2.11</strong><span>2026-06-27</span><p>修复学习页手机布局、底部评级固定、系统字体选择、解析/其他换行展示和新学/复习剩余数量。</p></div>
        <div className="changelog-row"><strong>0.2.10</strong><span>2026-06-27</span><p>支持 Markdown 代码块和数学公式展示；长解析答题后默认显示右侧题目参考并可隐藏；评级按钮固定在学习面板底部。</p></div>
        <div className="changelog-row"><strong>0.2.9</strong><span>2026-06-27</span><p>修复手机端布局挤压；卡组列表支持点击后隐藏和手动展开；选择题一列时题干与选项对齐；优化学习进度条动画流畅度。</p></div>
        <div className="changelog-row"><strong>0.2.8</strong><span>2026-06-27</span><p>支持 Markdown 文本展示；选项和解析保留换行；长文本编辑自动展开；选择题可手动切换一列或两列；解析宽度与选项区域一致。</p></div>
        <div className="changelog-row"><strong>0.2.7</strong><span>2026-06-27</span><p>编辑学习中卡片后即时刷新本轮内容；选择题选项跟随左对齐；字体支持读取和输入系统字体；升级打卡完成感和项目名称。</p></div>
        <div className="changelog-row"><strong>0.2.6</strong><span>2026-06-27</span><p>升级学习页排版控制，新增字号、行距、对齐和字体按钮选择；修正左对齐语义；优化全屏和竖屏手机体验；新增整组完成动画音效和自适应选择题选项布局。</p></div>
        <div className="changelog-row"><strong>0.2.5</strong><span>2026-06-27</span><p>新增答题音效、卡片翻转和切题动效；评级后不再弹出右下角提示；强化连续打卡展示；学习页支持文本左对齐或居中。</p></div>
        <div className="changelog-row"><strong>0.2.4</strong><span>2026-06-26</span><p>修复选择题答案标签匹配和第五选项问题；学习页按卡片类型自动显示；字号调整移入学习页；新增沉浸式学习并移除卡片悬停倾斜。</p></div>
        <div className="changelog-row"><strong>0.2.3</strong><span>2026-06-26</span><p>修复填写判定、每日新学统计、重复提交、单卡删除确认、设置保存、自动发音开关、导入模板、移动端导航和开发端口冲突等体验问题。</p></div>
        <div className="changelog-row"><strong>0.2.2</strong><span>2026-06-26</span><p>导入时自动识别选择题和填空题；选择/填写后先显示对错、正确答案和解析，再手动评级；新增学习卡片字号设置。</p></div>
        <div className="changelog-row"><strong>0.2.1</strong><span>2026-06-25</span><p>修复多层卡组菜单重叠；新增卡片批量全选、移动、删除；填空题支持填写判定并统一 [] 占位符；学习页支持新学张数、本轮固定队列、错题循环到掌握和撤销。</p></div>
        <div className="changelog-row"><strong>0.2.0</strong><span>2026-06-24</span><p>新增选择题卡、填空题卡、每日任务、连续打卡、按大卡组复习、同步按钮、自动同步和冲突处理。</p></div>
      </div>
      <div className="schedule-box"><h3>同步状态</h3><p>最近同步：{props.syncStatus ? fullDateTime(props.syncStatus.lastSyncAt) : "暂无"} · 数据更新：{props.syncStatus?.dataUpdatedAt ? fullDateTime(props.syncStatus.dataUpdatedAt) : "暂无"}</p></div>
    </section>
  );
}

function CardDetail(props: { card: Card; onClose: () => void }) {
  const choices = parseChoices(props.card.choices);
  return (
    <div className="modal-backdrop">
      <section className="modal-panel">
        <div className="modal-title"><h2><MarkdownText value={props.card.front} /></h2><button className="mini-button" onClick={props.onClose}><XCircle /></button></div>
        <div className="detail-grid">
          <Detail label="类型" value={cardTypeLabels[props.card.card_type]} />
          <Detail label="答案" value={props.card.back} />
          <Detail label="阶段" value={`${props.card.stage}/10`} />
          <Detail label="下次复习" value={fullDateTime(props.card.due_at)} />
          <Detail label="相对时间" value={dueText(props.card.due_at)} />
          <Detail label="音标" value={props.card.phonetic || "无"} />
          <Detail label="例句" value={props.card.example || "无"} />
          <Detail label="助记" value={props.card.mnemonic || "无"} />
          <Detail label="选项" value={choices.length ? choices.join("\n") : "无"} />
          <Detail label="备注" value={props.card.note || "无"} />
        </div>
      </section>
    </div>
  );
}

function Detail(props: { label: string; value: string }) {
  return <div className="detail-item"><span>{props.label}</span><strong><MarkdownText value={props.value} /></strong></div>;
}

function ConflictDialog(props: { conflict: { id: number; payload: CardPayload; serverCard: Card }; onKeepServer: () => Promise<void>; onOverwrite: () => Promise<void> }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-panel">
        <div className="modal-title"><h2><AlertTriangle />同步冲突</h2></div>
        <p className="hint">这张卡片已在其他设备修改。请选择保留服务器版本，或用本机编辑覆盖。</p>
        <div className="conflict-grid">
          <div><h3>服务器版本</h3><p><MarkdownText value={props.conflict.serverCard.front} /></p><small><MarkdownText value={props.conflict.serverCard.back} /></small></div>
          <div><h3>本机编辑</h3><p><MarkdownText value={String(props.conflict.payload.front ?? "")} /></p><small><MarkdownText value={String(props.conflict.payload.back ?? "")} /></small></div>
        </div>
        <div className="rating-row">
          <button className="primary-button secondary-button" onClick={props.onKeepServer}>保留服务器版本</button>
          <button className="primary-button" onClick={props.onOverwrite}>覆盖为本机版本</button>
        </div>
      </section>
    </div>
  );
}

function EmptyState(props: { text: string }) {
  return <div className="empty-state">{props.text}</div>;
}
