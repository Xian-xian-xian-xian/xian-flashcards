export type ReviewRating = "known" | "fuzzy" | "unknown";
export type ThemeMode = "system" | "light" | "dark";
export type CardType = "basic" | "word";

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
  favorite: number;
  stage: number;
  due_at: string;
  last_rating: string;
  language?: string;
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
};
