export type ReviewRating = "known" | "fuzzy" | "unknown";
export type ThemeMode = "system" | "light" | "dark";
export type CardType = "basic" | "word" | "choice" | "blank";

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
};

export type Stats = {
  total_cards: number;
  mastered_cards: number;
  due_cards: number;
};

export type Settings = {
  theme: ThemeMode;
  voiceLanguage: string;
  notifications: "on" | "off";
  autoSpeak: "on" | "off";
  dailyNewGoal: number;
  studyTextScale: number;
  studyTextAlign: "center" | "left";
};

export type User = {
  id: number;
  username: string;
};

export type DailyTask = {
  date: string;
  daily_new_goal: number;
  new_completed: number;
  review_total: number;
  review_completed: number;
  completed: boolean;
  completed_at: string;
  streak: number;
};

export type SyncStatus = {
  serverTime: string;
  lastSyncAt: string;
  dataUpdatedAt: string;
};
