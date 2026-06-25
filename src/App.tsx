import {
  AlertTriangle,
  Bell,
  BookOpen,
  Brain,
  CheckCircle2,
  Edit3,
  Eye,
  FileSpreadsheet,
  FolderPlus,
  HelpCircle,
  Home,
  Info,
  ListChecks,
  LogOut,
  MoreHorizontal,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Sun,
  Target,
  Trash2,
  User as UserIcon,
  Volume2,
  XCircle
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type CardPayload, type ConflictError } from "./api";
import type { Card, CardType, DailyTask, Deck, ReviewRating, Settings, Stats, SyncStatus, ThemeMode, User } from "./types";

type View = "home" | "deck" | "study" | "import" | "settings" | "about";
type StudyMode = "flashcards" | "choice" | "write";
type SyncState = "idle" | "syncing" | "success" | "error" | "conflict";

const version = "0.2.0";

const cardTypeLabels: Record<CardType, string> = {
  basic: "普通卡",
  word: "单词卡",
  choice: "选择题卡",
  blank: "填空题卡"
};

const modeLabels: Record<StudyMode, string> = {
  flashcards: "闪记卡",
  choice: "选择",
  write: "填写"
};

const ratingLabels: Record<ReviewRating, string> = {
  known: "认识",
  fuzzy: "模糊",
  unknown: "不认识"
};

const emptyDailyTask: DailyTask = {
  date: "",
  daily_new_goal: 20,
  new_completed: 0,
  review_total: 0,
  review_completed: 0,
  completed: false,
  completed_at: "",
  streak: 0
};

function normalizeAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
  return value.split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
}

