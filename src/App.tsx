import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import AlignCenter from "lucide-react/dist/esm/icons/align-center";
import AlignLeft from "lucide-react/dist/esm/icons/align-left";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Bell from "lucide-react/dist/esm/icons/bell";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Brain from "lucide-react/dist/esm/icons/brain";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import CodeXml from "lucide-react/dist/esm/icons/code-xml";
import Download from "lucide-react/dist/esm/icons/download";
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
import Pause from "lucide-react/dist/esm/icons/pause";
import Plus from "lucide-react/dist/esm/icons/plus";
import Play from "lucide-react/dist/esm/icons/play";
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
import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { api, type CardPayload, type ConflictError } from "./api";
import {
  blankAnswerDisplay,
  blankAnswerSearchText,
  blankAnswerSeparator,
  blankAnswerSummary,
  blankAnswersMatch,
  legacyBlankAnswerConfig,
  maxBlankAlternatives,
  normalizeBlankAnswerConfig
} from "./blank-answers";
import { insertImageMarkdown } from "./card-images";
import { choiceAnswerSetMatches, choiceAnswersMatch, choiceOptionKey, dedupeChoiceAnswers, normalizeChoiceAnswer, splitChoiceAnswers } from "./choice-answers";
import { latexRenderSource, normalizeMarkdownMath } from "./latex";
import { isPhrasePartOfSpeech, ratingShortcutForKey, shouldUsePractice, studyAnswerWeight, updateGrindStudyWords } from "./study-session";
import { resolveStudySwipe } from "./study-gestures";
import type { Card, CardType, DailyTask, Deck, ImportBatch, ReviewRating, ReviewRemaining, ReviewSnapshot, Settings, Stats, SyncStatus, ThemeMode, TomatoState, User } from "./types";

type View = "home" | "deck" | "create-card" | "study" | "import" | "settings" | "about";
type SyncState = "idle" | "syncing" | "success" | "error" | "conflict";
type StudyMode = "review" | "new" | "grind";
type ReviewResult = { stage: number; dueAt: string; previous: ReviewSnapshot };
type PracticeResult = { stage: number; dueAt: string; previous: Pick<ReviewSnapshot, "dailyTaskPrevious" | "studyEventId"> };
type RatingFeedback = { key: number; rating: ReviewRating; title: string; stageText: string; dueText: string };
type PronunciationSettings = { ssml: string; prompt: string; customized: boolean; promptCustomized: boolean; maxSsmlLength: number; maxPromptLength: number };
type KatexRuntime = { renderToString: (value: string, options: { displayMode?: boolean; throwOnError: boolean; trust: boolean; strict: "ignore" }) => string };

declare global {
  interface Window {
    katex?: KatexRuntime;
  }
}
const version = "0.9.11";
const logExportPressCount = 6;
const logExportKey = "a";
const logExportResetMs = 1800;

function shanghaiDateKey(offsetDays = 0) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  if (offsetDays === 0) return today;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
const studyDeckStoragePrefix = "xian-flashcards-study-root-deck";
const roundStudyWordsStoragePrefix = "xian-flashcards-round-study-words";
const answerDockOpenStoragePrefix = "xian-flashcards-answer-dock-open";

