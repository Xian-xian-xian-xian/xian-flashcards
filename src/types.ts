export type ReviewRating = "known" | "fuzzy" | "unknown";
export type ThemeMode = "system" | "light" | "dark";
export type CardType = "basic" | "word" | "choice" | "blank";

export type BlankAnswerConfig = {
  version: 1;
  orderless: boolean;
  answers: string[][];
};

export type Deck = {
  id: number;
  parent_id: number | null;
  depth: number;
  name: string;
  description: string;
  language: string;
  daily_goal: number;
  reminder_time: string;
  card_count: number;
  total_card_count: number;
  due_count: number;
  child_count: number;
};

export type Card = {
  id: number;
  deck_id: number;
  card_type: CardType;
  front: string;
  back: string;
  phonetic: string;
  example: string;
  mnemonic: string;
  note: string;
  choices: string;
  favorite: number;
  created_at: string;
  updated_at: string;
  stage: number;
  due_at: string;
  last_studied_at?: string;
  last_rating: string;
  known_count?: number;
  fuzzy_count?: number;
  unknown_count?: number;
  language?: string;
};

export type ReviewSnapshot = {
  stage: number;
  due_at: string;
  last_rating: string;
  known_count: number;
  fuzzy_count: number;
  unknown_count: number;
  updated_at: string;
  dailyTaskPrevious?: DailyTaskSnapshot;
};

export type Stats = {
  total_cards: number;
  mastered_cards: number;
  due_cards: number;
};

export type ReviewRemaining = {
  newRemaining: number;
  reviewRemaining: number;
};

export type Settings = {
  theme: ThemeMode;
  notifications: "on" | "off";
  autoSpeak: "on" | "off";
  dailyWordGoal: number;
  studyTextScale: number;
  studyTextAlign: "center" | "left";
  studyChoiceLayout: "auto" | "one" | "two";
  studyLineHeight: number;
  studyFontFamily: string;
};

export type User = {
  id: number;
  username: string;
  isSuperuser: boolean;
};

export type DailyTask = {
  date: string;
  daily_word_goal: number;
  progress_words: number;
  new_completed: number;
  new_mastered: number;
  review_total: number;
  review_completed: number;
  review_mastered: number;
  completed: boolean;
  completed_at: string;
  streak: number;
};

export type DailyTaskSnapshot = {
  new_card_ids: string;
  new_mastered_card_ids: string;
  review_mastered_card_ids: string;
  new_study_count: number;
  review_study_count: number;
  completed_at: string;
};

export type SyncStatus = {
  serverTime: string;
  lastSyncAt: string;
  dataUpdatedAt: string;
};

export type ActivePomodoro = {
  no?: number;
  taskGoal?: string;
  durationSeconds?: number;
  breakDurationSeconds?: number;
  remainingSeconds?: number;
  status?: "running" | "paused" | "awaitingSubmission";
  phase?: "focus" | "break" | "complete";
  endAt?: string | null;
};

export type TomatoState = {
  activePomodoro?: ActivePomodoro | null;
};

export type ImportBatch = {
  id: string;
  deck_id: number;
  deck_name: string;
  imported: number;
  skipped: number;
  source: string;
  created_at: string;
  undone_at: string;
};