function isWordCard(card: Card) {
  return card.card_type === "word";
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
    voiceLanguage: "en-US",
    notifications: "off",
    dailyNewGoal: 20
  });
  const [dailyTask, setDailyTask] = useState<DailyTask>(emptyDailyTask);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [studyMode, setStudyMode] = useState<StudyMode>("flashcards");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [conflict, setConflict] = useState<{ id: number; payload: CardPayload; serverCard: Card } | null>(null);

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
      setStudyRootDeckId((current) => current && nextDecks.some((deck) => deck.id === current && deck.depth === 1) ? current : nextDecks.find((deck) => deck.depth === 1)?.id ?? null);
      const rootId = studyRootDeckId ?? nextDecks.find((deck) => deck.depth === 1)?.id;
      setDueCards(rootId ? await api.dueCards(rootId, 80) : []);
      if (!options.silent) setSyncState("success");
    } catch (error) {
      setSyncState("error");
      setToast((error as Error).message);
    }
  }

  async function loadCards(deckId: number) {
    setCards(await api.cards(deckId));
  }

  async function afterMutation(message?: string) {
    if (selectedDeckId) await loadCards(selectedDeckId);
    await refresh({ silent: true });
    setSyncState("success");
    if (message) setToast(message);
  }

  async function updateCardWithConflict(id: number, payload: CardPayload) {
    try {
      await api.updateCard(id, payload);
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
  }

  useEffect(() => {
    api.authStatus()
      .then((status) => {
        setUser(status.user);
        setCanRegister(status.canRegister);
        if (status.authenticated) return refresh();
      })
      .catch((error) => setToast(error.message))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user) refresh().catch((error) => setToast(error.message));
  }, [user?.id]);

  useEffect(() => {
    if (selectedDeckId) loadCards(selectedDeckId).catch((error) => setToast(error.message));
  }, [selectedDeckId]);

  useEffect(() => {
    if (!studyRootDeckId) return;
    api.dueCards(studyRootDeckId, 80).then(setDueCards).catch((error) => setToast(error.message));
  }, [studyRootDeckId]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

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
        body: `${studyRootDeck?.name ?? "当前卡组"} 有 ${dueCards.length} 张卡片到期。`,
        icon: "/vite.svg"
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dueCards.length, settings.notifications, studyRootDeck?.name]);

  function speak(text: string, language?: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language ?? selectedDeck?.language ?? settings.voiceLanguage;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function handleAnswer(card: Card, rating: ReviewRating) {
    await api.answer(card.id, rating);
    await afterMutation(`${card.front}：${ratingLabels[rating]}`);
  }

  if (!authChecked) {
    return <div className="auth-shell"><div className="auth-panel"><p className="eyebrow">Xian 闪记卡</p><h1>正在检查登录状态</h1></div></div>;
  }

  if (!user) {
    return <LoginView canRegister={canRegister} onAuthed={(nextUser) => { setUser(nextUser); setCanRegister(false); }} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark">X</span>
          <span>Xian 闪记卡</span>
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
            <button className={`sync-button ${syncState}`} title="同步" onClick={() => refresh()}>
              <RefreshCw />
              <span>{syncLabel(syncState)}</span>
            </button>
            <button className="icon-button" title="切换主题" onClick={() => saveTheme(settings.theme === "dark" ? "light" : "dark")}>
              {settings.theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="icon-button" title="通知" onClick={enableNotifications}>
              <Bell />
            </button>
            <button className="icon-button" title="退出登录" onClick={logout}>
              <LogOut />
            </button>
          </div>
        </header>

        {toast && <button className="toast" onClick={() => setToast("")}>{toast}</button>}
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
              setStudyRootDeckId(id);
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
              const result = await api.createDeck({ name, parentId, language: settings.voiceLanguage });
              setSelectedDeckId(result.id);
              await afterMutation();
            }}
            onUpdateDeck={async (id, name) => {
              await api.updateDeck(id, { name });
              await afterMutation();
            }}
            onDeleteDeck={async (id) => {
              await api.deleteDeck(id);
              setSelectedDeckId(null);
              await afterMutation();
            }}
            onCreateCard={async (payload) => {
              if (!selectedDeckId) return;
              await api.createCard(selectedDeckId, payload);
              await afterMutation();
            }}
            onUpdateCard={updateCardWithConflict}
            onDeleteCard={async (id) => {
              await api.deleteCard(id);
              await afterMutation();
            }}
            onToggleFavorite={async (card) => {
              await updateCardWithConflict(card.id, { favorite: card.favorite ? 0 : 1, baseUpdatedAt: card.updated_at });
            }}
            onSpeak={speak}
          />
        )}

        {view === "study" && (
          <StudyView
            mode={studyMode}
            onMode={setStudyMode}
            cards={dueCards}
            rootDecks={rootDecks}
            selectedRootDeckId={studyRootDeckId}
            onSelectRootDeck={setStudyRootDeckId}
            selectedDeck={studyRootDeck}
            onAnswer={handleAnswer}
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
          />
        )}

        {view === "settings" && (
          <SettingsView
            settings={settings}
            onSave={async (next) => {
              const merged = { ...settings, ...next };
              setSettings(merged);
              applyTheme(merged.theme);
              if (next.dailyNewGoal !== undefined) await api.saveDailyTaskSettings({ dailyNewGoal: Number(next.dailyNewGoal) });
              await api.saveSettings(next);
              await afterMutation("设置已保存");
            }}
            onNotify={enableNotifications}
          />
        )}

        {view === "about" && <AboutView syncStatus={syncStatus} />}
      </main>
    </div>
  );

  async function saveTheme(theme: ThemeMode) {
    setSettings((current) => ({ ...current, theme }));
    applyTheme(theme);
    await api.saveSettings({ theme });
    await afterMutation("主题已保存");
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
    await afterMutation(enabled ? "通知已开启" : "通知未授权");
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setDecks([]);
    setCards([]);
    setDueCards([]);
    setSelectedDeckId(null);
    setStudyRootDeckId(null);
    setView("home");
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
          <span className="brand-mark">X</span>
          <span>Xian 闪记卡</span>
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
  return (
    <section className="stack">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">今日打卡</p>
          <h2>{props.dailyTask.completed ? "已完成" : `${props.dailyTask.new_completed}/${props.dailyTask.daily_new_goal} 新学`}</h2>
          <p>复习 {props.dailyTask.review_completed}/{props.dailyTask.review_total} · 连续打卡 {props.dailyTask.streak} 天</p>
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
        <TaskItem icon={<Target />} label="每日新学" value={`${props.dailyTask.new_completed}/${props.dailyTask.daily_new_goal}`} done={props.dailyTask.new_completed >= props.dailyTask.daily_new_goal} />
        <TaskItem icon={<ListChecks />} label="既有复习" value={`${props.dailyTask.review_completed}/${props.dailyTask.review_total}`} done={props.dailyTask.review_completed >= props.dailyTask.review_total} />
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
  onUpdateCard: (id: number, payload: CardPayload) => Promise<void>;
  onDeleteCard: (id: number) => Promise<void>;
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

  async function addDeck(event: FormEvent) {
    event.preventDefault();
    if (!deckName.trim()) return;
    await props.onCreateDeck(deckName.trim(), parentDeckId);
    setDeckName("");
    setParentDeckId(null);
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
              <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>
            ))}
          </select>
          <button className="icon-button strong" title="创建卡组"><Plus /></button>
        </form>
        <div className="deck-list">
          {props.decks.map((deck) => (
            <div className={`deck-list-row depth-${Math.min(deck.depth, 5)}`} key={deck.id}>
              <button className={`deck-list-item ${deck.id === props.selectedDeckId ? "active" : ""}`} onClick={() => props.onSelectDeck(deck.id)}>
                <span className="deck-name">{deck.depth > 1 && <i />}<strong>{deck.name}</strong></span>
                <span className="deck-count">{deck.total_card_count || deck.card_count || 0} 张</span>
              </button>
              <div className="deck-menu">
                <button className="mini-button" title="更多操作" onClick={() => setOpenDeckMenuId((current) => current === deck.id ? null : deck.id)}><MoreHorizontal /></button>
                {openDeckMenuId === deck.id && (
                  <div className="deck-menu-popover">
                    <button disabled={deck.depth >= 5} onClick={() => { setParentDeckId(deck.id); setDeckName(`${deck.name} / `); setOpenDeckMenuId(null); }}><FolderPlus /><span>子卡组</span></button>
                    <button onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setOpenDeckMenuId(null); }}><Edit3 /><span>编辑</span></button>
                    <button className="danger" onClick={() => { setOpenDeckMenuId(null); if (window.confirm(`删除「${deck.name}」及其子卡组和卡片？`)) props.onDeleteDeck(deck.id); }}><Trash2 /><span>删除</span></button>
                  </div>
                )}
              </div>
              {editingDeckId === deck.id && (
                <form className="edit-row" onSubmit={(event) => { event.preventDefault(); if (editingDeckName.trim()) props.onUpdateDeck(deck.id, editingDeckName.trim()).then(() => setEditingDeckId(null)); }}>
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
          <div className="search"><Search /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="搜索题目、答案、选项、例句" /></div>
        </div>
        <CardEditor onSubmit={props.onCreateCard} />
        {editingCard && <CardEditor card={editingCard} onCancel={() => setEditingCard(null)} onSubmit={async (payload) => { await props.onUpdateCard(editingCard.id, { ...payload, baseUpdatedAt: editingCard.updated_at }); setEditingCard(null); }} />}
        <div className="card-list">
          {props.cards.map((card) => (
            <article className="word-card" key={card.id}>
              <div>
                <div className="word-title">
                  <strong>{card.front}</strong>
                  <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
                  {isWordCard(card) && card.phonetic && <span className="phonetic">{card.phonetic}</span>}
                  <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front)}><Volume2 /></button>
                  <button className={`mini-button ${card.favorite ? "starred" : ""}`} title="收藏" onClick={() => props.onToggleFavorite(card)}><Star /></button>
                  <button className="mini-button" title="详情" onClick={() => setDetailCard(card)}><Eye /></button>
                  <button className="mini-button" title="编辑" onClick={() => setEditingCard(card)}><Edit3 /></button>
                </div>
                <p>{card.back}</p>
                {card.example && <small>{card.example}</small>}
                {parseChoices(card.choices).length > 0 && <small>选项：{parseChoices(card.choices).join(" / ")}</small>}
                {isWordCard(card) && card.mnemonic && <small>助记：{card.mnemonic}</small>}
              </div>
              <div className="card-meta">
                <span>阶段 {card.stage}/10</span>
                <span>下次 {dueText(card.due_at)}</span>
                <button className="mini-button danger" title="删除" onClick={() => props.onDeleteCard(card.id)}><Trash2 /></button>
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
  const [cardType, setCardType] = useState<CardType>(props.card?.card_type ?? "word");
  const [front, setFront] = useState(props.card?.front ?? "");
  const [phonetic, setPhonetic] = useState(props.card?.phonetic ?? "");
  const [back, setBack] = useState(props.card?.back ?? "");
  const [example, setExample] = useState(props.card?.example ?? "");
  const [mnemonic, setMnemonic] = useState(props.card?.mnemonic ?? "");
  const [note, setNote] = useState(props.card?.note ?? "");
  const [choices, setChoices] = useState(parseChoices(props.card?.choices).join(" | "));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    await props.onSubmit({
      card_type: cardType,
      front,
      back,
      phonetic,
      example,
      mnemonic,
      note,
      choices: cardType === "choice" ? parseChoices(choices) : []
    });
    if (!props.card) {
      setFront("");
      setPhonetic("");
      setBack("");
      setExample("");
      setMnemonic("");
      setNote("");
      setChoices("");
    }
  }

  return (
    <form className={`card-form ${props.card ? "edit-card-form" : ""}`} onSubmit={submit}>
      <select value={cardType} onChange={(event) => setCardType(event.target.value as CardType)} title="卡片类型">
        <option value="word">单词卡</option>
        <option value="basic">普通卡</option>
        <option value="choice">选择题卡</option>
        <option value="blank">填空题卡</option>
      </select>
      <input value={front} onChange={(event) => setFront(event.target.value)} placeholder={cardType === "blank" ? "题干，使用 ____ 表示空格" : cardType === "choice" ? "题目" : "正面 / 单词"} />
      {cardType === "word" && <input value={phonetic} onChange={(event) => setPhonetic(event.target.value)} placeholder="音标（可选）" />}
      <input value={back} onChange={(event) => setBack(event.target.value)} placeholder={cardType === "choice" || cardType === "blank" ? "正确答案" : "背面 / 释义"} />
      {cardType === "choice" && <input value={choices} onChange={(event) => setChoices(event.target.value)} placeholder="选项，用 | 分隔" />}
      <input value={example} onChange={(event) => setExample(event.target.value)} placeholder="例句 / 说明（可选）" />
      {cardType === "word" && <input value={mnemonic} onChange={(event) => setMnemonic(event.target.value)} placeholder="助记（可选）" />}
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注（可选）" />
      <button className="primary-button">{props.card ? <Save /> : <Plus />}{props.card ? "保存" : "添加"}</button>
      {props.onCancel && <button className="primary-button secondary-button" type="button" onClick={props.onCancel}><XCircle />取消</button>}
    </form>
  );
}

function StudyView(props: {
  mode: StudyMode;
  onMode: (mode: StudyMode) => void;
  cards: Card[];
  rootDecks: Deck[];
  selectedRootDeckId: number | null;
  onSelectRootDeck: (id: number) => void;
  selectedDeck?: Deck;
  onAnswer: (card: Card, rating: ReviewRating) => Promise<void>;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<void>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<"right" | "wrong" | null>(null);
  const [editingStudyCard, setEditingStudyCard] = useState<Card | null>(null);
  const card = props.cards[index % Math.max(props.cards.length, 1)];

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setEditingStudyCard(null);
  }, [props.mode, props.cards.length, props.selectedRootDeckId]);

  useEffect(() => {
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setEditingStudyCard(null);
    if (card && isWordCard(card)) props.onSpeak(card.front, card.language ?? props.selectedDeck?.language);
  }, [card?.id]);

  async function rate(rating: ReviewRating) {
    if (!card) return;
    await props.onAnswer(card, rating);
    setIndex((value) => value + 1);
    setFlipped(false);
    setAnswer("");
    setChecked(null);
  }

  function checkWritten() {
    if (!card) return;
    setChecked(normalizeAnswer(answer) === normalizeAnswer(card.back) || normalizeAnswer(answer) === normalizeAnswer(card.front) ? "right" : "wrong");
  }

  const choices = card
    ? card.card_type === "choice"
      ? Array.from(new Set([...parseChoices(card.choices), card.back])).sort(() => 0.5 - Math.random())
      : props.cards.filter((item) => item.id !== card.id).slice(0, 3).map((item) => item.back).concat(card.back).sort(() => 0.5 - Math.random())
    : [];

  return (
    <section className="stack">
      <div className="panel study-selector">
        <label>
          大卡组
          <select value={props.selectedRootDeckId ?? ""} onChange={(event) => props.onSelectRootDeck(Number(event.target.value))}>
            <option value="" disabled>选择大卡组</option>
            {props.rootDecks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name} · {deck.due_count || 0} 到期</option>)}
          </select>
        </label>
      </div>

      <div className="mode-tabs">
        {(Object.keys(modeLabels) as StudyMode[]).map((mode) => (
          <button key={mode} className={mode === props.mode ? "active" : ""} onClick={() => props.onMode(mode)}>{modeLabels[mode]}</button>
        ))}
      </div>

      {!card ? <EmptyState text="这个大卡组暂无到期卡片。请选择其他大卡组，或先新学一些卡片。" /> : (
        <div className="study-panel">
          <div className="progress-line">
            <span>{index + 1}</span>
            <div><i style={{ width: `${Math.min(((index + 1) / Math.max(props.cards.length, 1)) * 100, 100)}%` }} /></div>
            <span>{props.cards.length}</span>
          </div>
          <div className="study-actions">
            <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
            <button className="mini-button" title="编辑当前卡片" onClick={() => setEditingStudyCard(card)}><Edit3 /></button>
            <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front, card.language ?? props.selectedDeck?.language)}><Volume2 /></button>
          </div>
          {editingStudyCard && <CardEditor card={editingStudyCard} onCancel={() => setEditingStudyCard(null)} onSubmit={async (payload) => { await props.onUpdateCard(editingStudyCard.id, { ...payload, baseUpdatedAt: editingStudyCard.updated_at }); setEditingStudyCard(null); }} />}
          {props.mode === "flashcards" && (
            <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)}>
              {flipped ? <CardBack card={card} /> : <CardFront card={card} />}
            </button>
          )}
          {props.mode === "choice" && (
            <div className="question-box">
              <p>{card.card_type === "choice" ? card.front : `选择「${card.front}」的答案`}</p>
              <ChoiceGrid choices={choices} answer={card.back} onResult={(ok) => rate(ok ? "known" : "unknown")} />
            </div>
          )}
          {props.mode === "write" && (
            <div className="question-box">
              <p>{card.card_type === "blank" ? card.front : card.back}</p>
              {card.example && <small>{card.example}</small>}
              <input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="输入答案" />
              <button className="primary-button" onClick={checkWritten}>检查</button>
              {checked && <ResultBadge checked={checked} correct={card.card_type === "word" ? card.front : card.back} onRate={rate} />}
            </div>
          )}
          <div className="rating-row">
            <button className="rating unknown" onClick={() => rate("unknown")}><XCircle />不认识</button>
            <button className="rating fuzzy" onClick={() => rate("fuzzy")}><RotateCcw />模糊</button>
            <button className="rating known" onClick={() => rate("known")}><CheckCircle2 />认识</button>
          </div>
        </div>
      )}
    </section>
  );
}

