import {
  Bell,
  BookOpen,
  Brain,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  FolderPlus,
  Headphones,
  Home,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Volume2,
  XCircle
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Card, Deck, ReviewRating, Settings, Stats, ThemeMode } from "./types";

type View = "home" | "deck" | "study" | "import" | "settings";
type StudyMode = "flashcards" | "learn" | "test" | "write" | "listen" | "match";

const modeLabels: Record<StudyMode, string> = {
  flashcards: "闪记卡",
  learn: "学习",
  test: "测试",
  write: "默写",
  listen: "听写",
  match: "配对"
};

const ratingLabels: Record<ReviewRating, string> = {
  known: "认识",
  fuzzy: "模糊",
  unknown: "不认识"
};

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dueText(value: string) {
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return "现在到期";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [stats, setStats] = useState<Stats>({ total_cards: 0, mastered_cards: 0, due_cards: 0 });
  const [settings, setSettings] = useState<Settings>({
    theme: "system",
    voiceLanguage: "en-US",
    notifications: "off"
  });
  const [studyMode, setStudyMode] = useState<StudyMode>("flashcards");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];
  const filteredCards = useMemo(() => {
    const query = normalizeAnswer(search);
    return cards.filter((card) => {
      if (!query) return true;
      return normalizeAnswer(`${card.front} ${card.back} ${card.example} ${card.note}`).includes(query);
    });
  }, [cards, search]);

  async function refresh() {
    const [nextDecks, nextStats, nextSettings, nextDueCards] = await Promise.all([
      api.decks(),
      api.stats(),
      api.settings(),
      api.dueCards(undefined, 30)
    ]);
    setDecks(nextDecks);
    setStats(nextStats);
    setSettings(nextSettings);
    setDueCards(nextDueCards);
    applyTheme(nextSettings.theme);
    setSelectedDeckId((current) => current && nextDecks.some((deck) => deck.id === current) ? current : nextDecks[0]?.id ?? null);
  }

  async function loadCards(deckId: number) {
    setCards(await api.cards(deckId));
  }

  useEffect(() => {
    refresh().catch((error) => setToast(error.message));
  }, []);

  useEffect(() => {
    if (selectedDeckId) loadCards(selectedDeckId).catch((error) => setToast(error.message));
  }, [selectedDeckId]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    if (settings.notifications !== "on" || dueCards.length === 0 || Notification.permission !== "granted") return;
    const timer = window.setTimeout(() => {
      new Notification("该复习啦", {
        body: `现在有 ${dueCards.length} 张卡片到期。`,
        icon: "/vite.svg"
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dueCards.length, settings.notifications]);

  function speak(text: string, language?: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language ?? selectedDeck?.language ?? settings.voiceLanguage;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function handleAnswer(card: Card, rating: ReviewRating) {
    await api.answer(card.id, rating);
    setToast(`${card.front}：${ratingLabels[rating]}`);
    await Promise.all([selectedDeckId ? loadCards(selectedDeckId) : Promise.resolve(), refresh()]);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark">X</span>
          <span>Xian 闪记卡</span>
        </div>
        <NavButton icon={<Home />} label="首页" active={view === "home"} onClick={() => setView("home")} />
        <NavButton icon={<BookOpen />} label="卡组" active={view === "deck"} onClick={() => setView("deck")} />
        <NavButton icon={<Brain />} label="学习" active={view === "study"} onClick={() => setView("study")} />
        <NavButton icon={<FileSpreadsheet />} label="导入" active={view === "import"} onClick={() => setView("import")} />
        <NavButton icon={<SettingsIcon />} label="设置" active={view === "settings"} onClick={() => setView("settings")} />
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">严格艾宾浩斯复习</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="切换主题" onClick={() => saveTheme(settings.theme === "dark" ? "light" : "dark")}>
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="icon-button" title="通知" onClick={enableNotifications}>
              <Bell />
            </button>
          </div>
        </header>

        {toast && (
          <button className="toast" onClick={() => setToast("")}>
            {toast}
          </button>
        )}

        {view === "home" && (
          <HomeView
            decks={decks}
            dueCards={dueCards}
            stats={stats}
            onOpenDeck={(id) => {
              setSelectedDeckId(id);
              setView("deck");
            }}
            onStudy={() => setView("study")}
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
              const result = await api.createDeck({ name, parentId, language: settings.voiceLanguage });
              setSelectedDeckId(result.id);
              await refresh();
            }}
            onUpdateDeck={async (id, name) => {
              await api.updateDeck(id, { name });
              await refresh();
            }}
            onDeleteDeck={async (id) => {
              await api.deleteDeck(id);
              setSelectedDeckId(null);
              await refresh();
            }}
            onCreateCard={async (payload) => {
              if (!selectedDeckId) return;
              await api.createCard(selectedDeckId, payload);
              await loadCards(selectedDeckId);
              await refresh();
            }}
            onUpdateCard={async (id, payload) => {
              await api.updateCard(id, payload);
              if (selectedDeckId) await loadCards(selectedDeckId);
              await refresh();
            }}
            onDeleteCard={async (id) => {
              await api.deleteCard(id);
              if (selectedDeckId) await loadCards(selectedDeckId);
              await refresh();
            }}
            onToggleFavorite={async (card) => {
              await api.updateCard(card.id, { favorite: card.favorite ? 0 : 1 });
              if (selectedDeckId) await loadCards(selectedDeckId);
            }}
            onSpeak={speak}
          />
        )}

        {view === "study" && (
          <StudyView
            mode={studyMode}
            onMode={setStudyMode}
            cards={dueCards.length ? dueCards : cards}
            selectedDeck={selectedDeck}
            onAnswer={handleAnswer}
            onSpeak={speak}
          />
        )}

        {view === "import" && (
          <ImportView
            decks={decks}
            selectedDeckId={selectedDeckId}
            onSelectDeck={setSelectedDeckId}
            onImported={async (message) => {
              setToast(message);
              await refresh();
              if (selectedDeckId) await loadCards(selectedDeckId);
            }}
          />
        )}

        {view === "settings" && (
          <SettingsView
            settings={settings}
            onSave={async (next) => {
              const merged = { ...settings, ...next };
              setSettings(merged);
              applyTheme(merged.theme);
              await api.saveSettings(next);
            }}
            onNotify={enableNotifications}
          />
        )}
      </main>
    </div>
  );

  async function saveTheme(theme: ThemeMode) {
    setSettings((current) => ({ ...current, theme }));
    applyTheme(theme);
    await api.saveSettings({ theme });
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setToast("当前浏览器不支持通知");
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    await api.saveSettings({ notifications: enabled ? "on" : "off" });
    setSettings((current) => ({ ...current, notifications: enabled ? "on" : "off" }));
    setToast(enabled ? "通知已开启" : "通知未授权");
  }
}

function viewTitle(view: View) {
  return {
    home: "今日复习",
    deck: "卡组管理",
    study: "学习模式",
    import: "批量导入",
    settings: "设置"
  }[view];
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
  dueCards: Card[];
  stats: Stats;
  onOpenDeck: (id: number) => void;
  onStudy: () => void;
}) {
  const mastered = props.stats.total_cards
    ? Math.round((props.stats.mastered_cards / props.stats.total_cards) * 100)
    : 0;
  return (
    <section className="stack">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">今天到期</p>
          <h2>{props.stats.due_cards || 0} 张卡片</h2>
          <p>按 5 分钟、30 分钟、12 小时、1 天等固定艾宾浩斯间隔复习。</p>
        </div>
        <button className="primary-button" onClick={props.onStudy}>
          <Sparkles />
          开始复习
        </button>
      </div>

      <div className="metric-grid">
        <Metric label="总卡片" value={props.stats.total_cards || 0} />
        <Metric label="已掌握" value={`${mastered}%`} />
        <Metric label="到期复习" value={props.stats.due_cards || 0} />
      </div>

      <div className="section-heading">
        <h2>卡组</h2>
      </div>
      <div className="deck-grid">
        {props.decks.map((deck) => (
          <button className="deck-card" key={deck.id} onClick={() => props.onOpenDeck(deck.id)}>
            <span className="deck-icon"><BookOpen /></span>
            <strong>{deck.name}</strong>
            <span>{deck.card_count || 0} 张 · {deck.due_count || 0} 到期</span>
          </button>
        ))}
        {props.decks.length === 0 && <EmptyState text="先创建一个卡组，再导入表格或手动添加单词。" />}
      </div>

      <div className="section-heading">
        <h2>即将复习</h2>
      </div>
      <div className="list">
        {props.dueCards.slice(0, 6).map((card) => (
          <div className="list-row" key={card.id}>
            <strong>{card.front}</strong>
            <span>{card.back}</span>
          </div>
        ))}
        {props.dueCards.length === 0 && <EmptyState text="暂无到期卡片。新卡学习后会进入艾宾浩斯队列。" />}
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: string | number }) {
  return (
    <div className="metric">
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
  onCreateCard: (payload: { front: string; back: string; example?: string; note?: string }) => Promise<void>;
  onUpdateCard: (id: number, payload: { front: string; back: string; example?: string; note?: string }) => Promise<void>;
  onDeleteCard: (id: number) => Promise<void>;
  onToggleFavorite: (card: Card) => Promise<void>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [deckName, setDeckName] = useState("");
  const [parentDeckId, setParentDeckId] = useState<number | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<number | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [example, setExample] = useState("");
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  async function addDeck(event: FormEvent) {
    event.preventDefault();
    if (!deckName.trim()) return;
    await props.onCreateDeck(deckName.trim(), parentDeckId);
    setDeckName("");
    setParentDeckId(null);
  }

  async function addCard(event: FormEvent) {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    await props.onCreateCard({ front, back, example });
    setFront("");
    setBack("");
    setExample("");
  }

  async function saveDeck(id: number) {
    if (!editingDeckName.trim()) return;
    await props.onUpdateDeck(id, editingDeckName.trim());
    setEditingDeckId(null);
    setEditingDeckName("");
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!editingCard || !editingCard.front.trim() || !editingCard.back.trim()) return;
    await props.onUpdateCard(editingCard.id, {
      front: editingCard.front,
      back: editingCard.back,
      example: editingCard.example,
      note: editingCard.note
    });
    setEditingCard(null);
  }

  return (
    <section className="two-column">
      <div className="panel">
        <h2>卡组</h2>
        <form className="inline-form" onSubmit={addDeck}>
          <input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="新卡组名称" />
          <select value={parentDeckId ?? ""} onChange={(event) => setParentDeckId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">顶层</option>
            {props.decks.filter((deck) => deck.depth < 5).map((deck) => (
              <option key={deck.id} value={deck.id}>
                {"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}
              </option>
            ))}
          </select>
          <button className="icon-button strong" title="创建卡组">
            <Plus />
          </button>
        </form>
        <div className="deck-list">
          {props.decks.map((deck) => (
            <div className={`deck-list-row depth-${Math.min(deck.depth, 5)}`} key={deck.id}>
              <button
                className={`deck-list-item ${deck.id === props.selectedDeckId ? "active" : ""}`}
                onClick={() => props.onSelectDeck(deck.id)}
              >
                <span className="deck-name">
                  {deck.depth > 1 && <i />}
                  <strong>{deck.name}</strong>
                </span>
                <span>{deck.total_card_count || deck.card_count || 0} 张</span>
              </button>
              <div className="row-actions">
                <button className="mini-button" title="添加子卡组" disabled={deck.depth >= 5} onClick={() => {
                  setParentDeckId(deck.id);
                  setDeckName(`${deck.name} / `);
                }}>
                  <FolderPlus />
                </button>
                <button className="mini-button" title="编辑卡组" onClick={() => {
                  setEditingDeckId(deck.id);
                  setEditingDeckName(deck.name);
                }}>
                  <Edit3 />
                </button>
                <button className="mini-button danger" title="删除卡组" onClick={() => {
                  if (window.confirm(`删除「${deck.name}」及其子卡组和卡片？`)) props.onDeleteDeck(deck.id);
                }}>
                  <Trash2 />
                </button>
              </div>
              {editingDeckId === deck.id && (
                <form className="edit-row" onSubmit={(event) => {
                  event.preventDefault();
                  saveDeck(deck.id);
                }}>
                  <input value={editingDeckName} onChange={(event) => setEditingDeckName(event.target.value)} />
                  <button className="mini-button strong" title="保存卡组"><Save /></button>
                  <button className="mini-button" title="取消" type="button" onClick={() => setEditingDeckId(null)}><XCircle /></button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel wide-panel">
        <div className="toolbar">
          <div className="search">
            <Search />
            <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索单词、释义、例句" />
          </div>
        </div>
        <form className="card-form" onSubmit={addCard}>
          <input value={front} onChange={(event) => setFront(event.target.value)} placeholder="单词 / 短语" />
          <input value={back} onChange={(event) => setBack(event.target.value)} placeholder="释义" />
          <input value={example} onChange={(event) => setExample(event.target.value)} placeholder="例句（可选）" />
          <button className="primary-button"><Plus /> 添加</button>
        </form>
        {editingCard && (
          <form className="card-form edit-card-form" onSubmit={saveCard}>
            <input value={editingCard.front} onChange={(event) => setEditingCard({ ...editingCard, front: event.target.value })} placeholder="单词 / 短语" />
            <input value={editingCard.back} onChange={(event) => setEditingCard({ ...editingCard, back: event.target.value })} placeholder="释义" />
            <input value={editingCard.example} onChange={(event) => setEditingCard({ ...editingCard, example: event.target.value })} placeholder="例句（可选）" />
            <button className="primary-button"><Save /> 保存</button>
            <button className="primary-button secondary-button" type="button" onClick={() => setEditingCard(null)}><XCircle /> 取消</button>
          </form>
        )}
        <div className="card-list">
          {props.cards.map((card) => (
            <article className="word-card" key={card.id}>
              <div>
                <div className="word-title">
                  <strong>{card.front}</strong>
                  <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front)}>
                    <Volume2 />
                  </button>
                  <button className={`mini-button ${card.favorite ? "starred" : ""}`} title="收藏" onClick={() => props.onToggleFavorite(card)}>
                    <Star />
                  </button>
                  <button className="mini-button" title="编辑" onClick={() => setEditingCard(card)}>
                    <Edit3 />
                  </button>
                </div>
                <p>{card.back}</p>
                {card.example && <small>{card.example}</small>}
              </div>
              <div className="card-meta">
                <span>阶段 {card.stage}/10</span>
                <span>{dueText(card.due_at)}</span>
                <button className="mini-button danger" title="删除" onClick={() => props.onDeleteCard(card.id)}>
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
          {props.cards.length === 0 && <EmptyState text="这个卡组还没有卡片。" />}
        </div>
      </div>
    </section>
  );
}

function StudyView(props: {
  mode: StudyMode;
  onMode: (mode: StudyMode) => void;
  cards: Card[];
  selectedDeck?: Deck;
  onAnswer: (card: Card, rating: ReviewRating) => Promise<void>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<"right" | "wrong" | "partial" | null>(null);
  const card = props.cards[index % Math.max(props.cards.length, 1)];

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setAnswer("");
    setChecked(null);
  }, [props.mode, props.cards.length]);

  if (!card) return <EmptyState text="暂无可学习卡片。先创建或导入卡片。" />;

  const choices = props.cards
    .filter((item) => item.id !== card.id)
    .slice(0, 3)
    .map((item) => item.back)
    .concat(card.back)
    .sort(() => 0.5 - Math.random());

  async function rate(rating: ReviewRating) {
    await props.onAnswer(card, rating);
    setIndex((value) => value + 1);
    setFlipped(false);
    setAnswer("");
    setChecked(null);
  }

  function checkWritten() {
    const result = normalizeAnswer(answer) === normalizeAnswer(card.front);
    setChecked(result ? "right" : "wrong");
  }

  return (
    <section className="stack">
      <div className="mode-tabs">
        {(Object.keys(modeLabels) as StudyMode[]).map((mode) => (
          <button key={mode} className={mode === props.mode ? "active" : ""} onClick={() => props.onMode(mode)}>
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      <div className="study-panel">
        <div className="progress-line">
          <span>{index + 1}</span>
          <div><i style={{ width: `${Math.min(((index + 1) / Math.max(props.cards.length, 1)) * 100, 100)}%` }} /></div>
          <span>{props.cards.length}</span>
        </div>

        {props.mode === "flashcards" && (
          <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)}>
            <span>{flipped ? card.back : card.front}</span>
            {flipped && card.example && <small>{card.example}</small>}
          </button>
        )}

        {props.mode === "learn" && (
          <div className="question-box">
            <p>选择 “{card.front}” 的释义</p>
            <ChoiceGrid choices={choices} answer={card.back} onResult={(ok) => rate(ok ? "known" : "unknown")} />
          </div>
        )}

        {props.mode === "test" && (
          <div className="question-box">
            <p>{card.back}</p>
            <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="输入对应单词" />
            <button className="primary-button" onClick={checkWritten}>检查</button>
            {checked && <ResultBadge checked={checked} correct={card.front} onRate={rate} />}
          </div>
        )}

        {props.mode === "write" && (
          <div className="question-box">
            <p>{card.back}</p>
            {card.example && <small>{card.example.replace(card.front, "____")}</small>}
            <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="默写单词" />
            <button className="primary-button" onClick={checkWritten}>检查</button>
            {checked && <ResultBadge checked={checked} correct={card.front} onRate={rate} />}
          </div>
        )}

        {props.mode === "listen" && (
          <div className="question-box">
            <button className="listen-button" onClick={() => props.onSpeak(card.front, card.language ?? props.selectedDeck?.language)}>
              <Headphones />
              播放发音
            </button>
            <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="听写单词" />
            <button className="primary-button" onClick={checkWritten}>检查</button>
            {checked && <ResultBadge checked={checked} correct={card.front} onRate={rate} />}
          </div>
        )}

        {props.mode === "match" && (
          <div className="question-box">
            <p>配对：{card.front}</p>
            <ChoiceGrid choices={choices} answer={card.back} onResult={(ok) => rate(ok ? "known" : "unknown")} />
          </div>
        )}

        <div className="rating-row">
          <button className="rating unknown" onClick={() => rate("unknown")}><XCircle /> 不认识</button>
          <button className="rating fuzzy" onClick={() => rate("fuzzy")}><RotateCcw /> 模糊</button>
          <button className="rating known" onClick={() => rate("known")}><CheckCircle2 /> 认识</button>
        </div>
      </div>
    </section>
  );
}

function ChoiceGrid(props: { choices: string[]; answer: string; onResult: (ok: boolean) => void }) {
  return (
    <div className="choice-grid">
      {props.choices.map((choice, index) => (
        <button key={`${choice}-${index}`} onClick={() => props.onResult(choice === props.answer)}>
          {choice}
        </button>
      ))}
    </div>
  );
}

function ResultBadge(props: { checked: "right" | "wrong" | "partial"; correct: string; onRate: (rating: ReviewRating) => void }) {
  const right = props.checked === "right";
  return (
    <div className={`result ${right ? "right" : "wrong"}`}>
      <strong>{right ? "正确" : `正确答案：${props.correct}`}</strong>
      <button onClick={() => props.onRate(right ? "known" : "unknown")}>{right ? "继续" : "加入复习"}</button>
    </div>
  );
}

function ImportView(props: {
  decks: Deck[];
  selectedDeckId: number | null;
  onSelectDeck: (id: number) => void;
  onImported: (message: string) => Promise<void>;
}) {
  const [text, setText] = useState("front,back,example\napple,苹果,An apple a day.");
  const [file, setFile] = useState<File | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!props.selectedDeckId) return;
    const form = new FormData();
    form.set("deckId", String(props.selectedDeckId));
    if (file) form.set("file", file);
    else form.set("text", text);
    const result = await api.importCards(form);
    await props.onImported(`导入 ${result.imported} 张，跳过 ${result.skipped} 行`);
  }

  return (
    <section className="panel">
      <form className="import-form" onSubmit={submit}>
        <label>
          目标卡组
          <select value={props.selectedDeckId ?? ""} onChange={(event) => props.onSelectDeck(Number(event.target.value))}>
            <option value="" disabled>选择卡组</option>
            {props.decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          </select>
        </label>
        <label>
          上传 CSV/TSV/XLSX
          <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <label>
          或粘贴表格
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} />
        </label>
        <p className="hint">表头支持 front/back/example/note，也支持中文“单词/释义/例句/备注”。</p>
        <button className="primary-button"><FileSpreadsheet /> 开始导入</button>
      </form>
    </section>
  );
}

function SettingsView(props: {
  settings: Settings;
  onSave: (settings: Partial<Settings>) => Promise<void>;
  onNotify: () => Promise<void>;
}) {
  return (
    <section className="panel settings-panel">
      <label>
        主题
        <select value={props.settings.theme} onChange={(event) => props.onSave({ theme: event.target.value as ThemeMode })}>
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">暗黑</option>
        </select>
      </label>
      <label>
        默认发音语言
        <select value={props.settings.voiceLanguage} onChange={(event) => props.onSave({ voiceLanguage: event.target.value })}>
          <option value="en-US">英语 en-US</option>
          <option value="ja-JP">日语 ja-JP</option>
          <option value="ko-KR">韩语 ko-KR</option>
          <option value="fr-FR">法语 fr-FR</option>
          <option value="de-DE">德语 de-DE</option>
        </select>
      </label>
      <button className="primary-button" onClick={props.onNotify}><Bell /> 开启浏览器通知</button>
      <div className="schedule-box">
        <h3>艾宾浩斯间隔</h3>
        <p>5 分钟 · 30 分钟 · 12 小时 · 1 天 · 2 天 · 4 天 · 7 天 · 15 天 · 30 天 · 90 天</p>
      </div>
    </section>
  );
}

function EmptyState(props: { text: string }) {
  return <div className="empty-state">{props.text}</div>;
}