function storedRoundStudyWords(userId: number) {
  try {
    const value = Number(window.localStorage.getItem(`${roundStudyWordsStoragePrefix}:${userId}`));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function storedAnswerDockOpen(userId: number) {
  try {
    return window.localStorage.getItem(`${answerDockOpenStoragePrefix}:${userId}`) !== "closed";
  } catch {
    return true;
  }
}

const cardTypeLabels: Record<CardType, string> = {
  basic: "普通卡",
  word: "单词卡",
  choice: "选择题卡",
  blank: "填空题卡"
};

const emptyDailyTask: DailyTask = {
  date: "",
  daily_word_goal: 20,
  progress_words: 0,
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
  return normalizeChoiceAnswer(value);
}

function formatPomodoroCountdown(state: TomatoState | null, now: number) {
  const active = state?.activePomodoro;
  if (!active) return "未开始";
  const endAt = active.status === "running" && active.endAt ? new Date(active.endAt).getTime() : NaN;
  const seconds = Number.isFinite(endAt)
    ? Math.max(0, Math.ceil((endAt - now) / 1000))
    : Math.max(0, Math.ceil(Number(active.remainingSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function pomodoroRemainingRatio(state: TomatoState | null, now: number) {
  const active = state?.activePomodoro;
  if (!active) return 0;
  const endAt = active.status === "running" && active.endAt ? new Date(active.endAt).getTime() : NaN;
  const remaining = Number.isFinite(endAt)
    ? Math.max(0, Math.ceil((endAt - now) / 1000))
    : Math.max(0, Math.ceil(Number(active.remainingSeconds) || 0));
  const duration = active.phase === "break" ? active.breakDurationSeconds : active.durationSeconds;
  return Math.min(1, remaining / Math.max(1, Number(duration) || 25 * 60));
}

function normalizeSpeechLanguage(value?: string) {
  const language = String(value ?? "").trim();
  if (language.toLowerCase().startsWith("en")) return "en-GB";
  return language || "en-GB";
}

function optionKey(value: string) {
  return choiceOptionKey(value);
}

function answersMatch(choice: string, answer: string) {
  return choiceAnswersMatch(choice, answer);
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
    if (parsed && typeof parsed === "object") return [];
  } catch {
    // Fall through to separator parsing.
  }
  return splitChoiceText(value);
}

function splitChoiceText(value: string) {
  return value
    .split(/[|\n]+|[；;](?=\s*\S)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const blankMarkerPattern = /(\[\s*\]|_{2,}|（\s*）|\(\s*\))/g;
const blankMarkerHrefPrefix = "https://markdown-blank.invalid/";

function hasLatexFormula(value: string) {
  return /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|split)\}/.test(value);
}

function MathText(props: { value: string; displayMode?: boolean }) {
  const katex = typeof window === "undefined" ? undefined : window.katex;
  const html = useMemo(() => katex?.renderToString(latexRenderSource(props.value, props.displayMode), {
    displayMode: props.displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore"
  }), [katex, props.value, props.displayMode]);
  if (!html) return <span className={props.displayMode ? "math-block" : "math-inline"}>{props.value}</span>;
  return <span className={props.displayMode ? "math-block" : "math-inline"} dangerouslySetInnerHTML={{ __html: html }} />;
}

function markdownWithBlankInputs(value: string) {
  let index = 0;
  return value.replace(blankMarkerPattern, () => `[＿＿](${blankMarkerHrefPrefix}${index++})`);
}

export function MarkdownText(props: { value: string; className?: string; renderBlank?: (key: string) => ReactNode }) {
  if (!props.value.trim()) return null;
  const source = props.renderBlank ? markdownWithBlankInputs(normalizeMarkdownMath(props.value)) : normalizeMarkdownMath(props.value);
  const heading = (level: number) => ({ children }: { children?: ReactNode }) => <strong className={`markdown-heading level-${level}`}>{children}</strong>;
  return (
    <span className={`markdown-text ${props.className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        skipHtml
        components={{
          h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
          p: ({ children }) => <span className="markdown-paragraph">{children}</span>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, node }) => {
            const value = String(children).replace(/\n$/, "");
            const isMath = Boolean(className?.includes("language-math"));
            if (isMath) return <MathText value={value} displayMode={className?.includes("math-display")} />;
            const isBlock = node?.position?.start.column === 1;
            return isBlock
              ? <span className="code-block">{className && <span className="code-language">{className.replace("language-", "")}</span>}<code className={className}>{children}</code></span>
              : <code className={className}>{children}</code>;
          },
          hr: () => <hr className="markdown-divider" />,
          table: ({ children }) => <span className="markdown-table-wrap"><table>{children}</table></span>,
          a: ({ href, children }) => {
            const blankIndex = href?.startsWith(blankMarkerHrefPrefix) ? Number(href.slice(blankMarkerHrefPrefix.length)) : NaN;
            if (props.renderBlank && Number.isInteger(blankIndex) && blankIndex >= 0) return <>{props.renderBlank(`blank-${blankIndex}`)}</>;
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
          img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" />,
          input: ({ type, checked }) => type === "checkbox" ? <input type="checkbox" checked={checked} readOnly disabled /> : <input type={type} />
        }}
      >
        {source}
      </ReactMarkdown>
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
  const config = card.card_type === "blank" ? normalizeBlankAnswerConfig(card.choices) : null;
  if (config) return blankAnswerDisplay(config);
  return card.back;
}

function isCorrectAnswer(card: Card, answer: string) {
  if (card.card_type === "blank") {
    return blankAnswersMatch(card.front, card.back, card.choices, answer);
  }
  const normalized = normalizeAnswer(answer);
  return normalized === normalizeAnswer(correctAnswer(card));
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

function ratingTitle(rating: ReviewRating) {
  if (rating === "known") return "本次掌握";
  if (rating === "fuzzy") return "本次模糊";
  return "本次不会";
}

function stageName(stage: number) {
  return stage <= 0 ? "新卡" : `${stage} 阶段`;
}

function ratingStageText(previousStage: number, nextStage: number) {
  if (nextStage > previousStage) return `升级到 ${stageName(nextStage)}`;
  if (nextStage < previousStage) return `退回到 ${stageName(nextStage)}`;
  return `保持 ${stageName(nextStage)}`;
}

function ratingFeedback(rating: ReviewRating, previousStage: number, result: { stage: number; dueAt: string }): Omit<RatingFeedback, "key"> {
  return {
    rating,
    title: ratingTitle(rating),
    stageText: ratingStageText(previousStage, result.stage),
    dueText: `下次复习 ${dueText(result.dueAt)}`
  };
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

function studyDeckStorageKey(userId: number) {
  return `${studyDeckStoragePrefix}:${userId}`;
}

function readStoredStudyDeckId(userId: number, decks: Deck[]) {
  const storedId = Number(window.localStorage.getItem(studyDeckStorageKey(userId)));
  return Number.isFinite(storedId) && decks.some((deck) => deck.id === storedId) ? storedId : null;
}

function writeStoredStudyDeckId(userId: number | null, deckId: number | null) {
  if (!userId || !deckId) return;
  window.localStorage.setItem(studyDeckStorageKey(userId), String(deckId));
}

function IcpFooter() {
  return (
    <footer className="icp-footer">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026045295号-1</a>
    </footer>
  );
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

function prependUniqueCards(cards: Card[], nextCards: Card[]) {
  const seen = new Set<number>();
  return [...nextCards, ...cards].filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

function applyGrindInterrupts(queue: Card[], sessionCards: Card[], interrupts: Card[], targetSize: number) {
  if (interrupts.length === 0) return { queue, sessionCards };
  const cappedSessionCards = prependUniqueCards(sessionCards, interrupts).slice(0, clampGrindGroupSize(targetSize));
  const sessionIds = new Set(cappedSessionCards.map((item) => item.id));
  return {
    queue: prependUniqueCards(queue, interrupts).filter((item) => sessionIds.has(item.id)),
    sessionCards: cappedSessionCards
  };
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
  const [studyDeckId, setStudyDeckId] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [stats, setStats] = useState<Stats>({ total_cards: 0, mastered_cards: 0, due_cards: 0 });
  const [settings, setSettings] = useState<Settings>({
    theme: "system",
    notifications: "off",
    autoSpeak: "off",
    dailyWordGoal: 20,
    studyTextScale: 1,
    studyPageWidth: 1,
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
  const speechRequestRef = useRef(0);

  const rootDecks = useMemo(() => decks.filter((deck) => deck.depth === 1), [decks]);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];
  const studyDeck = decks.find((deck) => deck.id === studyDeckId) ?? rootDecks[0] ?? decks[0];
  const filteredCards = useMemo(() => {
    const query = normalizeAnswer(search);
    return cards.filter((card) => {
      if (!query) return true;
      return normalizeAnswer(`${card.front} ${card.phonetic} ${card.back} ${card.example} ${card.mnemonic} ${card.note} ${parseChoices(card.choices).join(" ")} ${blankAnswerSearchText(card.choices)}`).includes(query);
    });
  }, [cards, search]);

  async function refresh(options: { silent?: boolean; notifySuccess?: boolean } = {}) {
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
      const fallbackStudyDeckId = nextDecks.find((deck) => deck.depth === 1)?.id ?? nextDecks[0]?.id ?? null;
      const nextStudyDeckId = (studyDeckId && nextDecks.some((deck) => deck.id === studyDeckId))
        ? studyDeckId
        : user
          ? readStoredStudyDeckId(user.id, nextDecks) ?? fallbackStudyDeckId
          : fallbackStudyDeckId;
      setStudyDeckId(nextStudyDeckId);
      writeStoredStudyDeckId(user?.id ?? null, nextStudyDeckId);
      setDueCards(nextStudyDeckId ? await api.dueCards(nextStudyDeckId, 80) : []);
      if (!options.silent) setSyncState("success");
      if (options.notifySuccess) showToast("同步成功");
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

  async function createCard(payload: CardPayload) {
    if (!selectedDeckId) throw new Error("请先选择一个卡组");
    try {
      await api.createCard(selectedDeckId, payload);
      await afterMutation("卡片已新建");
    } catch (error) {
      showToast((error as Error).message, "error");
      throw error;
    }
  }

  function selectStudyDeck(id: number) {
    setStudyDeckId(id);
    writeStoredStudyDeckId(user?.id ?? null, id);
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
    if (!studyDeckId) return;
    api.dueCards(studyDeckId, 80).then(setDueCards).catch((error) => showToast(error.message, "error"));
  }, [studyDeckId]);

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

  async function downloadRecentLogs() {
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
  }

  async function downloadStudyRecord(date: string) {
    const { blob, filename } = await api.exportStudyRecord(date);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${date} 学习记录`);
  }

  useEffect(() => {
    let pressCount = 0;
    let resetTimer = 0;
    const reset = () => {
      pressCount = 0;
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = 0;
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
      downloadRecentLogs().catch((error) => showToast((error as Error).message, "error"));
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
  }, [user?.id, studyDeckId]);

  useEffect(() => {
    if (settings.notifications !== "on" || dueCards.length === 0 || Notification.permission !== "granted") return;
    const timer = window.setTimeout(() => {
      new Notification("该复习啦", {
        body: `${studyDeck?.name ?? "当前卡组"} 有 ${dueCards.length} 张卡片到期。`
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dueCards.length, settings.notifications, studyDeck?.name]);

  async function playSpeechBlob(blob: Blob, requestId: number) {
    if (speechRequestRef.current !== requestId) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    speechAudioRef.current = audio;
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    await audio.play();
  }

  async function speak(text: string, language?: string, fallback?: string) {
    const requestId = speechRequestRef.current + 1;
    speechRequestRef.current = requestId;
    const speechLanguage = normalizeSpeechLanguage(language ?? selectedDeck?.language ?? "en-GB");
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    if (!speechLanguage.toLowerCase().startsWith("en")) {
      showToast("音标发音当前仅支持英语", "error");
      return;
    }
    try {
      const blob = await api.synthesizeSpeech({ text, language: speechLanguage, fallback });
      await playSpeechBlob(blob, requestId);
    } catch (error) {
      if (speechRequestRef.current !== requestId) return;
      console.warn("英式音标发音不可用", error);
      showToast((error as Error).message, "error");
    }
  }

  async function loadPronunciationXml(payload: { text: string; fallback: string }) {
    try {
      return await api.pronunciationXml(payload);
    } catch (error) {
      showToast((error as Error).message, "error");
      throw error;
    }
  }

  async function savePronunciationXml(payload: { text: string; fallback: string; language?: string; ssml: string; prompt: string }) {
    const requestId = speechRequestRef.current + 1;
    speechRequestRef.current = requestId;
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    try {
      const blob = await api.savePronunciationXml({ ...payload, language: normalizeSpeechLanguage(payload.language) });
      await playSpeechBlob(blob, requestId);
      showToast("豆包语音设置已保存，语音缓存已替换");
    } catch (error) {
      if (speechRequestRef.current !== requestId) return;
      showToast((error as Error).message, "error");
      throw error;
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
        <NavButton icon={<BookOpen />} label="卡组" active={view === "deck" || view === "create-card"} onClick={() => setView("deck")} />
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
            <button className={`sync-button ${syncState}`} title="同步" disabled={syncState === "syncing"} onClick={() => withPending("sync", () => refresh({ notifySuccess: true }))}>
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
              selectStudyDeck(id);
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
                const result = await api.createDeck({ name, parentId, language: "en-GB" });
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
            onOpenCreateCard={() => {
              if (!selectedDeckId) return;
              setView("create-card");
              scrollToPageTop();
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

        {view === "create-card" && (
          <CreateCardView
            deck={selectedDeck}
            onCancel={() => setView("deck")}
            onSubmit={async (payload) => {
              await createCard(payload);
              scrollToPageTop();
            }}
          />
        )}

        {view === "study" && (
          <StudyView
            userId={user.id}
            isSuperuser={user.isSuperuser}
            cards={dueCards}
            decks={decks}
            selectedStudyDeckId={studyDeckId}
            onSelectStudyDeck={selectStudyDeck}
            selectedDeck={studyDeck}
            studyTextScale={settings.studyTextScale}
            studyPageWidth={settings.studyPageWidth}
            studyTextAlign={settings.studyTextAlign}
            studyChoiceLayout={settings.studyChoiceLayout}
            studyLineHeight={settings.studyLineHeight}
            studyFontFamily={settings.studyFontFamily}
            onStudyTextScale={async (studyTextScale) => {
              await api.saveSettings({ studyTextScale });
              setSettings((current) => ({ ...current, studyTextScale }));
            }}
            onStudyPageWidth={async (studyPageWidth) => {
              await api.saveSettings({ studyPageWidth });
              setSettings((current) => ({ ...current, studyPageWidth }));
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
            onLoadPronunciationXml={loadPronunciationXml}
            onSavePronunciationXml={savePronunciationXml}
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
                  if (next.dailyWordGoal !== undefined) await api.saveDailyTaskSettings({ dailyWordGoal: Number(next.dailyWordGoal) });
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
            onExportStudyRecord={(date) => withPending("study-record", () => downloadStudyRecord(date))}
            onExportLogs={() => withPending("logs", downloadRecentLogs)}
            saving={Boolean(pending.settings)}
            notifying={Boolean(pending.notify)}
            exportingStudyRecord={Boolean(pending["study-record"])}
            exportingLogs={Boolean(pending.logs)}
          />
        )}

        {view === "about" && <AboutView syncStatus={syncStatus} />}
        <IcpFooter />
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
      <IcpFooter />
    </div>
  );
}

function viewTitle(view: View) {
  return {
    home: "今日任务",
    deck: "卡组管理",
    "create-card": "新建卡片",
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
    <button
      className={`nav-button ${props.active ? "active" : ""}`}
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      onClick={() => {
        props.onClick();
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }}
    >
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
  const dailyTarget = Math.max(props.dailyTask.daily_word_goal, 1);
  const dailyDone = props.dailyTask.progress_words;
  const dailyProgress = props.dailyTask.completed ? 100 : Math.min(100, Math.round((dailyDone / dailyTarget) * 100));
  return (
    <section className="stack">
      <div className={`hero-panel daily-hero ${props.dailyTask.completed ? "complete" : ""}`}>
        <div className="daily-glow" aria-hidden="true" />
        <div>
          <p className="eyebrow">今日打卡</p>
          <div className="streak-heading">
            <h2>{props.dailyTask.completed ? "已完成" : `${dailyDone}/${dailyTarget} 单词`}</h2>
            <span className={`streak-badge ${props.dailyTask.completed ? "done" : ""}`}><CheckCircle2 />连续 {props.dailyTask.streak} 天</span>
          </div>
          <p>复习 {props.dailyTask.review_completed} × 1 · 新学 {props.dailyTask.new_completed} × 5</p>
          <div className="progress-line" aria-label={`今日进度 ${dailyProgress}%`} style={{ "--progress-ratio": String(dailyProgress / 100) } as CSSProperties}>
            <span>{dailyDone}</span>
            <div><i /></div>
            <span>{dailyTarget}</span>
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
        <TaskItem icon={<Target />} label="每日目标" value={`${dailyDone}/${dailyTarget} 单词`} done={props.dailyTask.completed} />
        <TaskItem icon={<ListChecks />} label="今日学习" value={`复习 ${props.dailyTask.review_completed} × 1 · 新学 ${props.dailyTask.new_completed} × 5`} done={props.dailyTask.completed} />
        <TaskItem icon={<CheckCircle2 />} label="连续打卡" value={`${props.dailyTask.streak} 天`} done={props.dailyTask.completed} />
      </div>

      <div className="section-heading"><h2>大卡组复习</h2></div>
      <div className="deck-grid">
        {props.rootDecks.map((deck) => (
          <button className="deck-card" key={deck.id} onClick={() => props.onStudy(deck.id)}>
            <span className="deck-icon"><BookOpen /></span>
            <span className="deck-card-title">{deck.name}</span>
            <span>{deck.total_card_count || deck.card_count || 0} 张 · {deck.due_count || 0} 到期</span>
          </button>
        ))}
        {props.decks.length === 0 && <EmptyState text="先创建一个卡组，再导入表格或手动添加卡片。" />}
      </div>

      <div className="section-heading"><h2>即将复习</h2></div>
      <div className="list">
        {props.dueCards.slice(0, 6).map((card) => (
          <div className="list-row" key={card.id}>
            <MarkdownText value={card.front} className="list-row-title card-summary-markdown" />
            <span className="card-summary-field"><span>{cardTypeLabels[card.card_type]} ·</span><MarkdownText value={card.back} className="card-summary-markdown" /></span>
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

function CreateCardView(props: { deck?: Deck; onSubmit: (payload: CardPayload) => Promise<void>; onCancel: () => void }) {
  if (!props.deck) {
    return (
      <section className="panel create-card-page">
        <button className="primary-button secondary-button create-card-back" onClick={props.onCancel}><ArrowLeft />返回卡组</button>
        <EmptyState text="请先创建并选择一个卡组。" />
      </section>
    );
  }
  return (
    <section className="panel create-card-page">
      <div className="panel-heading create-card-heading">
        <div>
          <p className="eyebrow">目标卡组</p>
          <h2>{props.deck.name}</h2>
        </div>
        <button className="primary-button secondary-button" onClick={props.onCancel}><ArrowLeft />返回卡组</button>
      </div>
      <CardEditor layout="single" onSubmit={props.onSubmit} onCancel={props.onCancel} />
    </section>
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
  onOpenCreateCard: () => void;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<Card | null | undefined>;
  onDeleteCard: (id: number) => Promise<void>;
  onBatchCards: (cardIds: number[], action: "move" | "delete", deckId?: number) => Promise<void>;
  onToggleFavorite: (card: Card) => Promise<void>;
  onSpeak: (text: string, language?: string, fallback?: string) => void;
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
  const [sortField, setSortField] = useState<"created" | "due" | "studied">("created");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showPausedOnly, setShowPausedOnly] = useState(false);
  const [busy, setBusy] = useState("");

  const visibleCards = useMemo(() => showPausedOnly ? props.cards.filter((card) => card.paused) : props.cards, [props.cards, showPausedOnly]);
  const pausedCards = useMemo(() => props.cards.filter((card) => card.paused), [props.cards]);
  const allVisibleSelected = visibleCards.length > 0 && visibleCards.every((card) => selectedCardIds.includes(card.id));
  const sortedCards = useMemo(() => {
    const valueFor = (card: Card) => sortField === "due"
      ? card.due_at
      : sortField === "studied"
        ? card.last_studied_at ?? ""
        : card.created_at;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...visibleCards].sort((left, right) => {
      const compared = valueFor(left).localeCompare(valueFor(right));
      return compared === 0 ? direction * (left.id - right.id) : direction * compared;
    });
  }, [sortDirection, sortField, visibleCards]);

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
    setSelectedCardIds(allVisibleSelected ? [] : visibleCards.map((card) => card.id));
  }

  function selectPausedCards() {
    setSelectedCardIds((ids) => Array.from(new Set([...ids, ...pausedCards.map((card) => card.id)])));
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

  async function togglePaused(card: Card) {
    if (busy) return;
    setBusy(`pause-card-${card.id}`);
    try {
      await props.onUpdateCard(card.id, { paused: card.paused ? 0 : 1, baseUpdatedAt: card.updated_at });
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
                <span className="deck-name">{deck.depth > 1 && <i />}<span>{deck.name}</span></span>
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
          <div className="deck-sort-controls" aria-label="卡片排序">
            <select aria-label="排列顺序" value={sortField} onChange={(event) => setSortField(event.target.value as "created" | "due" | "studied")}>
              <option value="created">加入时间</option>
              <option value="due">到期时间</option>
              <option value="studied">最新学习</option>
            </select>
            <select aria-label="排序方法" value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}>
              <option value="asc">正序</option>
              <option value="desc">倒序</option>
            </select>
          </div>
          <button className={`primary-button secondary-button ${showPausedOnly ? "active" : ""}`} onClick={() => setShowPausedOnly((value) => !value)}><Eye />{showPausedOnly ? "显示全部" : "显示已暂停"}</button>
          <button className="primary-button toolbar-create-card" disabled={!props.selectedDeckId} onClick={props.onOpenCreateCard}><Plus />新建卡片</button>
        </div>
        {editingCard && <CardEditor card={editingCard} onCancel={() => setEditingCard(null)} onSubmit={async (payload) => { await props.onUpdateCard(editingCard.id, { ...payload, baseUpdatedAt: editingCard.updated_at }); setEditingCard(null); }} />}
        <div className="batch-toolbar">
          <button className="mini-button" title="全选" onClick={toggleAllCards}>{allVisibleSelected ? <SquareCheck /> : <Square />}</button>
          <span className="batch-title">{selectedCardIds.length ? `已选 ${selectedCardIds.length} 张` : "批量管理"}</span>
          <button className="primary-button secondary-button" disabled={pausedCards.length === 0} onClick={selectPausedCards}><SquareCheck />选中已暂停</button>
          <select value={batchTargetDeckId ?? ""} onChange={(event) => setBatchTargetDeckId(event.target.value ? Number(event.target.value) : null)}>
            <option value="" disabled>移动到卡组</option>
            {props.decks.map((deck) => <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>)}
          </select>
          <button className="primary-button secondary-button" disabled={selectedCardIds.length === 0 || !batchTargetDeckId || Boolean(busy)} onClick={batchMove}><MoveRight />{busy === "batch-move" ? "移动中" : "移动"}</button>
          <button className="primary-button danger-button" disabled={selectedCardIds.length === 0 || Boolean(busy)} onClick={batchDelete}><Trash2 />{busy === "batch-delete" ? "删除中" : "删除"}</button>
        </div>
        <div className="card-list">
          {sortedCards.map((card) => (
            <article className="word-card" key={card.id}>
              <div className="card-summary">
                <div className="word-title">
                  <button className="mini-button" title="选择卡片" onClick={() => toggleCard(card.id)}>{selectedCardIds.includes(card.id) ? <SquareCheck /> : <Square />}</button>
                  <MarkdownText value={card.front} className="word-card-title card-summary-markdown" />
                  <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
                  {card.paused ? <span className="type-pill paused-card-pill">已暂停</span> : null}
                </div>
                <div className="word-card-actions">
                  {isWordCard(card) && card.phonetic && <span className="phonetic">{card.phonetic}</span>}
                  <button className="mini-button" title="发音" onClick={() => props.onSpeak(isWordCard(card) && card.phonetic ? card.phonetic : card.front, undefined, card.front)}><Volume2 /></button>
                  <button className={`mini-button ${card.favorite ? "starred" : ""}`} title="收藏" disabled={busy === `favorite-${card.id}`} onClick={() => toggleFavorite(card)}><Star /></button>
                  <button className={`mini-button ${card.paused ? "active" : ""}`} title={card.paused ? "启动卡片" : "暂停卡片"} disabled={busy === `pause-card-${card.id}`} onClick={() => togglePaused(card)}>{card.paused ? <Play /> : <Pause />}</button>
                  <button className="mini-button" title="详情" onClick={() => setDetailCard(card)}><Eye /></button>
                  <button className="mini-button" title="编辑" onClick={() => { setEditingCard(card); scrollToPageTop(); }}><Edit3 /></button>
                </div>
                <MarkdownText value={card.card_type === "blank" ? correctAnswer(card) : card.back} className="card-summary-markdown card-summary-answer" />
                {card.example && <span className="card-summary-field"><span>说明：</span><MarkdownText value={card.example} className="card-summary-markdown" /></span>}
                {parseChoices(card.choices).length > 0 && <span className="card-summary-field"><span>选项：</span><MarkdownText value={parseChoices(card.choices).join(" / ")} className="card-summary-markdown" /></span>}
                {isWordCard(card) && card.mnemonic && <span className="card-summary-field"><span>助记：</span><MarkdownText value={card.mnemonic} className="card-summary-markdown" /></span>}
              </div>
              <div className="card-meta">
                <span>阶段 {card.stage}/10</span>
                <span>{card.paused ? "已暂停，不进入学习和复习" : `下次 ${dueText(card.due_at)}`}</span>
                <button className="mini-button danger" title="删除" disabled={busy === `delete-card-${card.id}`} onClick={() => deleteCard(card)}><Trash2 /></button>
              </div>
            </article>
          ))}
          {visibleCards.length === 0 && <EmptyState text={showPausedOnly ? "这个卡组没有已暂停卡片。" : "这个卡组还没有卡片。"} />}
        </div>
      </div>
      {detailCard && <CardPreview card={detailCard} onClose={() => setDetailCard(null)} />}
    </section>
  );
}

function CardEditor(props: { card?: Card; layout?: "default" | "single"; onSubmit: (payload: CardPayload) => Promise<void>; onCancel?: () => void }) {
  const initialBlankConfig = () => {
    if (props.card?.card_type !== "blank") return { version: 1 as const, orderless: false, answers: [[""]] };
    return normalizeBlankAnswerConfig(props.card.choices) ?? legacyBlankAnswerConfig(props.card.front, props.card.back);
  };
  const [cardType, setCardType] = useState<CardType>(props.card?.card_type ?? "basic");
  const [front, setFront] = useState(props.card?.front ?? "");
  const [phonetic, setPhonetic] = useState(props.card?.phonetic ?? "");
  const [back, setBack] = useState(props.card?.back ?? "");
  const [example, setExample] = useState(props.card?.example ?? "");
  const [mnemonic, setMnemonic] = useState(props.card?.mnemonic ?? "");
  const [note, setNote] = useState(props.card?.note ?? "");
  const [choices, setChoices] = useState(parseChoices(props.card?.choices).join(" | "));
  const [blankAnswers, setBlankAnswers] = useState<string[][]>(() => initialBlankConfig().answers);
  const [blankOrderless, setBlankOrderless] = useState(() => initialBlankConfig().orderless);
  const [saving, setSaving] = useState(false);
  const blankCount = Math.max(1, blankMarkerCount(front));
  const visibleBlankAnswers = Array.from({ length: blankCount }, (_, index) => blankAnswers[index] ?? [""]);

  useEffect(() => {
    const nextBlankConfig = props.card?.card_type === "blank"
      ? normalizeBlankAnswerConfig(props.card.choices) ?? legacyBlankAnswerConfig(props.card.front, props.card.back)
      : { version: 1 as const, orderless: false, answers: [[""]] };
    setCardType(props.card?.card_type ?? "basic");
    setFront(props.card?.front ?? "");
    setPhonetic(props.card?.phonetic ?? "");
    setBack(props.card?.back ?? "");
    setExample(props.card?.example ?? "");
    setMnemonic(props.card?.mnemonic ?? "");
    setNote(props.card?.note ?? "");
    setChoices(parseChoices(props.card?.choices).join(" | "));
    setBlankAnswers(nextBlankConfig.answers);
    setBlankOrderless(nextBlankConfig.orderless);
  }, [props.card?.id, props.card?.updated_at]);

  function updateBlankAnswer(groupIndex: number, answerIndex: number, value: string) {
    setBlankAnswers((current) => {
      const next = current.map((group) => [...group]);
      while (next.length <= groupIndex) next.push([""]);
      while (next[groupIndex].length <= answerIndex) next[groupIndex].push("");
      next[groupIndex][answerIndex] = value;
      return next;
    });
  }

  function addBlankAlternative(groupIndex: number) {
    setBlankAnswers((current) => {
      const next = current.map((group) => [...group]);
      while (next.length <= groupIndex) next.push([""]);
      if (next[groupIndex].length < maxBlankAlternatives) next[groupIndex].push("");
      return next;
    });
  }

  function removeBlankAlternative(groupIndex: number, answerIndex: number) {
    if (answerIndex === 0) return;
    setBlankAnswers((current) => current.map((group, index) => index === groupIndex
      ? group.filter((_, itemIndex) => itemIndex !== answerIndex)
      : [...group]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const blankConfig = cardType === "blank" ? normalizeBlankAnswerConfig({
      version: 1,
      orderless: blankOrderless && blankCount > 1,
      answers: visibleBlankAnswers
    }) : null;
    const savedBack = blankConfig ? blankAnswerSummary(blankConfig) : back;
    if (!front.trim() || !savedBack.trim() || cardType === "blank" && (!blankConfig || blankConfig.answers.length !== blankCount) || saving) return;
    setSaving(true);
    try {
      const parsedChoices = parseChoices(choices);
      await props.onSubmit({
        card_type: cardType,
        front,
        back: savedBack,
        phonetic,
        example,
        mnemonic,
        note,
        choices: cardType === "choice" ? parsedChoices : cardType === "blank" ? blankConfig! : []
      });
      if (!props.card) {
        setFront("");
        setPhonetic("");
        setBack("");
        setExample("");
        setMnemonic("");
        setNote("");
        setChoices("");
        setBlankAnswers([[""]]);
        setBlankOrderless(false);
        setCardType("basic");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`card-form ${props.card || props.layout === "single" ? "edit-card-form" : ""}`} onSubmit={submit}>
      <p className="hint">题面、答案、解析、助记、备注和选项均支持 Markdown：标题、引用、列表、链接、图片、表格、任务项、代码块及 LaTeX 公式。</p>
      <EditorField label="卡片类型">
        <select value={cardType} onChange={(event) => {
          const nextType = event.target.value as CardType;
          if (nextType === "blank" && blankAnswers.length === 1 && !blankAnswers[0]?.[0] && back.trim()) setBlankAnswers([[back.trim()]]);
          setCardType(nextType);
        }}>
          <option value="basic">普通卡</option>
          <option value="word">单词卡</option>
          <option value="choice">选择题卡</option>
          <option value="blank">填空题卡</option>
        </select>
      </EditorField>
      <EditorField label={cardType === "word" ? "单词 / 正面" : cardType === "choice" ? "题目" : cardType === "blank" ? "题干" : "正面 / 问题"}>
        <SmartTextField value={front} onChange={setFront} placeholder={cardType === "blank" ? "题干，使用 [] 表示空格" : "输入正面内容"} required allowImageInsert />
      </EditorField>
      {cardType === "blank" && (
        <label className={`blank-orderless-toggle ${blankCount <= 1 ? "disabled" : ""}`}>
          <input
            type="checkbox"
            checked={blankOrderless && blankCount > 1}
            disabled={blankCount <= 1}
            onChange={(event) => setBlankOrderless(event.target.checked)}
          />
          <span>
            <strong>乱序填空</strong>
            <small>{blankCount > 1 ? "开启后，各空的答案可交换位置，但仍需一一对应。" : "题干中至少需要两个空位。"}</small>
          </span>
        </label>
      )}
      {cardType === "choice" && (
        <EditorField label="选项">
          <SmartTextField value={choices} onChange={setChoices} placeholder="用 |、; 分隔，或一行一个选项" multilineThreshold={28} allowImageInsert />
        </EditorField>
      )}
      {cardType === "word" && (
        <EditorField label="音标">
          <SmartTextField value={phonetic} onChange={setPhonetic} placeholder="英式音标，如 /ˈwɔːtə/" />
        </EditorField>
      )}
      {cardType === "blank" ? (
        <div className="editor-field blank-answer-editor">
          <span>填空答案</span>
          <small className="blank-answer-editor-hint">题干当前识别到 {blankCount} 个空；点击 /可为对应空添加可接受的备选答案。</small>
          <div className="blank-answer-editor-list">
            {visibleBlankAnswers.map((group, groupIndex) => (
              <section className="blank-answer-editor-group" key={groupIndex}>
                <span>空 {groupIndex + 1}</span>
                {group.map((item, answerIndex) => (
                  <div className="blank-answer-editor-row" key={answerIndex}>
                    <SmartTextField
                      value={item}
                      onChange={(value) => updateBlankAnswer(groupIndex, answerIndex, value)}
                      placeholder={answerIndex === 0 ? "必填主答案" : `备选答案 ${answerIndex}`}
                      required={answerIndex === 0}
                    />
                    <button
                      className="blank-answer-add-button"
                      type="button"
                      title="增加一个备选答案"
                      disabled={group.length >= maxBlankAlternatives}
                      onClick={() => addBlankAlternative(groupIndex)}
                    >/</button>
                    {answerIndex > 0 && (
                      <button className="blank-answer-remove-button" type="button" title="删除这个备选答案" onClick={() => removeBlankAlternative(groupIndex, answerIndex)}><XCircle /></button>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <EditorField label={cardType === "choice" ? "正确答案" : cardType === "word" ? "释义 / 背面" : "背面 / 答案"}>
          <SmartTextField value={back} onChange={setBack} placeholder={cardType === "choice" ? "多选题用 |、逗号、分号或换行分隔正确选项" : "输入背面或答案内容"} required allowImageInsert />
        </EditorField>
      )}
      <EditorField label={cardType === "choice" || cardType === "blank" ? "解析 / 说明" : cardType === "word" ? "例句 / 说明" : "说明 / 例子"}>
        <SmartTextField value={example} onChange={setExample} placeholder="可选" allowImageInsert />
      </EditorField>
      {cardType === "word" && (
        <EditorField label="助记">
          <SmartTextField value={mnemonic} onChange={setMnemonic} placeholder="可选" allowImageInsert />
        </EditorField>
      )}
      <EditorField label="备注">
        <SmartTextField value={note} onChange={setNote} placeholder="可选" allowImageInsert />
      </EditorField>
      <button className="primary-button" disabled={saving}>{props.card ? <Save /> : <Plus />}{saving ? "处理中" : props.card ? "保存" : "添加"}</button>
      {props.onCancel && <button className="primary-button secondary-button" type="button" disabled={saving} onClick={props.onCancel}><XCircle />取消</button>}
    </form>
  );
}

function EditorField(props: { label: string; children: ReactNode }) {
  return (
    <label className="editor-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function SmartTextField(props: { value: string; onChange: (value: string) => void; placeholder: string; required?: boolean; multilineThreshold?: number; allowImageInsert?: boolean }) {
  const expanded = props.value.length > (props.multilineThreshold ?? 42) || props.value.includes("\n");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageStatus, setImageStatus] = useState<{ kind: "uploading" | "error"; message: string } | null>(null);
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
  async function uploadImage(file: File) {
    const element = ref.current;
    const start = element?.selectionStart ?? props.value.length;
    const end = element?.selectionEnd ?? props.value.length;
    setImageStatus({ kind: "uploading", message: "图片上传中" });
    try {
      const result = await api.uploadCardImage(file);
      const inserted = insertImageMarkdown(props.value, start, end, result.url);
      props.onChange(inserted.value);
      setImageStatus(null);
      window.requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(inserted.cursor, inserted.cursor);
      });
    } catch (error) {
      setImageStatus({ kind: "error", message: (error as Error).message });
    }
  }
  return (
    <span className={`smart-field with-image-insert ${imageStatus?.kind === "error" ? "has-error" : ""}`}>
      <span className="smart-image-input-row">
        {textarea}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) uploadImage(file);
          }}
        />
        <button className="mini-button smart-image-button" type="button" title="从本地上传图片" disabled={imageStatus?.kind === "uploading"} onClick={() => fileInputRef.current?.click()}>
          {imageStatus?.kind === "uploading" ? <RefreshCw /> : <ImageIcon />}
        </button>
      </span>
      {imageStatus && <small className={`smart-image-status ${imageStatus.kind}`}>{imageStatus.message}</small>}
    </span>
  );
}

function StudyView(props: {
  userId: number;
  isSuperuser: boolean;
  cards: Card[];
  decks: Deck[];
  selectedStudyDeckId: number | null;
  onSelectStudyDeck: (id: number) => void;
  selectedDeck?: Deck;
  studyTextScale: number;
  studyPageWidth: number;
  studyTextAlign: Settings["studyTextAlign"];
  studyChoiceLayout: Settings["studyChoiceLayout"];
  studyLineHeight: number;
  studyFontFamily: Settings["studyFontFamily"];
  onStudyTextScale: (scale: number) => Promise<void>;
  onStudyPageWidth: (width: number) => Promise<void>;
  onStudyTextAlign: (align: Settings["studyTextAlign"]) => Promise<void>;
  onStudyChoiceLayout: (layout: Settings["studyChoiceLayout"]) => Promise<void>;
  onStudyLineHeight: (lineHeight: number) => Promise<void>;
  onStudyFontFamily: (fontFamily: Settings["studyFontFamily"]) => Promise<void>;
  autoSpeak: boolean;
  onAnswer: (card: Card, rating: ReviewRating) => Promise<ReviewResult>;
  onPractice: (card: Card, rating: ReviewRating) => Promise<PracticeResult>;
  onUndoAnswer: (card: Card, snapshot: ReviewSnapshot) => Promise<void>;
  onUndoPractice: (card: Card, snapshot: Pick<ReviewSnapshot, "dailyTaskPrevious" | "studyEventId">) => Promise<void>;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<Card | null | undefined>;
  onSpeak: (text: string, language?: string, fallback?: string) => void;
  onLoadPronunciationXml: (payload: { text: string; fallback: string }) => Promise<PronunciationSettings>;
  onSavePronunciationXml: (payload: { text: string; fallback: string; language?: string; ssml: string; prompt: string }) => Promise<void>;
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
  const [roundStudyWords, setRoundStudyWords] = useState(() => storedRoundStudyWords(props.userId));
  const roundStudyWordsRef = useRef(roundStudyWords);
  const [roundResetOpen, setRoundResetOpen] = useState(false);
  const [history, setHistory] = useState<Array<{
    card: Card;
    previous: ReviewSnapshot | Pick<ReviewSnapshot, "dailyTaskPrevious" | "studyEventId">;
    practice: boolean;
    sessionCards: Card[];
    queue: Card[];
    masteredIds: number[];
    longTermSubmittedIds: number[];
    roundStudyWords: number;
    grindGroupNumber: number;
    grindGroupStartedAt: string;
    grindMessage: string;
    flipped: boolean;
    answer: string;
    checked: "right" | "wrong" | null;
    selectedChoice: string[];
  }>>([]);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<"right" | "wrong" | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string[]>([]);
  const [editingStudyCard, setEditingStudyCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState("");
  const [scaleDraft, setScaleDraft] = useState(props.studyTextScale);
  const [scaleSaving, setScaleSaving] = useState(false);
  const [activeTextTool, setActiveTextTool] = useState<"scale" | "lineHeight" | "align" | "choiceLayout" | "font" | null>(null);
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [fontLoading, setFontLoading] = useState(false);
  const [fontStatus, setFontStatus] = useState("点击读取系统字体");
  const [remaining, setRemaining] = useState<ReviewRemaining>({ newRemaining: 0, reviewRemaining: 0 });
  const [pausedCards, setPausedCards] = useState<Card[]>([]);
  const [pausedCardsOpen, setPausedCardsOpen] = useState(false);
  const [pausedCardsLoading, setPausedCardsLoading] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [answerDockOpen, setAnswerDockOpen] = useState(() => storedAnswerDockOpen(props.userId));
  const [answerDockWidth, setAnswerDockWidth] = useState(300);
  const [narrowStudyViewport, setNarrowStudyViewport] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [questionDockAnchor, setQuestionDockAnchor] = useState({ top: 0, left: 0, height: 0 });
  const [cardMotion, setCardMotion] = useState<"entering" | "leaving" | "idle">("entering");
  const [cardRevision, setCardRevision] = useState(0);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [ratingResult, setRatingResult] = useState<RatingFeedback | null>(null);
  const [ratingNotice, setRatingNotice] = useState<RatingFeedback | null>(null);
  const [completionPlayed, setCompletionPlayed] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [pronunciationXmlOpen, setPronunciationXmlOpen] = useState(false);
  const [pronunciationXmlDraft, setPronunciationXmlDraft] = useState("");
  const [pronunciationXmlOriginal, setPronunciationXmlOriginal] = useState("");
  const [pronunciationPromptDraft, setPronunciationPromptDraft] = useState("");
  const [pronunciationPromptOriginal, setPronunciationPromptOriginal] = useState("");
  const [pronunciationXmlCustomized, setPronunciationXmlCustomized] = useState(false);
  const [pronunciationPromptCustomized, setPronunciationPromptCustomized] = useState(false);
  const [pronunciationLimits, setPronunciationLimits] = useState({ ssml: 150, prompt: 500 });
  const [pronunciationXmlBusy, setPronunciationXmlBusy] = useState<"load" | "save" | "">("");
  const [swipePreview, setSwipePreview] = useState<{ rating: ReviewRating; x: number; y: number } | null>(null);
  const [tomatoState, setTomatoState] = useState<TomatoState | null>(null);
  const [pomodoroNow, setPomodoroNow] = useState(() => Date.now());
  const [pomodoroRingSize, setPomodoroRingSize] = useState({ width: 0, height: 0 });
  const studyPanelRef = useRef<HTMLDivElement | null>(null);
  const moreToolsRef = useRef<HTMLDivElement | null>(null);
  const pomodoroMetaRef = useRef<HTMLDivElement | null>(null);
  const cardFrameRef = useRef<HTMLElement | null>(null);
  const answerLayoutRef = useRef<HTMLDivElement | null>(null);
  const studyScrollRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number; scrollTop: number } | null>(null);
  const suppressSwipeClickRef = useRef(false);
  const card = queue[0];
  const activePomodoro = tomatoState?.activePomodoro;
  const pomodoroProgress = activePomodoro ? 1 - pomodoroRemainingRatio(tomatoState, pomodoroNow) : 0;
  const pomodoroRingWidth = Math.max(0, pomodoroRingSize.width - 2);
  const pomodoroRingHeight = Math.max(0, pomodoroRingSize.height - 2);
  const pomodoroTravelled = pomodoroProgress * (pomodoroRingWidth * 2 + pomodoroRingHeight * 2);
  const pomodoroTopProgress = Math.min(pomodoroRingWidth, pomodoroTravelled);
  const pomodoroRightProgress = Math.min(pomodoroRingHeight, Math.max(0, pomodoroTravelled - pomodoroRingWidth));
  const pomodoroBottomProgress = Math.min(pomodoroRingWidth, Math.max(0, pomodoroTravelled - pomodoroRingWidth - pomodoroRingHeight));
  const pomodoroLeftProgress = Math.min(pomodoroRingHeight, Math.max(0, pomodoroTravelled - pomodoroRingWidth * 2 - pomodoroRingHeight));

  useEffect(() => {
    setPronunciationXmlOpen(false);
    setPronunciationXmlDraft("");
    setPronunciationXmlOriginal("");
    setPronunciationPromptDraft("");
    setPronunciationPromptOriginal("");
    setPronunciationXmlCustomized(false);
    setPronunciationPromptCustomized(false);
    setPronunciationXmlBusy("");
    setSwipePreview(null);
    swipeStartRef.current = null;
  }, [card?.id]);

  useEffect(() => {
    if (!moreToolsOpen) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (!moreToolsRef.current?.contains(event.target as Node)) setMoreToolsOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () => document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, [moreToolsOpen]);

  async function togglePronunciationXml() {
    if (pronunciationXmlOpen) {
      setPronunciationXmlOpen(false);
      return;
    }
    if (!card || !isWordCard(card)) return;
    setPronunciationXmlOpen(true);
    setPronunciationXmlBusy("load");
    try {
      const result = await props.onLoadPronunciationXml({ text: card.phonetic || card.front, fallback: card.front });
      setPronunciationXmlDraft(result.ssml);
      setPronunciationXmlOriginal(result.ssml);
      setPronunciationPromptDraft(result.prompt);
      setPronunciationPromptOriginal(result.prompt);
      setPronunciationXmlCustomized(result.customized);
      setPronunciationPromptCustomized(result.promptCustomized);
      setPronunciationLimits({ ssml: result.maxSsmlLength, prompt: result.maxPromptLength });
    } catch {
      setPronunciationXmlOpen(false);
    } finally {
      setPronunciationXmlBusy("");
    }
  }

  async function submitPronunciationXml(event: FormEvent) {
    event.preventDefault();
    const nextSsml = pronunciationXmlDraft.trim();
    const nextPrompt = pronunciationPromptDraft.trim();
    if (!card || !isWordCard(card) || pronunciationXmlBusy || !nextSsml || !nextPrompt || (nextSsml === pronunciationXmlOriginal && nextPrompt === pronunciationPromptOriginal)) return;
    setPronunciationXmlBusy("save");
    try {
      await props.onSavePronunciationXml({
        text: card.phonetic || card.front,
        fallback: card.front,
        language: card.language ?? props.selectedDeck?.language,
        ssml: nextSsml,
        prompt: nextPrompt
      });
      setPronunciationXmlDraft(nextSsml);
      setPronunciationXmlOriginal(nextSsml);
      setPronunciationPromptDraft(nextPrompt);
      setPronunciationPromptOriginal(nextPrompt);
      setPronunciationXmlCustomized(true);
      setPronunciationPromptCustomized(true);
    } catch {
      // The parent displays the API error and the editor keeps the draft for correction or retry.
    } finally {
      setPronunciationXmlBusy("");
    }
  }

  useEffect(() => {
    if (studyMode === "grind") {
      resetSession();
      setGrindMessage("请选择卡组并点击开始无尽学习。");
      return;
    }
    startSession().catch((error) => console.error(error));
  }, [studyMode, props.selectedStudyDeckId]);

  useEffect(() => {
    loadRemaining().catch((error) => console.error(error));
    setPausedCards([]);
    setPausedCardsOpen(false);
  }, [props.selectedStudyDeckId]);

  useLayoutEffect(() => {
    const node = pomodoroMetaRef.current;
    if (!node) return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setPomodoroRingSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [card?.id]);

  useEffect(() => {
    let mounted = true;
    const loadTomatoState = async () => {
      try {
        const payload = await api.tomatoState();
        if (mounted) setTomatoState(payload.state);
      } catch (error) {
        console.error(error);
      }
    };
    loadTomatoState();
    const syncTimer = window.setInterval(loadTomatoState, 15_000);
    const countdownTimer = window.setInterval(() => setPomodoroNow(Date.now()), 1_000);
    return () => {
      mounted = false;
      window.clearInterval(syncTimer);
      window.clearInterval(countdownTimer);
    };
  }, []);

  useEffect(() => {
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setSelectedChoice([]);
    setCelebrationKey(0);
    setRatingResult(null);
    setEditingStudyCard(null);
    setCardMotion("entering");
    const timer = window.setTimeout(() => setCardMotion("idle"), 220);
    if (props.autoSpeak && card && isWordCard(card)) props.onSpeak(card.phonetic || card.front, card.language ?? props.selectedDeck?.language, card.front);
    return () => window.clearTimeout(timer);
  }, [card?.id, cardRevision, props.autoSpeak]);

  useEffect(() => {
    if (sessionCards.length > 0 && !card && !completionPlayed) {
      playCompletionSound();
      setCompletionPlayed(true);
    }
  }, [card, completionPlayed, sessionCards.length]);

  useEffect(() => {
    if (!ratingNotice) return;
    const timer = window.setTimeout(() => setRatingNotice(null), 3800);
    return () => window.clearTimeout(timer);
  }, [ratingNotice]);

  useLayoutEffect(() => {
    const panel = studyPanelRef.current;
    const cardFrame = cardFrameRef.current;
    const answerLayout = answerLayoutRef.current;
    if (!panel || !cardFrame) return;

    const updateAnchor = () => {
      const panelRect = panel.getBoundingClientRect();
      const cardRect = cardFrame.getBoundingClientRect();
      const referenceRect = answerLayout?.classList.contains("with-dock") ? answerLayout.getBoundingClientRect() : undefined;
      const inset = 8;
      const rightEdge = referenceRect?.right ?? cardRect.right;
      panel.style.setProperty("--rating-toast-right", `${Math.max(0, panelRect.right - rightEdge + inset)}px`);
      panel.style.setProperty("--rating-toast-bottom", `${Math.max(0, panelRect.bottom - cardRect.bottom + inset)}px`);
      panel.style.setProperty("--rating-toast-max-width", `${Math.max(220, (referenceRect?.width ?? cardRect.width) - inset * 2)}px`);
      if (referenceRect) {
        const nextAnchor = {
          // Match the reference dock to the card layout itself. The scroll
          // container includes bottom padding for the rating controls, which
          // otherwise makes the dock extend below the card in fullscreen.
          top: referenceRect.top,
          left: referenceRect.right - answerDockWidth,
          height: referenceRect.height
        };
        setQuestionDockAnchor((anchor) => (
          anchor.top === nextAnchor.top && anchor.left === nextAnchor.left && anchor.height === nextAnchor.height
            ? anchor
            : nextAnchor
        ));
      }
      // Content width is now computed in CSS via calc(100% * var(--study-page-width))
    };

    updateAnchor();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAnchor);
    resizeObserver?.observe(panel);
    resizeObserver?.observe(cardFrame);
    if (answerLayout) resizeObserver?.observe(answerLayout);
    window.addEventListener("resize", updateAnchor);
    document.addEventListener("fullscreenchange", updateAnchor);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateAnchor);
      document.removeEventListener("fullscreenchange", updateAnchor);
    };
  }, [card?.id, cardRevision, flipped, checked, answerDockOpen, answerDockWidth, immersive, props.studyChoiceLayout, props.studyTextScale, props.studyTextAlign, props.studyLineHeight, props.studyFontFamily]);

  useEffect(() => {
    setScaleDraft(props.studyTextScale);
  }, [props.studyTextScale]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${roundStudyWordsStoragePrefix}:${props.userId}`, String(roundStudyWords));
    } catch {
      // The in-memory counter still works when storage is unavailable.
    }
  }, [props.userId, roundStudyWords]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${answerDockOpenStoragePrefix}:${props.userId}`, answerDockOpen ? "open" : "closed");
    } catch {
      // The in-memory preference still works when storage is unavailable.
    }
  }, [props.userId, answerDockOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle("study-immersive-active", immersive);
    return () => document.documentElement.classList.remove("study-immersive-active");
  }, [immersive]);

  useEffect(() => {
    const onFullscreen = () => setImmersive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setNarrowStudyViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
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
    setSelectedChoice([]);
    setCelebrationKey(0);
    setRatingResult(null);
    setCompletionPlayed(false);
    setEditingStudyCard(null);
    setCardRevision((value) => value + 1);
    setCardMotion("entering");
  }

  function setCurrentRoundStudyWords(nextValue: number) {
    const next = Math.max(0, Math.floor(nextValue));
    roundStudyWordsRef.current = next;
    setRoundStudyWords(next);
  }

  function updateCurrentRoundStudyWords(action: Parameters<typeof updateGrindStudyWords>[1]) {
    const next = updateGrindStudyWords(roundStudyWordsRef.current, action);
    setCurrentRoundStudyWords(next);
    return next;
  }

  async function startSession(nextLimit = sessionLimit) {
    if (!props.selectedStudyDeckId || busyRef.current) return;
    busyRef.current = true;
    setBusy("session");
    try {
      const nextCards = await api.dueCards(props.selectedStudyDeckId, Math.max(1, nextLimit), studyMode === "new" ? "new" : "review");
      setSessionCards(nextCards);
      setQueue(nextCards);
      setMasteredIds([]);
      setLongTermSubmittedIds([]);
      setHistory([]);
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice([]);
      setCelebrationKey(0);
      setRatingResult(null);
      setCompletionPlayed(false);
      setEditingStudyCard(null);
      setCardRevision(0);
      setRatingResult(null);
      setCardMotion("entering");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function loadGrindCards(excludeIds: number[] = [], targetSize = grindGroupSize) {
    if (!props.selectedStudyDeckId) return [];
    const target = clampGrindGroupSize(targetSize);
    const excluded = new Set(excludeIds);
    const reviewCards = (await api.dueCards(props.selectedStudyDeckId, Math.min(200, target + excluded.size + 20), "review"))
      .filter((item) => !excluded.has(item.id));
    const selectedReviewCards = reviewCards.slice(0, target);
    if (selectedReviewCards.length >= target) return selectedReviewCards;
    selectedReviewCards.forEach((item) => excluded.add(item.id));
    const newCards = (await api.dueCards(props.selectedStudyDeckId, Math.min(200, target - selectedReviewCards.length + excluded.size + 20), "new"))
      .filter((item) => !excluded.has(item.id))
      .slice(0, target - selectedReviewCards.length);
    return [...selectedReviewCards, ...newCards];
  }

  async function startGrindSession(nextGroupSize = grindGroupSize) {
    const size = clampGrindGroupSize(nextGroupSize);
    setGrindGroupSize(size);
    if (!props.selectedStudyDeckId) {
      setGrindMessage("请先选择一个卡组。");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("session");
    try {
      const startedAt = new Date().toISOString();
      const nextCards = await loadGrindCards([], size);
      const continuingGroup = sessionCards.length > 0 && queue.length === 0;
      const nextGroupNumber = continuingGroup ? grindGroupNumber + 1 : 1;
      resetSession();
      updateCurrentRoundStudyWords({ type: "continue" });
      setGrindGroupNumber(nextCards.length > 0 ? nextGroupNumber : 0);
      setGrindGroupStartedAt(nextCards.length > 0 ? startedAt : "");
      setSessionCards(nextCards);
      setQueue(nextCards);
      setCompletionPlayed(false);
      setGrindMessage(nextCards.length > 0 ? "无尽模式已开始。" : "无尽模式完成：当前卡组下暂无到期复习卡和新卡。");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function loadRemaining() {
    if (!props.selectedStudyDeckId) {
      setRemaining({ newRemaining: 0, reviewRemaining: 0 });
      return;
    }
    setRemaining(await api.reviewRemaining(props.selectedStudyDeckId));
  }

  async function togglePausedCards() {
    if (pausedCardsOpen) {
      setPausedCardsOpen(false);
      return;
    }
    if (!props.selectedStudyDeckId) return;
    setPausedCardsLoading(true);
    try {
      setPausedCards(await api.pausedCards(props.selectedStudyDeckId));
      setPausedCardsOpen(true);
    } finally {
      setPausedCardsLoading(false);
    }
  }

  async function resumePausedCard(pausedCard: Card) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(`resume-card-${pausedCard.id}`);
    try {
      const updatedCard = await props.onUpdateCard(pausedCard.id, { paused: 0, baseUpdatedAt: pausedCard.updated_at });
      if (!updatedCard) return;
      setPausedCards((items) => items.filter((item) => item.id !== pausedCard.id));
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function dueReviewInterrupts(nextQueue: Card[], excludeIds: number[] = []) {
    if (studyMode !== "grind" || !props.selectedStudyDeckId) return [];
    const queuedIds = new Set([...nextQueue.map((item) => item.id), ...excludeIds]);
    return (await api.dueCards(props.selectedStudyDeckId, 100, "review"))
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
    const beforeRoundStudyWords = roundStudyWordsRef.current;
    try {
      const startedAsNew = beforeSessionCards.some((item) => item.id === card.id && item.stage <= 0);
      const alreadySubmitted = beforeLongTermSubmittedIds.includes(card.id);
      const practice = shouldUsePractice({
        alreadySubmitted,
        alreadyMastered: beforeMasteredIds.includes(card.id),
        startedAsNew,
        rating
      });
      const answerWeight = studyAnswerWeight({ startedAsNew, alreadySubmitted });
      const result = practice ? await props.onPractice(card, rating) : await props.onAnswer(card, rating);
      const feedback = ratingFeedback(rating, card.stage, result);
      playAnswerSound(rating === "known" ? "right" : "wrong");
      const nextRatingFeedback = { ...feedback, key: Date.now() };
      setRatingResult(nextRatingFeedback);
      setRatingNotice(nextRatingFeedback);
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
      let grindMoreAvailable = false;
      if (studyMode === "grind") {
        const interrupts = await dueReviewInterrupts(nextQueue, finalLongTermSubmittedIds);
        if (interrupts.length > 0) {
          const adjusted = applyGrindInterrupts(nextQueue, nextSessionCards, interrupts, grindGroupSize);
          nextQueue = adjusted.queue;
          nextSessionCards = adjusted.sessionCards;
        }
        if (nextQueue.length === 0) {
          const latestRemaining = await api.reviewRemaining(props.selectedStudyDeckId ?? undefined);
          if (latestRemaining.reviewRemaining > 0 || latestRemaining.newRemaining > 0) {
            setGrindMessage("本组完成，可以继续下一组或休息一下。");
            grindMoreAvailable = true;
          } else {
            setGrindMessage("无尽模式完成：当前卡组下暂无到期复习卡和新卡。");
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
        roundStudyWords: beforeRoundStudyWords,
        grindGroupNumber,
        grindGroupStartedAt,
        grindMessage,
        flipped,
        answer,
        checked,
        selectedChoice
      }]);
      await delay(720);
      setCardMotion("leaving");
      await delay(140);
      setSessionCards(nextSessionCards);
      setQueue(nextQueue);
      setMasteredIds(finalMasteredIds);
      if (nextQueue.length === 0 && document.fullscreenElement && !grindMoreAvailable) {
        document.exitFullscreen().catch(() => undefined);
        setImmersive(false);
      }
      setLongTermSubmittedIds(finalLongTermSubmittedIds);
      updateCurrentRoundStudyWords({ type: "answer", weight: answerWeight });
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice([]);
      setCelebrationKey(0);
      setRatingResult(null);
      setCardRevision((value) => value + 1);
      setCardMotion("entering");
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function startCardSwipe(event: ReactTouchEvent<HTMLDivElement>) {
    if (!showManualRatings || editingStudyCard || pronunciationXmlOpen || busyRef.current || event.touches.length !== 1) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !cardFrameRef.current?.contains(target)) return;
    if (target.closest("input, textarea, select, a, .choice-grid button, .blank-submit-button, .question-dock-resizer")) return;
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, scrollTop: studyScrollRef.current?.scrollTop ?? 0 };
  }

  function moveCardSwipe(event: ReactTouchEvent<HTMLDivElement>) {
    const start = swipeStartRef.current;
    if (!start || busyRef.current) return;
    if (event.touches.length !== 1) {
      cancelCardSwipe();
      return;
    }
    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const currentScrollTop = studyScrollRef.current?.scrollTop ?? 0;
    const rating = resolveStudySwipe(deltaX, deltaY, start.scrollTop, currentScrollTop, 18);
    if (!rating) {
      setSwipePreview(null);
      return;
    }
    event.preventDefault();
    setSwipePreview({
      rating,
      x: rating === "fuzzy" ? 0 : Math.max(-120, Math.min(120, deltaX)),
      y: rating === "fuzzy" ? Math.max(0, Math.min(96, deltaY)) : 0
    });
  }

  function finishCardSwipe(event: ReactTouchEvent<HTMLDivElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setSwipePreview(null);
    if (!start || event.changedTouches.length !== 1 || busyRef.current) return;
    const touch = event.changedTouches[0];
    const rating = resolveStudySwipe(
      touch.clientX - start.x,
      touch.clientY - start.y,
      start.scrollTop,
      studyScrollRef.current?.scrollTop ?? 0
    );
    if (!rating) return;
    event.preventDefault();
    suppressSwipeClickRef.current = true;
    window.setTimeout(() => { suppressSwipeClickRef.current = false; }, 500);
    rate(rating).catch((error) => console.error(error));
  }

  function cancelCardSwipe() {
    swipeStartRef.current = null;
    setSwipePreview(null);
  }

  function flipStudyCard() {
    if (suppressSwipeClickRef.current) {
      suppressSwipeClickRef.current = false;
      return;
    }
    setFlipped((value) => !value);
  }

  async function undo() {
    const previous = history.at(-1);
    if (!previous || busyRef.current) return;
    busyRef.current = true;
    setBusy("undo");
    try {
      if (previous.practice) {
        await props.onUndoPractice(previous.card, previous.previous as Pick<ReviewSnapshot, "dailyTaskPrevious" | "studyEventId">);
      } else {
        await props.onUndoAnswer(previous.card, previous.previous as ReviewSnapshot);
      }
      setHistory((items) => items.slice(0, -1));
      setSessionCards(previous.sessionCards);
      setQueue(previous.queue);
      setMasteredIds(previous.masteredIds);
      setLongTermSubmittedIds(previous.longTermSubmittedIds);
      setCurrentRoundStudyWords(previous.roundStudyWords);
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
    setSelectedChoice([]);
    const result = isCorrectAnswer(card, answer) ? "right" : "wrong";
    playAnswerSound(result);
    if (result === "right") setCelebrationKey((key) => key + 1);
    setChecked(result);
  }

  function submitBlankAnswer(event: FormEvent) {
    event.preventDefault();
    if (!card || !splitBlankAnswers(answer, Math.max(1, blankMarkerCount(card.front))).every((part) => part.trim()) || busy) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur();
    checkWritten();
  }

  function checkChoice(choice: string) {
    if (!card || checked) return;
    setSelectedChoice([choice]);
    const result = answersMatch(choice, card.back) ? "right" : "wrong";
    playAnswerSound(result);
    if (result === "right") setCelebrationKey((key) => key + 1);
    setChecked(result);
  }

  function selectChoice(choice: string) {
    if (!card || checked) return;
    if (splitChoiceAnswers(card.back).length <= 1) {
      checkChoice(choice);
      return;
    }
    setSelectedChoice((current) => current.some((item) => answersMatch(item, choice))
      ? current.filter((item) => !answersMatch(item, choice))
      : [...current, choice]);
  }

  function submitMultipleChoice() {
    if (!card || checked || selectedChoice.length === 0) return;
    const result = choiceAnswerSetMatches(selectedChoice, splitChoiceAnswers(card.back)) ? "right" : "wrong";
    playAnswerSound(result);
    if (result === "right") setCelebrationKey((key) => key + 1);
    setChecked(result);
  }

  const choices = useMemo(() => {
    if (!card) return [];
    const correctChoices = splitChoiceAnswers(card.back);
    const baseChoices = dedupeChoiceOptions(parseChoices(card.choices)).filter((choice) => correctChoices.length <= 1 || normalizeAnswer(choice) !== normalizeAnswer(card.back));
    const source = card.card_type === "choice"
      ? [...baseChoices, ...correctChoices.filter((answer) => !baseChoices.some((choice) => answersMatch(choice, answer)))]
      : sessionCards.filter((item) => item.id !== card.id).slice(0, 3).map((item) => item.back).concat(card.back);
    return dedupeChoiceOptions(source).sort(() => 0.5 - Math.random());
  }, [card?.id, sessionCards]);

  const correctChoiceAnswers = card ? dedupeChoiceAnswers(splitChoiceAnswers(card.back)) : [];
  const multipleChoice = correctChoiceAnswers.length > 1;
  const displayCorrect = card
    ? correctChoiceAnswers.map((answer) => choices.find((choice) => answersMatch(choice, answer)) ?? answer).join("、")
    : "";

  const completed = masteredIds.length;
  const total = sessionCards.length;
  const explanation = card?.example ?? "";
  const otherNote = card?.note ?? "";
  const explanationText = [explanation, otherNote].filter(Boolean).join("\n\n");
  const cardHasLatexFormula = Boolean(card && [
    card.front,
    card.back,
    card.example,
    card.mnemonic,
    card.note,
    ...(card.card_type === "choice" ? choices : [])
  ].some(hasLatexFormula));
  const explanationIsLong = explanationText.length > 80 || /\n|```|\$\$/.test(explanationText);
  const isBasicCard = card?.card_type === "basic";
  const showAnswerDock = Boolean(card && checked && explanationIsLong && answerDockOpen);
  const showBasicReferenceDock = Boolean(isBasicCard && flipped && answerDockOpen);
  const showReferenceDock = showAnswerDock || showBasicReferenceDock;
  const canToggleReferenceDock = Boolean(isBasicCard ? flipped : checked && explanationIsLong);
  const hasReferenceDock = showAnswerDock || showBasicReferenceDock;
  const showManualRatings = card ? card.card_type !== "choice" && card.card_type !== "blank" || checked !== null : false;
  const currentBlankCount = card?.card_type === "blank" ? Math.max(1, blankMarkerCount(card.front)) : 1;
  const currentBlankParts = splitBlankAnswers(answer, currentBlankCount);
  const blankAnswerReady = currentBlankParts.every((part) => Boolean(part.trim()));
  const displayedBlankAnswer = displayBlankAnswer(answer);

  const scale = scaleDraft;
  const studyStyle = {
    "--study-face-min": `${Math.round(32 * scale)}px`,
    "--study-face-max": `${Math.round(72 * scale)}px`,
    "--study-word-min": `${Math.round(34 * scale)}px`,
    "--study-word-max": `${Math.round(64 * scale)}px`,
    "--study-phrase-word-min": `${Math.round(29 * scale)}px`,
    "--study-phrase-word-max": `${Math.round(54 * scale)}px`,
    "--study-phonetic-min": `${Math.round(18 * scale)}px`,
    "--study-phonetic-max": `${Math.round(28 * scale)}px`,
    "--study-back-min": `${Math.round(20 * scale)}px`,
    "--study-back-max": `${Math.round(30 * scale)}px`,
    "--study-small-size": `${Math.round(16 * scale)}px`,
    "--study-detail-size": `${Math.round(16 * scale)}px`,
    "--study-question-size": `${Math.round(24 * scale)}px`,
    "--study-choice-size": `${Math.round(16 * scale)}px`,
    "--study-result-size": `${Math.round(16 * scale)}px`,
    "--study-word-content-max": `${Math.round(720 * Math.max(1, scale))}px`,
    "--study-word-back-edge-space": `${Math.round(80 * Math.max(0, scale - 1))}px`,
    "--study-page-width": String(props.studyPageWidth),
    "--study-text-align": props.studyTextAlign,
    "--study-line-height": String(props.studyLineHeight + (cardHasLatexFormula ? 0.5 : 0)),
    "--study-font-family": studyFontStack(props.studyFontFamily),
    "--study-front-min": `${Math.round(29 * scale * 0.65)}px`,
    "--study-front-max": `${Math.round(54 * scale * 0.65)}px`,
    "--answer-dock-width": `${answerDockWidth}px`
  } as CSSProperties & Record<string, string>;
  const desktopQuestionDockStyle = {
    ...studyStyle,
    "--question-dock-top": `${questionDockAnchor.top}px`,
    "--question-dock-left": `${questionDockAnchor.left}px`,
    "--question-dock-height": `${questionDockAnchor.height}px`
  } as CSSProperties & Record<string, string>;
  const desktopQuestionDock = !card ? null : showBasicReferenceDock ? (
    <QuestionDock
      card={card}
      selected=""
      answer={card.back}
      onResize={resizeAnswerDock}
      onClose={() => setAnswerDockOpen(false)}
      style={desktopQuestionDockStyle}
    />
  ) : showAnswerDock && card.card_type === "choice" ? (
    <QuestionDock
      card={card}
      choices={choices}
      selected={selectedChoice.join("、")}
      selectedChoices={selectedChoice}
      answer={card.back}
      onResize={resizeAnswerDock}
      onClose={() => setAnswerDockOpen(false)}
      style={desktopQuestionDockStyle}
    />
  ) : showAnswerDock && card.card_type === "blank" ? (
    <QuestionDock
      card={card}
      selected={displayedBlankAnswer}
      answer={correctAnswer(card)}
      onResize={resizeAnswerDock}
      onClose={() => setAnswerDockOpen(false)}
      style={desktopQuestionDockStyle}
    />
  ) : null;
  const swipeStyle = swipePreview ? {
    "--swipe-x": `${swipePreview.x}px`,
    "--swipe-y": `${swipePreview.y}px`,
    "--swipe-rotation": `${swipePreview.x / 18}deg`
  } as CSSProperties & Record<string, string> : undefined;

  async function saveScale(nextScale: number) {
    setScaleDraft(nextScale);
    setScaleSaving(true);
    try {
      await props.onStudyTextScale(nextScale);
    } finally {
      setScaleSaving(false);
    }
  }

  async function savePageWidth(nextWidth: number) {
    if (Math.abs(nextWidth - props.studyPageWidth) < 0.001) return;
    await props.onStudyPageWidth(nextWidth);
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

  async function pauseCurrentCard() {
    if (!card || busyRef.current) return;
    busyRef.current = true;
    setBusy("pause-card");
    try {
      const updatedCard = await props.onUpdateCard(card.id, { paused: 1, baseUpdatedAt: card.updated_at });
      if (!updatedCard) return;
      const withoutCurrent = (items: Card[]) => items.filter((item) => item.id !== card.id);
      setSessionCards(withoutCurrent);
      setQueue(withoutCurrent);
      setHistory((items) => items
        .filter((item) => item.card.id !== card.id)
        .map((item) => ({ ...item, sessionCards: withoutCurrent(item.sessionCards), queue: withoutCurrent(item.queue) }))
      );
      setMasteredIds((ids) => ids.filter((id) => id !== card.id));
      setLongTermSubmittedIds((ids) => ids.filter((id) => id !== card.id));
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice([]);
      setRatingResult(null);
      await loadRemaining();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
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

  async function restFromGrind() {
    if (document.fullscreenElement) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          document.removeEventListener("fullscreenchange", finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 800);
        document.addEventListener("fullscreenchange", finish);
        document.exitFullscreen().catch(finish);
      });
      setImmersive(Boolean(document.fullscreenElement));
    }
    resetSession();
    setGrindMessage("已休息，准备好后再开始无尽学习。");
  }

  async function handleRest() {
    if (document.fullscreenElement) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          document.removeEventListener("fullscreenchange", finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 800);
        document.addEventListener("fullscreenchange", finish);
        document.exitFullscreen().catch(finish);
      });
      setImmersive(Boolean(document.fullscreenElement));
    }
    if (studyMode === "grind") {
      resetSession();
      setGrindMessage("已休息，准备好后再开始无尽学习。");
    } else {
      resetSession();
    }
  }

  function resetRoundStudyWords() {
    if (busyRef.current) return;
    updateCurrentRoundStudyWords({ type: "reset" });
    setRoundResetOpen(false);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      const editable = Boolean(target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tagName));
      const ratingShortcut = ratingShortcutForKey(event.key);
      const submittedBlankInputShortcut = Boolean(
        ratingShortcut
        && checked
        && card?.card_type === "blank"
        && target?.matches("input.blank-inline-input")
      );
      if ((editable && !submittedBlankInputShortcut) || editingStudyCard || pronunciationXmlOpen || roundResetOpen || event.metaKey || event.ctrlKey || event.altKey || busyRef.current) return;

      if ((event.key === "ArrowRight" || event.key === " ") && !card && total > 0) {
        event.preventDefault();
        if (studyMode === "grind" && grindMessage.startsWith("无尽模式完成")) return;
        if (studyMode === "grind") startGrindSession();
        else startSession();
        return;
      }

      if (event.key === "ArrowLeft" && !card && total > 0 && history.length > 0) {
        event.preventDefault();
        undo();
        return;
      }

      if (!card) return;

      if (event.key === "ArrowRight" || event.key === " ") {
        if (card.card_type !== "basic" && card.card_type !== "word") return;
        event.preventDefault();
        setFlipped((value) => !value);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        undo();
        return;
      }

      if (!showManualRatings || !ratingShortcut) return;
      event.preventDefault();
      rate(ratingShortcut);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [card?.id, card?.card_type, editingStudyCard, pronunciationXmlOpen, roundResetOpen, total, studyMode, grindMessage, showManualRatings, history.length, checked]);

  return (
    <section className={`stack study-view ${immersive ? "immersive" : ""}`}>
      <div className="panel study-selector">
        <label>
          学习卡组
          <select value={props.selectedStudyDeckId ?? ""} onChange={(event) => props.onSelectStudyDeck(Number(event.target.value))}>
            <option value="" disabled>选择卡组</option>
            {props.decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name} · {deck.due_count || 0} 到期
              </option>
            ))}
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
            <button className={studyMode === "grind" ? "active" : ""} onClick={() => setStudyMode("grind")}>无尽模式</button>
          </div>
          {studyMode === "grind" ? (
            <>
              <label>
                每组卡片数
                <input type="number" min={1} max={100} value={grindGroupSize} onChange={(event) => setGrindGroupSize(clampGrindGroupSize(event.target.value))} />
              </label>
              <button className="primary-button" disabled={busy === "session" || !props.selectedStudyDeckId} onClick={() => startGrindSession()}><Sparkles />{busy === "session" ? "载入中" : "开始无尽学习"}</button>
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
        <div className="study-paused-controls">
          <button className="primary-button secondary-button" disabled={!props.selectedStudyDeckId || pausedCardsLoading} onClick={togglePausedCards}><Pause />{pausedCardsOpen ? "收起已暂停卡片" : pausedCardsLoading ? "读取中" : "已暂停卡片"}</button>
          {pausedCardsOpen && (
            <div className="study-paused-card-list">
              {pausedCards.length === 0 ? <span>当前卡组没有已暂停卡片。</span> : pausedCards.map((pausedCard) => (
                <div key={pausedCard.id}>
                  <MarkdownText value={pausedCard.front} />
                  <button className="mini-button" title="启动卡片" disabled={busy === `resume-card-${pausedCard.id}`} onClick={() => resumePausedCard(pausedCard)}><Play /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        {studyMode === "grind" && (
          <div className="study-remaining" aria-label="无尽模式状态">
            <span>当前模式：无尽模式</span>
            <span>卡组：{props.selectedDeck?.name ?? "未选择"}</span>
            <span>第 {grindGroupNumber || 0} 组</span>
            <span>本组目标 {grindGroupSize}</span>
            <span>已加入 {sessionCards.length}</span>
            {grindMessage && <span>{grindMessage}</span>}
          </div>
        )}
      </div>

      {!card ? total > 0 ? (
        studyMode === "grind" && grindMessage.startsWith("无尽模式完成")
          ? <EmptyState text="无尽模式完成：当前卡组下暂无到期复习卡和新卡。" />
          : <StudyComplete
              total={total}
              completed={completed}
              onRestart={() => studyMode === "grind" ? startGrindSession() : startSession()}
              onRest={handleRest}
              onUndo={history.length > 0 ? undo : undefined}
              restartLabel={studyMode === "grind" ? "继续下一组" : "再来一轮"}
              busy={busy === "session"}
            />
      ) : <EmptyState text={studyMode === "grind" ? (props.selectedStudyDeckId ? "请选择开始无尽学习。" : "请先选择一个卡组。") : studyMode === "new" ? "这个卡组暂无可新学卡片。" : "这个卡组暂无到期复习卡片。"} /> : (
        <div ref={studyPanelRef} key={`${card.id}-${cardRevision}`} className={`study-panel ${cardMotion} align-${props.studyTextAlign} ${checked === "right" ? "celebrating" : ""} ${pronunciationXmlOpen ? "xml-open" : ""} ${moreToolsOpen ? "more-tools-open" : ""}`} style={studyStyle}>
          {checked === "right" && (
            <div className="answer-celebration" key={celebrationKey} aria-hidden="true">
              <span className="celebration-ring" />
              <span className="celebration-badge"><CheckCircle2 />太棒了</span>
              {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
            </div>
          )}
          {ratingResult && <RatingCelebration feedback={ratingResult} />}
          <div className="study-fixed-top">
            <div className="progress-line" style={{ "--progress-ratio": String(Math.min(completed / Math.max(total, 1), 1)) } as CSSProperties}>
              <span>{completed}</span>
              <div><i /></div>
              <span>{total}</span>
            </div>
            <div className="study-actions">
              <div className="study-meta-left" aria-label="当前番茄钟">
                <div className="pomodoro-meta" ref={pomodoroMetaRef}>
                  <span className="type-pill">番茄钟 {formatPomodoroCountdown(tomatoState, pomodoroNow)}</span>
                  <span className="type-pill">番茄数量 {activePomodoro?.no ?? "—"}</span>
                  <span className="type-pill" title={activePomodoro?.taskGoal || "当前未设置任务"}>任务 {activePomodoro?.taskGoal || "未设置"}</span>
                  <svg className="pomodoro-progress-ring" viewBox={`0 0 ${pomodoroRingSize.width || 1} ${pomodoroRingSize.height || 1}`} preserveAspectRatio="none" aria-hidden="true">
                    {pomodoroTopProgress > 0 && <line className="pomodoro-progress-value" x1="1" y1="1" x2={pomodoroTopProgress + 1} y2="1" />}
                    {pomodoroRightProgress > 0 && <line className="pomodoro-progress-value" x1={pomodoroRingWidth + 1} y1="1" x2={pomodoroRingWidth + 1} y2={pomodoroRightProgress + 1} />}
                    {pomodoroBottomProgress > 0 && <line className="pomodoro-progress-value" x1={pomodoroRingWidth + 1} y1={pomodoroRingHeight + 1} x2={pomodoroRingWidth - pomodoroBottomProgress + 1} y2={pomodoroRingHeight + 1} />}
                    {pomodoroLeftProgress > 0 && <line className="pomodoro-progress-value" x1="1" y1={pomodoroRingHeight + 1} x2="1" y2={pomodoroRingHeight - pomodoroLeftProgress + 1} />}
                  </svg>
                </div>
                {<button type="button" className="type-pill study-round-count-pill" title="重置本轮学习数量" disabled={Boolean(busy)} onClick={() => setRoundResetOpen(true)}>本轮学习 {roundStudyWords}</button>}
                <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
                <span className="type-pill study-schedule-pill" title={`下次复习：${fullDateTime(card.due_at)}（${dueText(card.due_at)}）`}>{studyScheduleText(card)}</span>
                <span className="type-pill study-new-remaining-pill">新学剩余 {remaining.newRemaining}</span>
                <span className="type-pill study-review-remaining-pill">旧卡剩余 {remaining.reviewRemaining}</span>
              </div>
              <div className="study-quick-actions">
                <button className="mini-button" title="发音" onClick={() => props.onSpeak(isWordCard(card) && card.phonetic ? card.phonetic : card.front, card.language ?? props.selectedDeck?.language, card.front)}><Volume2 /></button>
                <button className="mini-button" title="切换到前一张" disabled={history.length === 0 || Boolean(busy)} onClick={undo}><ArrowLeft /></button>
                <button className="mini-button" title={immersive ? "退出沉浸学习" : "沉浸学习"} onClick={toggleImmersive}>{immersive ? <Minimize2 /> : <Maximize2 />}</button>
                <button className="mini-button" title="暂停当前卡片" disabled={Boolean(busy)} onClick={pauseCurrentCard}><Pause /></button>
                <button className="mini-button" title="编辑当前卡片" onClick={editCurrentStudyCard}><Edit3 /></button>
                <div ref={moreToolsRef}>
                <TextToolButton icon={<MoreHorizontal />} title="更多学习工具" active={moreToolsOpen} onClick={() => setMoreToolsOpen((open) => !open)}>
                  {moreToolsOpen && (
                    <div className="text-tool-popover study-more-popover">
                      <strong>学习设置</strong>
                      <div className="study-more-options">
                        <label className="study-more-select">
                          <span>字体大小</span>
                          <select aria-label="字体大小" value={scaleDraft} disabled={scaleSaving} onChange={(event) => saveScale(Number(event.target.value))}>
                            {[0.5, 0.625, 0.85, 1, 1.15, 1.25, 1.35].map((value) => <option key={value} value={value}>{Math.round(value * 1000) / 10}%</option>)}
                          </select>
                        </label>
                        <label className="study-more-select">
                          <span>页宽</span>
                          <select aria-label="页宽" value={props.studyPageWidth} onChange={(event) => savePageWidth(Number(event.target.value))}>
                            {[0.5, 0.625, 0.75, 0.875, 1].map((value) => <option key={value} value={value}>{Math.round(value * 1000) / 10}%</option>)}
                          </select>
                        </label>
                        <label className="study-more-select">
                          <span>行间距</span>
                          <select aria-label="行间距" value={props.studyLineHeight} onChange={(event) => saveLineHeight(Number(event.target.value))}>
                            {[1.2, 1.4, 1.5, 1.6, 1.8, 2].map((value) => <option key={value} value={value}>{value.toFixed(value === 2 ? 0 : 1)}</option>)}
                          </select>
                        </label>
                        <button className={props.studyTextAlign === "left" ? "active" : ""} onClick={() => saveTextAlign("left")}><AlignLeft />左对齐</button>
                        <button className={props.studyTextAlign === "center" ? "active" : ""} onClick={() => saveTextAlign("center")}><AlignCenter />居中</button>
                        <button className={props.studyChoiceLayout === "auto" ? "active" : ""} onClick={() => saveChoiceLayout("auto")}><SlidersHorizontal />自动列数</button>
                        <button className={props.studyChoiceLayout === "one" ? "active" : ""} onClick={() => saveChoiceLayout("one")}><Rows2 />一列</button>
                        <button className={props.studyChoiceLayout === "two" ? "active" : ""} onClick={() => saveChoiceLayout("two")}><Columns2 />两列</button>
                        {studyFontOptions.map((option) => <button key={option.value} className={props.studyFontFamily === option.value ? "active" : ""} onClick={() => saveFontFamily(option.value)}><Type />{option.label}</button>)}
                        <button onClick={loadFonts}>{fontLoading ? "读取字体中" : "读取系统字体"}</button>
                        {installedFonts.map((font) => <button key={font} className={props.studyFontFamily === font ? "active" : ""} style={{ fontFamily: studyFontStack(font) }} onClick={() => saveFontFamily(font)}>{font}</button>)}
                        <button className={showReferenceDock ? "active" : ""} disabled={!canToggleReferenceDock} onClick={() => setAnswerDockOpen((open) => !open)}>{answerDockOpen ? <EyeOff /> : <Eye />}{answerDockOpen ? "隐藏题目参考" : "显示题目参考"}</button>
                        {props.isSuperuser && isWordCard(card) && (
                          <button className={pronunciationXmlOpen ? "active" : ""} disabled={pronunciationXmlBusy === "load"} onClick={() => { setMoreToolsOpen(false); togglePronunciationXml(); }}><CodeXml />豆包语音设置</button>
                        )}
                      </div>
                      <small>{fontStatus}</small>
                    </div>
                  )}
                </TextToolButton>
                </div>
              </div>
            </div>
          </div>
          {props.isSuperuser && pronunciationXmlOpen && isWordCard(card) && (
            <form className="pronunciation-xml-editor" onSubmit={submitPronunciationXml}>
              <div className="pronunciation-xml-heading">
                <div>
                  <span>豆包语音设置 · {card.front}</span>
                  <small>{pronunciationXmlCustomized || pronunciationPromptCustomized ? "当前使用超级用户覆盖" : "当前使用自动生成格式与默认提示词"}</small>
                </div>
                <button className="mini-button" type="button" title="关闭豆包语音设置" onClick={() => setPronunciationXmlOpen(false)}><XCircle /></button>
              </div>
              {pronunciationXmlBusy === "load" ? (
                <p className="hint">正在读取当前 SSML 与提示词…</p>
              ) : (
                <>
                  <textarea
                    value={pronunciationXmlDraft}
                    onChange={(event) => setPronunciationXmlDraft(event.target.value)}
                    maxLength={pronunciationLimits.ssml}
                    rows={5}
                    spellCheck={false}
                    aria-label="发送给豆包的 XML"
                  />
                  <label className="pronunciation-prompt-field">
                    <span>发送给豆包语音模型的提示词</span>
                    <textarea
                      value={pronunciationPromptDraft}
                      onChange={(event) => setPronunciationPromptDraft(event.target.value)}
                      maxLength={pronunciationLimits.prompt}
                      rows={4}
                      aria-label="发送给豆包语音模型的提示词"
                    />
                    <small>{pronunciationPromptDraft.length}/{pronunciationLimits.prompt}</small>
                  </label>
                  <div className="pronunciation-xml-footer">
                    <small>SSML 或提示词修改后，保存会立即重制并播放当前单词。</small>
                    <button className="primary-button" disabled={pronunciationXmlBusy === "save" || !pronunciationXmlDraft.trim() || !pronunciationPromptDraft.trim() || (pronunciationXmlDraft.trim() === pronunciationXmlOriginal && pronunciationPromptDraft.trim() === pronunciationPromptOriginal)}>
                      <Save />{pronunciationXmlBusy === "save" ? "重制中" : "保存并替换语音"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
          {swipePreview && (
            <div className={`swipe-rating-cue ${swipePreview.rating}`} aria-live="polite">
              <RatingIcon rating={swipePreview.rating} />
              <strong>{swipePreview.rating === "unknown" ? "不会" : swipePreview.rating === "known" ? "掌握" : "模糊"}</strong>
            </div>
          )}
          <div
            className={`study-scroll ${swipePreview ? `swipe-active swipe-${swipePreview.rating}` : ""}`}
            ref={studyScrollRef}
            style={swipeStyle}
            onTouchStart={startCardSwipe}
            onTouchMove={moveCardSwipe}
            onTouchEnd={finishCardSwipe}
            onTouchCancel={cancelCardSwipe}
          >
            {editingStudyCard ? (
              <CardEditor card={editingStudyCard} onCancel={() => setEditingStudyCard(null)} onSubmit={saveStudyCard} />
            ) : (
              <>
                {card.card_type === "basic" && (
                  <div ref={answerLayoutRef} className={`answer-layout ${showBasicReferenceDock ? "with-dock" : ""}`}>
                    <button ref={(node) => { cardFrameRef.current = node; }} className={`flip-card ${flipped ? "flipped" : ""}`} onClick={flipStudyCard}>
                      <span className="flip-card-inner">
                        <span className="flip-card-face flip-card-front"><CardFront card={card} /></span>
                        <span className="flip-card-face flip-card-back"><CardBack card={card} layout={props.studyChoiceLayout} showFront /></span>
                      </span>
                    </button>
                    {narrowStudyViewport && showBasicReferenceDock && (
                      <QuestionDock
                        card={card}
                        selected=""
                        answer={card.back}
                        onResize={resizeAnswerDock}
                        onClose={() => setAnswerDockOpen(false)}
                      />
                    )}
                  </div>
                )}
                {card.card_type === "word" && (
                  <button ref={(node) => { cardFrameRef.current = node; }} className={`flip-card ${flipped ? "flipped" : ""}`} onClick={flipStudyCard}>
                    <span className="flip-card-inner">
                      <span className="flip-card-face flip-card-front"><CardFront card={card} /></span>
                      <span className="flip-card-face flip-card-back"><CardBack card={card} layout={props.studyChoiceLayout} /></span>
                    </span>
                  </button>
                )}
                {card.card_type === "choice" && (
                  <div ref={answerLayoutRef} className={`answer-layout study-question-layout ${showAnswerDock ? "with-dock" : ""}`}>
                    <div ref={(node) => { cardFrameRef.current = node; }} className={`question-box choice-question ${choiceLayoutClass(choices, props.studyChoiceLayout)}`}>
                      <MarkdownText value={card.front} className="question-text" />
                      <ChoiceArea choices={choices} answers={correctChoiceAnswers} selected={selectedChoice} checked={checked} layout={props.studyChoiceLayout} multiple={multipleChoice} onChoose={selectChoice}>
                        {multipleChoice && !checked && <button className="primary-button choice-submit-button" type="button" disabled={selectedChoice.length === 0 || Boolean(busy)} onClick={submitMultipleChoice}>提交答案</button>}
                        {checked && <AnswerFeedback checked={checked} correct={displayCorrect} explanation={explanation} other={otherNote} selected={selectedChoice.join("、")} />}
                      </ChoiceArea>
                    </div>
                    {narrowStudyViewport && showAnswerDock && (
                      <QuestionDock
                        card={card}
                        choices={choices}
                        selected={selectedChoice.join("、")}
                        selectedChoices={selectedChoice}
                        answer={card.back}
                        onResize={resizeAnswerDock}
                        onClose={() => setAnswerDockOpen(false)}
                      />
                    )}
                  </div>
                )}
                {card.card_type === "blank" && (
                  <div ref={answerLayoutRef} className={`answer-layout study-question-layout ${showAnswerDock ? "with-dock" : ""}`}>
                    <div ref={(node) => { cardFrameRef.current = node; }} className={`question-box choice-question blank-question ${choiceLayoutClass([card.front, card.example], props.studyChoiceLayout)}`}>
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
                              disabled={Boolean(busy) || checked !== null}
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
                            disabled={Boolean(busy) || checked !== null}
                          />
                        )}
                        <button className="primary-button blank-submit-button" disabled={Boolean(busy) || checked !== null || !blankAnswerReady}>{busy ? "提交中" : "提交"}</button>
                      </form>
                      {checked && <AnswerFeedback checked={checked} correct={correctAnswer(card)} explanation={explanation} other={otherNote} selected={displayedBlankAnswer} />}
                    </div>
                    {narrowStudyViewport && showAnswerDock && (
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
              </>
            )}
          </div>
          {!narrowStudyViewport && hasReferenceDock && desktopQuestionDock && createPortal(desktopQuestionDock, document.body)}
          {!editingStudyCard && showManualRatings && <div className="mobile-swipe-guide">左滑不会 · 右滑掌握 · 下滑模糊</div>}
          {ratingNotice && <RatingNotice feedback={ratingNotice} onClose={() => setRatingNotice(null)} />}
          {!editingStudyCard && showManualRatings && (
            <div className="rating-row">
              <button className="rating unknown" disabled={Boolean(busy)} onClick={() => rate("unknown")}><XCircle />{busy === "rate-unknown" ? "提交中" : "不认识"}</button>
              <button className="rating fuzzy" disabled={Boolean(busy)} onClick={() => rate("fuzzy")}><RotateCcw />{busy === "rate-fuzzy" ? "提交中" : "模糊"}</button>
              <button className="rating known" disabled={Boolean(busy)} onClick={() => rate("known")}><CheckCircle2 />{busy === "rate-known" ? "提交中" : "认识"}</button>
            </div>
          )}
          {roundResetOpen && (
            <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) setRoundResetOpen(false);
            }}>
              <section className="modal-panel study-round-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="study-round-reset-title">
                <div className="modal-title"><h2 id="study-round-reset-title"><AlertTriangle />重置本轮学习数量</h2></div>
                <p className="hint">当前本轮学习数量为 {roundStudyWords}。是否重置为 0？</p>
                <div className="rating-row">
                  <button type="button" className="primary-button secondary-button" onClick={() => setRoundResetOpen(false)}>取消</button>
                  <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={resetRoundStudyWords}>确认重置</button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RatingIcon(props: { rating: ReviewRating }) {
  if (props.rating === "known") return <CheckCircle2 />;
  if (props.rating === "fuzzy") return <RotateCcw />;
  return <XCircle />;
}

function RatingCelebration(props: { feedback: RatingFeedback }) {
  return (
    <div className={`rating-celebration ${props.feedback.rating}`} key={props.feedback.key} aria-live="polite">
      <span className="rating-celebration-ring" />
      <span className="rating-celebration-badge">
        <RatingIcon rating={props.feedback.rating} />
        <strong>{props.feedback.title}</strong>
      </span>
      {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
    </div>
  );
}

function RatingNotice(props: { feedback: RatingFeedback; onClose: () => void }) {
  return (
    <button className={`rating-toast ${props.feedback.rating}`} onClick={props.onClose}>
      <RatingIcon rating={props.feedback.rating} />
      <span>
        <strong>{props.feedback.title}</strong>
        <small>{props.feedback.stageText} · {props.feedback.dueText}</small>
      </span>
    </button>
  );
}

function QuestionDock(props: { card: Card; choices?: string[]; selected: string; selectedChoices?: string[]; answer: string; onResize: (event: ReactPointerEvent<HTMLButtonElement>) => void; onClose: () => void; style?: CSSProperties }) {
  return (
    <aside className={`question-dock ${props.card.card_type}-question-dock`} aria-label="题目参考" style={props.style}>
      <button className="question-dock-resizer" type="button" aria-label="调整题目参考宽度" onPointerDown={props.onResize} />
      <div className="question-dock-title">
        <span>题目参考</span>
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
              <div key={`${choice}-${index}`} className={splitChoiceAnswers(props.answer).some((answer) => answersMatch(choice, answer)) ? "correct" : (props.selectedChoices ?? []).some((selected) => answersMatch(choice, selected)) ? "selected" : ""}>
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

function StudyComplete(props: { total: number; completed: number; onRestart: () => void; onRest?: () => void; onUndo?: () => void; restartLabel?: string; busy: boolean }) {
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
      <div className="study-complete-actions">
        {props.onUndo && <button className="primary-button secondary-button" disabled={props.busy} onClick={props.onUndo}><ArrowLeft />返回最后一张卡片</button>}
        <button className="primary-button" disabled={props.busy} onClick={props.onRestart}><Sparkles />{props.busy ? "载入中" : props.restartLabel ?? "再来一轮"}</button>
        {props.onRest && <button className="primary-button secondary-button" disabled={props.busy} onClick={props.onRest}>休息一下</button>}
      </div>
    </section>
  );
}

function CardFront(props: { card: Card }) {
  if (props.card.card_type === "blank") return <MarkdownText value={props.card.front} renderBlank={(key) => <span key={key} className="blank-dock-gap" />} />;
  if (props.card.card_type === "choice") return <MarkdownText value={props.card.front} />;
  if (!isWordCard(props.card)) return <span className="basic-face"><MarkdownText value={props.card.front} /></span>;
  const phrase = isPhrasePartOfSpeech(props.card.back);
  return <span className={`word-face ${phrase ? "phrase-face" : ""}`}><span className="word-text"><MarkdownText value={props.card.front} /></span>{props.card.phonetic && <em>{props.card.phonetic}</em>}</span>;
}

function CardBack(props: { card: Card; layout: Settings["studyChoiceLayout"]; showFront?: boolean }) {
  if (!isWordCard(props.card)) {
    return (
      <span className={`basic-back ${props.layout === "two" ? "two-column-back" : ""}`}>
        {props.showFront && <span className="basic-face"><MarkdownText value={props.card.front} /></span>}
        <span className="basic-answer"><MarkdownText value={props.card.back} /></span>
        {props.card.example && <small><MarkdownText value={props.card.example} /></small>}
        <LabeledMarkdown label="备注" value={props.card.note} />
      </span>
    );
  }
  return (
    <span className={`word-back ${isPhrasePartOfSpeech(props.card.back) ? "phrase-back" : ""}`}>
      <span className="word-text"><MarkdownText value={props.card.front} /></span>
      {props.card.phonetic && <em>{props.card.phonetic}</em>}
      <span className="word-meaning"><MarkdownText value={props.card.back} /></span>
      {props.card.example && <small><MarkdownText value={props.card.example} /></small>}
      <LabeledMarkdown label="助记" value={props.card.mnemonic} />
      <LabeledMarkdown label="备注" value={props.card.note} />
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
  answers: string[];
  selected: string[];
  checked: "right" | "wrong" | null;
  layout: Settings["studyChoiceLayout"];
  multiple: boolean;
  onChoose: (choice: string) => void;
  children: ReactNode;
}) {
  const layoutClass = choiceLayoutClass(props.choices, props.layout);
  return (
    <div className={`choice-area ${layoutClass}`}>
      <div className={`choice-grid ${layoutClass}`}>
        {props.choices.map((choice, index) => {
          const isSelected = props.selected.some((selected) => answersMatch(choice, selected));
          const isAnswer = props.answers.some((answer) => answersMatch(choice, answer));
          const state = props.checked ? (isAnswer ? "correct" : isSelected ? "wrong" : "") : isSelected ? "selected" : undefined;
          return (
            <button
              className={state}
              type="button"
              disabled={props.checked !== null}
              key={`${choice}-${index}`}
              onClick={() => props.onChoose(choice)}
              aria-pressed={props.multiple ? isSelected : undefined}
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
  const [text, setText] = useState("card_type,front,answer1,answer1_alt1,answer1_alt2,answer2,answer2_alt1,answer2_alt2,blank_orderless,example,note\nblank,I eat [] every day.,apple,an apple,apples,,,,false,填写空格中的单词,\nblank,[] and [] are colours.,red,red colour,,blue,blue colour,,true,两个颜色可交换位置,");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [undoingBatchId, setUndoingBatchId] = useState("");
  const [recentImports, setRecentImports] = useState<ImportBatch[]>([]);

  async function loadRecentImports() {
    setRecentImports(await api.recentImports());
  }

  useEffect(() => {
    loadRecentImports().catch((error) => props.onError((error as Error).message));
  }, []);

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
      await loadRecentImports();
    } catch (error) {
      props.onError((error as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function undoImport(batch: ImportBatch) {
    if (batch.undone_at || undoingBatchId) return;
    setUndoingBatchId(batch.id);
    try {
      const result = await api.undoImport(batch.id);
      await props.onImported(`已撤销最近导入，删除 ${result.deleted} 张卡片`);
      await loadRecentImports();
    } catch (error) {
      props.onError((error as Error).message);
    } finally {
      setUndoingBatchId("");
    }
  }

  const templates = ["普通卡导入模板.xlsx", "单词卡导入模板.xlsx", "选择题卡导入模板.xlsx", "填空题卡导入模板.xlsx"];

  return (
    <section className="panel import-panel">
      <form className="import-form" onSubmit={submit}>
        <label>目标卡组<select value={props.selectedDeckId ?? ""} onChange={(event) => props.onSelectDeck(Number(event.target.value))}><option value="" disabled>选择卡组</option>{props.decks.map((deck) => <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>)}</select></label>
        <div className="template-links" aria-label="导入模板">
          {templates.map((name) => <a key={name} href={`/api/templates/${encodeURIComponent(name)}`} download>{name.replace("导入模板.xlsx", "")}</a>)}
        </div>
        <label>上传 CSV/TSV/XLSX<input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>或粘贴表格<textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} /></label>
        <p className="hint">可自动识别题型：填空题用 answer1、answer1_alt1、answer2 等列表示各空与备选答案，blank_orderless 控制是否乱序；旧 back 列仍可继续导入。</p>
        <button className="primary-button" disabled={importing || !props.selectedDeckId}><FileSpreadsheet />{importing ? "导入中" : "开始导入"}</button>
      </form>
      <section className="recent-imports" aria-label="最近导入">
        <div className="section-heading">
          <div>
            <p className="eyebrow">最近导入</p>
            <h2>可撤销的导入批次</h2>
          </div>
          <button className="mini-button" title="刷新最近导入" type="button" onClick={() => loadRecentImports().catch((error) => props.onError((error as Error).message))}><RefreshCw /></button>
        </div>
        {recentImports.length === 0 ? (
          <EmptyState text="暂无最近导入。" />
        ) : (
          <div className="recent-import-list">
            {recentImports.map((batch) => (
              <div className={`recent-import-row ${batch.undone_at ? "undone" : ""}`} key={batch.id}>
                <div>
                  <strong>{batch.deck_name}</strong>
                  <span>{fullDateTime(batch.created_at)} · {batch.source || "导入"} · 导入 {batch.imported} 张，跳过 {batch.skipped} 行</span>
                </div>
                <span className="type-pill">{batch.undone_at ? "已撤销" : "可撤销"}</span>
                <button className="primary-button secondary-button" type="button" disabled={Boolean(batch.undone_at) || Boolean(undoingBatchId)} onClick={() => undoImport(batch)}>
                  <RotateCcw />{undoingBatchId === batch.id ? "撤销中" : "撤销"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function SettingsView(props: { settings: Settings; onThemeChange: (theme: ThemeMode) => Promise<void>; onSave: (settings: Partial<Settings>) => Promise<void>; onNotify: () => Promise<void>; onExportStudyRecord: (date: string) => Promise<void>; onExportLogs: () => Promise<void>; saving: boolean; notifying: boolean; exportingStudyRecord: boolean; exportingLogs: boolean }) {
  const [draft, setDraft] = useState<Settings>(props.settings);
  const [studyExportOpen, setStudyExportOpen] = useState(false);
  const [studyExportDate, setStudyExportDate] = useState(() => shanghaiDateKey(-1));
  const studyExportMax = shanghaiDateKey();
  const studyExportMin = shanghaiDateKey(-13);

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
      <label>自动发音<select value={draft.autoSpeak} onChange={(event) => updateDraft({ autoSpeak: event.target.value as Settings["autoSpeak"] })}><option value="off">关闭</option><option value="on">开启</option></select></label>
      <label>每日目标（单词）<input type="number" min={1} value={draft.dailyWordGoal} onChange={(event) => updateDraft({ dailyWordGoal: Number(event.target.value) })} /></label>
      <div className="settings-actions">
        <button className="primary-button" disabled={props.saving}><Save />{props.saving ? "保存中" : "保存设置"}</button>
        <button className="primary-button secondary-button" type="button" disabled={props.notifying} onClick={props.onNotify}><Bell />{props.notifying ? "授权中" : "开启浏览器通知"}</button>
        <button className="primary-button secondary-button" type="button" aria-expanded={studyExportOpen} onClick={() => setStudyExportOpen((open) => !open)}><Download />导出学习记录</button>
        <button className="primary-button secondary-button" type="button" disabled={props.exportingLogs} onClick={props.onExportLogs}><Download />{props.exportingLogs ? "导出中" : "导出最近日志"}</button>
      </div>
      {studyExportOpen && (
        <div className="study-export-box">
          <div>
            <strong>导出学习记录</strong>
            <p>选择最近 14 天内的日期，默认前一天。Markdown 将记录题目正反面、所属文件夹和逐次学习情况。</p>
          </div>
          <label>导出日期<input type="date" min={studyExportMin} max={studyExportMax} value={studyExportDate} onChange={(event) => setStudyExportDate(event.target.value)} /></label>
          <button className="primary-button" type="button" disabled={props.exportingStudyRecord || !studyExportDate} onClick={() => props.onExportStudyRecord(studyExportDate)}><Download />{props.exportingStudyRecord ? "导出中" : "下载 Markdown"}</button>
        </div>
      )}
      <div className="schedule-box"><h3>艾宾浩斯间隔</h3><p>5 分钟 · 30 分钟 · 12 小时 · 1 天 · 2 天 · 4 天 · 7 天 · 15 天 · 30 天 · 90 天</p></div>
    </form>
  );
}

function AboutView(props: { syncStatus: SyncStatus | null }) {
  return (
    <section className="panel about-panel">
      <div className="about-title"><Info /><div><p className="eyebrow">闪记</p><h2>版本 {version}</h2></div></div>
      <div className="schedule-box"><h3>同步状态</h3><p>最近同步：{props.syncStatus ? fullDateTime(props.syncStatus.lastSyncAt) : "暂无"} · 数据更新：{props.syncStatus?.dataUpdatedAt ? fullDateTime(props.syncStatus.dataUpdatedAt) : "暂无"}</p></div>
      <div className="schedule-box changelog-box">
        <h3>更新日志</h3>
        <div className="changelog-row"><strong>0.9.11</strong><span>2026-08-05</span><p>修复全屏学习时左侧卡片与题目参考的底边错位；恢复单词卡中文释义的手动换行显示。</p></div>
        <div className="changelog-row"><strong>0.9.10</strong><span>2026-08-04</span><p>番茄钟进度改为逐边精确绘制：倒计时从左上角起笔，依次经过右上、右下、左下，结束时闭合一整圈。</p></div>
        <div className="changelog-row"><strong>0.9.9</strong><span>2026-08-04</span><p>修复学习页题目参考遮住更多学习工具、填空题无法输入及选择/填空长内容顶部裁切；全屏时卡片与题目参考底边对齐，番茄钟进度按左上→右上→右下→左下连续环绕。</p></div>
        <div className="changelog-row"><strong>0.9.8</strong><span>2026-08-04</span><p>修复嵌套 equation/split LaTeX 公式保存后显示异常；题目参考打开时更多学习工具保持在最上层，并支持点击菜单外自动收起。</p></div>
        <div className="changelog-row"><strong>0.9.7</strong><span>2026-08-01</span><p>卡片所有内容展示统一支持 CommonMark、GFM 与 LaTeX；标题、引用、列表、链接、表格、任务项、代码块和公式在学习页、题目参考、预览与列表中一致显示。</p></div>
        <div className="changelog-row"><strong>0.9.6</strong><span>2026-08-01</span><p>删除普通卡出现 LaTeX 公式时自动缩小题面字体的规则；公式与普通文字保持相同字号。</p></div>
        <div className="changelog-row"><strong>0.9.5</strong><span>2026-08-01</span><p>学习页“更多学习工具”下拉菜单现始终显示在题目参考之上，不再被遮住。</p></div>
        <div className="changelog-row"><strong>0.9.4</strong><span>2026-08-01</span><p>题目参考固定在学习窗口右侧并保持恒定高度；长内容仅在题目参考内部滚动，不再跟随学习页滚动。</p></div>
        <div className="changelog-row"><strong>0.9.3</strong><span>2026-08-01</span><p>选择题和填空题在小字号下会填满学习区域；三类题面缩小至当前字号的 65%；题目参考随内容自适应高度；修复答案含逗号时误判为多选题。</p></div>
        <div className="changelog-row"><strong>0.9.2</strong><span>2026-08-01</span><p>题目参考的显示状态会持续保留；全屏和普通窗口中均与学习卡片主体上下对齐。</p></div>
        <div className="changelog-row"><strong>0.9.1</strong><span>2026-07-31</span><p>选择题答案输入多个选项时自动成为多选题；需选中全部且仅选中正确选项后提交，才会判定正确。</p></div>
        <div className="changelog-row"><strong>0.8.18</strong><span>2026-07-31</span><p>普通卡正面或反面含 LaTeX 公式时，正面及翻面后的题目文字会显示为正文的约 115%。</p></div>
        <div className="changelog-row"><strong>0.8.17</strong><span>2026-07-31</span><p>普通卡正面及翻面后的题目文字字号改为与短语型单词卡一致。</p></div>
        <div className="changelog-row"><strong>0.8.16</strong><span>2026-07-30</span><p>全站加粗文字调整为 650 字重，以提升阅读清晰度。</p></div>
        <div className="changelog-row"><strong>0.8.15</strong><span>2026-07-30</span><p>全站加粗文字统一调整为 520 字重；普通卡正面内容字号调整为 54px。</p></div>
        <div className="changelog-row"><strong>0.8.14</strong><span>2026-07-30</span><p>修复学习页题目参考在长内容滚动后会离开右上角的问题；现在会始终固定在学习滚动区域右上方。</p></div>
        <div className="changelog-row"><strong>0.8.13</strong><span>2026-07-29</span><p>学习页会自动识别卡片中的 LaTeX 公式，并在不改变右上角行距设置显示值的前提下，将整张学习卡的实际正文行距增加 0.5。</p></div>
        <div className="changelog-row"><strong>0.8.12</strong><span>2026-07-29</span><p>题目参考统一正文与 LaTeX 字号并取消题干加粗；普通卡翻面和填空题答题后均保留题目在顶部；新增卡片暂停/启动、已暂停卡筛选与一键选中，暂停卡不会进入学习或复习序列。</p></div>
        <div className="changelog-row"><strong>0.8.11</strong><span>2026-07-28</span><p>LaTeX 公式字号略小于正文；卡片全部内容（含普通卡说明、备注与选项）统一支持 Markdown 和图片；每组学习完成页现在填满可视区域。</p></div>
        <div className="changelog-row"><strong>0.8.10</strong><span>2026-07-26</span><p>修复进入学习界面时可能显示空白页的问题。</p></div>
        <div className="changelog-row"><strong>0.8.9</strong><span>2026-07-26</span><p>完成页“返回最后一个单词”更正为“返回最后一张卡片”；短语词性单词卡正反面标题字号统一缩小；普通、填空和选择题的题目参考字号、间距及答题提示对齐同步优化。</p></div>
        <div className="changelog-row"><strong>0.8.8</strong><span>2026-07-24</span><p>单词卡页宽100%现在完全占满横屏页面；无尽模式一组完成后若还有可练习卡片则不退出全屏。</p></div>
        <div className="changelog-row"><strong>0.8.7</strong><span>2026-07-23</span><p>一组完成后新增"返回最后一个单词"按钮（左方向键可触发）；休息一下和全部学完自动退出全屏并同步；学习模式和复习模式也显示本轮学习数量胶囊；移除胶囊在卡片切换时的变暗动效；修复页宽75%以上不起效的问题。</p></div>
        <div className="changelog-row"><strong>0.8.6</strong><span>2026-07-23</span><p>学习页宽仅调整卡片内文字的左右留白与显示宽度，保持卡片外框不变；修复手动重置本轮学习数量后，下一次作答又写回旧数值的问题。</p></div>
        <div className="changelog-row"><strong>0.8.5</strong><span>2026-07-22</span><p>学习卡片更多选项新增百分比页宽；修复填空题提交后数字评分键重新进入填写状态，以及含 LaTeX 分数的普通卡题面行间距不明显的问题。</p></div>
        <div className="changelog-row"><strong>0.8.4</strong><span>2026-07-22</span><p>修复单词卡正面行间距不生效的问题；短语词性卡片会适当缩小正面文字；本轮学习数量仅在点击胶囊并确认后重置，且会跨刷新保留。</p></div>
        <div className="changelog-row"><strong>0.8.3</strong><span>2026-07-22</span><p>学习记录 Markdown 聚焦题目与学习情况：仅保留正面、反面、大文件夹与子文件夹、新学/复习次数、每次选择及结束阶段。</p></div>
        <div className="changelog-row"><strong>0.8.2</strong><span>2026-07-22</span><p>修复宽屏上单词卡例句提前换行、右侧留下大块空白的问题，例句现在会使用单词卡的完整内容宽度。</p></div>
        <div className="changelog-row"><strong>0.8.1</strong><span>2026-07-22</span><p>设置页新增学习记录导出：可选择最近 14 天内的单日，默认前一天，并以 Markdown 保存题目详情、新学与复习次数、每次选择及结束后的阶段。</p></div>
        <div className="changelog-row"><strong>0.7.5</strong><span>2026-07-21</span><p>无尽模式的本轮学习数量会跨组持续累计；点击“继续下一组”不再清零，只有选择“休息一下”才会重置。</p></div>
        <div className="changelog-row"><strong>0.7.4</strong><span>2026-07-21</span><p>无尽模式新增本轮学习数量胶囊；每日学习数量改为按每次作答累计，新学首次计 5、之后每次复习计 1。</p></div>
        <div className="changelog-row"><strong>0.7.3</strong><span>2026-07-21</span><p>修复单词卡在全屏学习中翻到背面后，卡面未填满可用高度、底部出现空白的问题。</p></div>
        <div className="changelog-row"><strong>0.7.2</strong><span>2026-07-18</span><p>学习设置中的字体大小和行间距改为下拉选择；单词卡大字号时会同步拓宽正文区域、缩小左右留白，并修复背面底部内容与卡片边界重叠。</p></div>
        <div className="changelog-row"><strong>0.7.1</strong><span>2026-07-17</span><p>卡组与首页卡片摘要完整支持 Markdown；普通卡翻面后支持在右侧显示题目参考；统一普通卡正面文字与 LaTeX 字号，并修复长内容顶部裁切和底部布局溢出。</p></div>
        <div className="changelog-row"><strong>0.7.0</strong><span>2026-07-17</span><p>学习页新增 50% 和 62.5% 字号；卡组卡片改为 14px，并支持按加入、到期、最新学习时间正倒序排列；桌面导航默认收起、靠近左侧弹出；连续新建卡片不再返回卡组。</p></div>
        <div className="changelog-row"><strong>0.6.9</strong><span>2026-07-17</span><p>块级 LaTeX 多行公式内部改为 1.5 倍行距，提升连续推导的可读性。</p></div>
        <div className="changelog-row"><strong>0.6.8</strong><span>2026-07-17</span><p>豆包默认 SSML 改为仅包含英文单词，音标改由英式发音提示词传入；现有语音缓存继续直接使用，不重制或覆盖。</p></div>
        <div className="changelog-row"><strong>0.6.7</strong><span>2026-07-17</span><p>学习模式支持数字键 1/不会、2/模糊、3/掌握；“切换到前一张”移至右上角，豆包语音设置收入“更多”。</p></div>
        <div className="changelog-row"><strong>0.6.6</strong><span>2026-07-16</span><p>修复新卡先选择“模糊”、同轮再选择“掌握”后仍保留约 30 分钟排程的问题；首次掌握会正确回到第 1 阶段短间隔。</p></div>
        <div className="changelog-row"><strong>0.6.5</strong><span>2026-07-16</span><p>卡组管理改用独立的新建卡片页面，缩略卡片支持 LaTeX 渲染；图片可从本地安全上传到云端，公式间距同步学习行距。</p></div>
        <div className="changelog-row"><strong>0.6.4</strong><span>2026-07-16</span><p>填空题编辑器支持每空独立配置多个正确答案，新增严格一一配对的乱序填空，并同步升级批量导入格式与模板。</p></div>
        <div className="changelog-row"><strong>0.6.3</strong><span>2026-07-16</span><p>手机学习卡片支持左滑不会、右滑掌握、下滑模糊，并为超级用户增加逐词编辑豆包语音模型提示词的能力。</p></div>
        <div className="changelog-row"><strong>0.6.2</strong><span>2026-07-15</span><p>解析、说明和例句字段新增图片插入入口，支持在正文光标位置插入多张图片。</p></div>
        <div className="changelog-row"><strong>0.6.1</strong><span>2026-07-15</span><p>为手机端重新设计六入口底部导航，修复侧栏占满整屏导致无法操作的问题，并逐页优化顶部操作、卡组、学习、导入、设置与关于页的窄屏布局。</p></div>
        <div className="changelog-row"><strong>0.5.9</strong><span>2026-07-15</span><p>仅为 Xian 增加超级用户权限；可在学习页逐词编辑豆包 XML，保留原有模型提示词，并在提交后重新合成、替换语音缓存。</p></div>
        <div className="changelog-row"><strong>0.5.8</strong><span>2026-07-10</span><p>按番茄信息区域的真实尺寸计算进度环周长，修正不同宽度下进度与边框不一致的问题。</p></div>
        <div className="changelog-row"><strong>0.5.7</strong><span>2026-07-10</span><p>将番茄进度环改为连续绘制的单段轨迹，避免圆角边框被拆成多段线条。</p></div>
        <div className="changelog-row"><strong>0.5.6</strong><span>2026-07-10</span><p>移除番茄进度环末端多余线段和视觉空隙，使进度边框干净闭合。</p></div>
        <div className="changelog-row"><strong>0.5.5</strong><span>2026-07-10</span><p>番茄进度环统一从信息区域左上角开始绘制，保证倒计时方向稳定。</p></div>
        <div className="changelog-row"><strong>0.5.4</strong><span>2026-07-10</span><p>使用细橙色进度环包围番茄钟、番茄数量和当前任务信息。</p></div>
        <div className="changelog-row"><strong>0.5.3</strong><span>2026-07-10</span><p>学习页番茄信息增加随倒计时推进的可视化进度。</p></div>
        <div className="changelog-row"><strong>0.5.2</strong><span>2026-07-10</span><p>压缩学习卡片顶部进度、状态和操作区域，减少无效留白并突出当前信息。</p></div>
        <div className="changelog-row"><strong>0.5.1</strong><span>2026-07-10</span><p>学习卡片顶部接入番茄基地状态，显示当前倒计时、番茄数量和任务名称。</p></div>
        <div className="changelog-row"><strong>0.4.11</strong><span>2026-07-10</span><p>死学模式更名为无尽模式；每日打卡改为词数目标，新学计 5、复习计 1，并使用学习页统一进度条。</p></div>
        <div className="changelog-row"><strong>0.4.10</strong><span>2026-07-10</span><p>学习字号现覆盖助记、备注、反馈和题目参考；死学休息可靠退出全屏，并彻底隐藏卡片翻页滚动条。</p></div>
        <div className="changelog-row"><strong>0.4.9</strong><span>2026-07-08</span><p>学习页新增快捷键、居中评级特效、隐藏翻页滚动条和全屏休息退出；编辑字段样式统一，并为导入增加最近导入撤销。</p></div>
        <div className="changelog-row"><strong>0.4.8</strong><span>2026-07-08</span><p>修复学习页编辑字段提示、布局和显示范围；卡片详情改为全屏学习预览；沉浸学习隐藏备案号，并收敛网页加粗使用。</p></div>
        <div className="changelog-row"><strong>0.4.7</strong><span>2026-07-05</span><p>线上英式朗读支持英文短语类单词卡，不再因空格直接回退到浏览器朗读。</p></div>
        <div className="changelog-row"><strong>0.4.6</strong><span>2026-07-05</span><p>卡片类型改为编辑时手动选择并随卡片保存；单词卡不再依赖例句判定，导入空例句不会被其他列补填，助记展示不再加粗，反面会显示备注。</p></div>
        <div className="changelog-row"><strong>0.4.5</strong><span>2026-07-05</span><p>修复死学模式到期复习卡插队后的本组数量、旧卡 practice 后反复插队、学习反馈提示与卡片右下角对齐，并在设置中增加导出最近日志。</p></div>
        <div className="changelog-row"><strong>0.4.4</strong><span>2026-07-05</span><p>学习反馈提示改到卡片内，死学模式组间停留等待选择，关于页同步状态上移，并为手动同步增加成功提示。</p></div>
        <div className="changelog-row"><strong>0.4.3</strong><span>2026-07-05</span><p>学习过程中显示当前卡片的长期复习阶段和对应复习间隔，方便判断下一次复习节奏。</p></div>
        <div className="changelog-row"><strong>0.4.2</strong><span>2026-07-05</span><p>增强 Markdown 中 LaTeX 公式渲染；普通卡恢复正常字号，翻面后保留正面并在下方显示答案，正面加粗且答案不加粗。</p></div>
        <div className="changelog-row"><strong>0.3.12</strong><span>2026-07-04</span><p>修正线上音色与模型配置，避免合成失败后回退到浏览器女声。</p></div>
        <div className="changelog-row"><strong>0.3.11</strong><span>2026-07-04</span><p>英语单词发音切换为服务端音频生成，并清理旧音色缓存后重新生成。</p></div>
        <div className="changelog-row"><strong>0.3.10</strong><span>2026-07-04</span><p>英语单词发音改为优先调用服务端英式男声音色，并按模型和音色在后端缓存生成音频。</p></div>
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
    </section>
  );
}

function CardPreview(props: { card: Card; onClose: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const choices = parseChoices(props.card.choices);
  const layout = choiceLayoutClass(props.card.card_type === "choice" ? choices : [props.card.front, props.card.example], "auto");
  return (
    <div className="card-preview-overlay">
      <section className="study-panel card-preview-panel align-center">
        <div className="study-fixed-top">
          <div className="study-actions preview-actions">
            <span className="type-pill">{cardTypeLabels[props.card.card_type]}</span>
            <span className="type-pill">阶段 {props.card.stage}/10</span>
            <span className="type-pill">下次 {dueText(props.card.due_at)}</span>
            <button className="mini-button" title="关闭预览" onClick={props.onClose}><XCircle /></button>
          </div>
        </div>
        <div className="study-scroll card-preview-scroll">
          {(props.card.card_type === "basic" || props.card.card_type === "word") && (
            <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)}>
              <span className="flip-card-inner">
                <span className="flip-card-face flip-card-front"><CardFront card={props.card} /></span>
                <span className="flip-card-face flip-card-back"><CardBack card={props.card} layout="auto" showFront={props.card.card_type === "basic"} /></span>
              </span>
            </button>
          )}
          {props.card.card_type === "choice" && (
            <div className={`question-box choice-question ${layout}`}>
              <MarkdownText value={props.card.front} className="question-text" />
              <div className={`choice-area ${layout}`}>
                <div className={`choice-grid ${layout}`}>
                  {choices.map((choice, index) => (
                    <div key={`${choice}-${index}`} className={splitChoiceAnswers(props.card.back).some((answer) => answersMatch(choice, answer)) ? "preview-option correct" : "preview-option"}>
                      <MarkdownText value={choice} />
                    </div>
                  ))}
                </div>
                <AnswerFeedback checked="right" correct={props.card.back} explanation={props.card.example} other={props.card.note} selected="" />
              </div>
            </div>
          )}
          {props.card.card_type === "blank" && (
            <div className={`question-box choice-question blank-question ${layout}`}>
              <MarkdownText
                value={props.card.front}
                className="question-text blank-question-text"
                renderBlank={(key) => <span key={key} className="blank-dock-gap" />}
              />
              <AnswerFeedback checked="right" correct={correctAnswer(props.card)} explanation={props.card.example} other={props.card.note} selected="" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
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