function CardFront(props: { card: Card }) {
  if (props.card.card_type === "blank") return <span>{props.card.front}</span>;
  if (props.card.card_type === "choice") return <span>{props.card.front}</span>;
  if (!isWordCard(props.card)) return <span>{props.card.front}</span>;
  return <span className="word-face"><strong>{props.card.front}</strong>{props.card.phonetic && <em>{props.card.phonetic}</em>}</span>;
}

function CardBack(props: { card: Card }) {
  if (!isWordCard(props.card)) {
    return <><span>{props.card.back}</span>{props.card.example && <small>{props.card.example}</small>}</>;
  }
  return (
    <span className="word-back">
      <strong>{props.card.front}</strong>
      {props.card.phonetic && <em>{props.card.phonetic}</em>}
      <b>{props.card.back}</b>
      {props.card.example && <small>{props.card.example}</small>}
      {props.card.mnemonic && <small>助记：{props.card.mnemonic}</small>}
    </span>
  );
}

function ChoiceGrid(props: { choices: string[]; answer: string; onResult: (ok: boolean) => void }) {
  return <div className="choice-grid">{props.choices.map((choice, index) => <button key={`${choice}-${index}`} onClick={() => props.onResult(choice === props.answer)}>{choice}</button>)}</div>;
}

function ResultBadge(props: { checked: "right" | "wrong"; correct: string; onRate: (rating: ReviewRating) => void }) {
  const right = props.checked === "right";
  return <div className={`result ${right ? "right" : "wrong"}`}><strong>{right ? "正确" : `正确答案：${props.correct}`}</strong><button onClick={() => props.onRate(right ? "known" : "unknown")}>{right ? "继续" : "加入复习"}</button></div>;
}

function ImportView(props: { decks: Deck[]; selectedDeckId: number | null; onSelectDeck: (id: number) => void; onImported: (message: string) => Promise<void> }) {
  const [text, setText] = useState("card_type,front,back,option1,option2,option3,option4\nchoice,Which one means apple?,苹果,苹果,香蕉,橙子,葡萄\nblank,I eat ____ every day.,apple,,,,");
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
        <label>目标卡组<select value={props.selectedDeckId ?? ""} onChange={(event) => props.onSelectDeck(Number(event.target.value))}><option value="" disabled>选择卡组</option>{props.decks.map((deck) => <option key={deck.id} value={deck.id}>{"　".repeat(Math.max(deck.depth - 1, 0))}{deck.name}</option>)}</select></label>
        <label>上传 CSV/TSV/XLSX<input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label>或粘贴表格<textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} /></label>
        <p className="hint">支持 card_type/type/卡片类型。单词卡：word/front/back/phonetic/example；选择题：choice/question/answer/option1-option4；填空题：blank/front 中写 ____，back 写答案。</p>
        <button className="primary-button"><FileSpreadsheet />开始导入</button>
      </form>
    </section>
  );
}

function SettingsView(props: { settings: Settings; onSave: (settings: Partial<Settings>) => Promise<void>; onNotify: () => Promise<void> }) {
  return (
    <section className="panel settings-panel">
      <label>主题<select value={props.settings.theme} onChange={(event) => props.onSave({ theme: event.target.value as ThemeMode })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">暗黑</option></select></label>
      <label>默认发音语言<select value={props.settings.voiceLanguage} onChange={(event) => props.onSave({ voiceLanguage: event.target.value })}><option value="en-US">英语 en-US</option><option value="ja-JP">日语 ja-JP</option><option value="ko-KR">韩语 ko-KR</option><option value="fr-FR">法语 fr-FR</option><option value="de-DE">德语 de-DE</option></select></label>
      <label>每日新学目标<input type="number" min={0} value={props.settings.dailyNewGoal} onChange={(event) => props.onSave({ dailyNewGoal: Number(event.target.value) })} /></label>
      <button className="primary-button" onClick={props.onNotify}><Bell />开启浏览器通知</button>
      <div className="schedule-box"><h3>艾宾浩斯间隔</h3><p>5 分钟 · 30 分钟 · 12 小时 · 1 天 · 2 天 · 4 天 · 7 天 · 15 天 · 30 天 · 90 天</p></div>
    </section>
  );
}

function AboutView(props: { syncStatus: SyncStatus | null }) {
  return (
    <section className="panel about-panel">
      <div className="about-title"><Info /><div><p className="eyebrow">Xian 闪记卡</p><h2>版本 {version}</h2></div></div>
      <div className="schedule-box"><h3>更新日志</h3><p>新增选择题卡、填空题卡、每日任务、连续打卡、按大卡组复习、同步按钮、自动同步和冲突处理。</p></div>
      <div className="schedule-box"><h3>同步状态</h3><p>最近同步：{props.syncStatus ? fullDateTime(props.syncStatus.lastSyncAt) : "暂无"} · 数据更新：{props.syncStatus?.dataUpdatedAt ? fullDateTime(props.syncStatus.dataUpdatedAt) : "暂无"}</p></div>
    </section>
  );
}

function CardDetail(props: { card: Card; onClose: () => void }) {
  const choices = parseChoices(props.card.choices);
  return (
    <div className="modal-backdrop">
      <section className="modal-panel">
        <div className="modal-title"><h2>{props.card.front}</h2><button className="mini-button" onClick={props.onClose}><XCircle /></button></div>
        <div className="detail-grid">
          <Detail label="类型" value={cardTypeLabels[props.card.card_type]} />
          <Detail label="答案" value={props.card.back} />
          <Detail label="阶段" value={`${props.card.stage}/10`} />
          <Detail label="下次复习" value={fullDateTime(props.card.due_at)} />
          <Detail label="相对时间" value={dueText(props.card.due_at)} />
          <Detail label="音标" value={props.card.phonetic || "无"} />
          <Detail label="例句" value={props.card.example || "无"} />
          <Detail label="助记" value={props.card.mnemonic || "无"} />
          <Detail label="选项" value={choices.length ? choices.join(" / ") : "无"} />
          <Detail label="备注" value={props.card.note || "无"} />
        </div>
      </section>
    </div>
  );
}

function Detail(props: { label: string; value: string }) {
  return <div className="detail-item"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function ConflictDialog(props: { conflict: { id: number; payload: CardPayload; serverCard: Card }; onKeepServer: () => Promise<void>; onOverwrite: () => Promise<void> }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-panel">
        <div className="modal-title"><h2><AlertTriangle />同步冲突</h2></div>
        <p className="hint">这张卡片已在其他设备修改。请选择保留服务器版本，或用本机编辑覆盖。</p>
        <div className="conflict-grid">
          <div><h3>服务器版本</h3><p>{props.conflict.serverCard.front}</p><small>{props.conflict.serverCard.back}</small></div>
          <div><h3>本机编辑</h3><p>{props.conflict.payload.front}</p><small>{props.conflict.payload.back}</small></div>
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
