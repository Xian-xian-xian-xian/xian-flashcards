import {
  AlertTriangle,
  ArrowLeft,
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
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Moon,
  MoveRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareCheck,
  Star,
  Sun,
  Target,
  Trash2,
  User as UserIcon,
  Volume2,
  XCircle
} from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import { api, type CardPayload, type ConflictError } from "./api";
import type { Card, CardType, DailyTask, Deck, ReviewRating, ReviewSnapshot, Settings, Stats, SyncStatus, ThemeMode, User } from "./types";

type View = "home" | "deck" | "study" | "import" | "settings" | "about";
type SyncState = "idle" | "syncing" | "success" | "error" | "conflict";

const version = "0.2.4";

const cardTypeLabels: Record<CardType, string> = {
  basic: "普通卡",
  word: "单词卡",
  choice: "选择题卡",
  blank: "填空题卡"
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

function optionKey(value: string) {
  const normalized = normalizeAnswer(value);
  const match = normalized.match(/^([a-h])(?:[\s.)、:：-]+|$)/i);
  return match?.[1] ?? normalized;
}

function answersMatch(choice: string, answer: string) {
  return normalizeAnswer(choice) === normalizeAnswer(answer) || optionKey(choice) === optionKey(answer);
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

function blankPrompt(value: string) {
  return value.replace(/_{2,}|\[\s*\]/g, "[]");
}

function isWordCard(card: Card) {
  return card.card_type === "word";
}

function correctAnswer(card: Card) {
  return card.back;
}

function isCorrectAnswer(card: Card, answer: string) {
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
    autoSpeak: "off",
    dailyNewGoal: 20,
    studyTextScale: 1
  });
  const [dailyTask, setDailyTask] = useState<DailyTask>(emptyDailyTask);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
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

  function speak(text: string, language?: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language ?? selectedDeck?.language ?? settings.voiceLanguage;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  async function handleAnswer(card: Card, rating: ReviewRating) {
    try {
      const result = await api.answer(card.id, rating);
      await afterMutation(`${card.front}：${ratingLabels[rating]}`);
      return result;
    } catch (error) {
      showToast((error as Error).message, "error");
      throw error;
    }
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
            onSelectRootDeck={setStudyRootDeckId}
            selectedDeck={studyRootDeck}
            studyTextScale={settings.studyTextScale}
            onStudyTextScale={async (studyTextScale) => {
              await api.saveSettings({ studyTextScale });
              setSettings((current) => ({ ...current, studyTextScale }));
            }}
            autoSpeak={settings.autoSpeak === "on"}
            onAnswer={handleAnswer}
            onUndoAnswer={async (card, snapshot) => {
              try {
                await api.restoreReview(card.id, snapshot);
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
          <button className="icon-button strong" title="创建卡组" disabled={busy === "create-deck"}><Plus /></button>
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
      <input value={front} onChange={(event) => setFront(event.target.value)} placeholder="正面 / 题目，填空题使用 [] 表示空格" />
      <input value={back} onChange={(event) => setBack(event.target.value)} placeholder="背面 / 正确答案" />
      <button className="primary-button secondary-button" type="button" onClick={() => setAdvancedOpen((value) => !value)}><SlidersHorizontal />高级字段</button>
      {advancedOpen && (
        <div className="advanced-fields">
          <input value={choices} onChange={(event) => setChoices(event.target.value)} placeholder="选择题选项，用 | 分隔；填写后自动识别为选择题" />
          <input value={phonetic} onChange={(event) => setPhonetic(event.target.value)} placeholder="音标（可选）" />
          <input value={example} onChange={(event) => setExample(event.target.value)} placeholder="例句 / 说明 / 解析（可选）" />
          <input value={mnemonic} onChange={(event) => setMnemonic(event.target.value)} placeholder="助记（可选）" />
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注（可选）" />
        </div>
      )}
      <button className="primary-button" disabled={saving}>{props.card ? <Save /> : <Plus />}{saving ? "处理中" : props.card ? "保存" : "添加"}</button>
      {props.onCancel && <button className="primary-button secondary-button" type="button" disabled={saving} onClick={props.onCancel}><XCircle />取消</button>}
    </form>
  );
}

function StudyView(props: {
  cards: Card[];
  rootDecks: Deck[];
  selectedRootDeckId: number | null;
  onSelectRootDeck: (id: number) => void;
  selectedDeck?: Deck;
  studyTextScale: number;
  onStudyTextScale: (scale: number) => Promise<void>;
  autoSpeak: boolean;
  onAnswer: (card: Card, rating: ReviewRating) => Promise<{ stage: number; dueAt: string; previous: ReviewSnapshot }>;
  onUndoAnswer: (card: Card, snapshot: ReviewSnapshot) => Promise<void>;
  onUpdateCard: (id: number, payload: CardPayload) => Promise<void>;
  onSpeak: (text: string, language?: string) => void;
}) {
  const [studyKind, setStudyKind] = useState<"review" | "new">("review");
  const [sessionLimit, setSessionLimit] = useState(20);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [queue, setQueue] = useState<Card[]>([]);
  const [masteredIds, setMasteredIds] = useState<number[]>([]);
  const [history, setHistory] = useState<Array<{
    card: Card;
    previous: ReviewSnapshot;
    queue: Card[];
    masteredIds: number[];
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
  const [immersive, setImmersive] = useState(false);
  const card = queue[0];

  useEffect(() => {
    startSession().catch((error) => console.error(error));
  }, [studyKind, props.selectedRootDeckId]);

  useEffect(() => {
    setFlipped(false);
    setAnswer("");
    setChecked(null);
    setSelectedChoice("");
    setEditingStudyCard(null);
    if (props.autoSpeak && card && isWordCard(card)) props.onSpeak(card.front, card.language ?? props.selectedDeck?.language);
  }, [card?.id, props.autoSpeak]);

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

  async function startSession(nextLimit = sessionLimit) {
    if (!props.selectedRootDeckId || busy) return;
    setBusy("session");
    try {
      const nextCards = await api.dueCards(props.selectedRootDeckId, Math.max(1, nextLimit), studyKind);
      setSessionCards(nextCards);
      setQueue(nextCards);
      setMasteredIds([]);
      setHistory([]);
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice("");
      setEditingStudyCard(null);
    } finally {
      setBusy("");
    }
  }

  async function rate(rating: ReviewRating) {
    if (!card || busy) return;
    setBusy(`rate-${rating}`);
    const beforeQueue = queue;
    const beforeMasteredIds = masteredIds;
    try {
      const result = await props.onAnswer(card, rating);
      const rest = beforeQueue.slice(1);
      const nextMasteredIds = rating === "known" && !beforeMasteredIds.includes(card.id)
        ? [...beforeMasteredIds, card.id]
        : beforeMasteredIds;
      const repeatCard = { ...card, stage: result.stage, due_at: result.dueAt, last_rating: rating };
      const nextQueue = rating === "known"
        ? rest
        : [...rest.slice(0, rating === "unknown" ? 1 : 3), repeatCard, ...rest.slice(rating === "unknown" ? 1 : 3)];
      setHistory((items) => [...items, { card, previous: result.previous, queue: beforeQueue, masteredIds: beforeMasteredIds, flipped, answer, checked, selectedChoice }]);
      setQueue(nextQueue);
      setMasteredIds(nextMasteredIds);
      setFlipped(false);
      setAnswer("");
      setChecked(null);
      setSelectedChoice("");
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    const previous = history.at(-1);
    if (!previous || busy) return;
    setBusy("undo");
    try {
      await props.onUndoAnswer(previous.card, previous.previous);
      setHistory((items) => items.slice(0, -1));
      setQueue(previous.queue);
      setMasteredIds(previous.masteredIds);
      setFlipped(previous.flipped);
      setAnswer(previous.answer);
      setChecked(previous.checked);
      setSelectedChoice(previous.selectedChoice);
    } finally {
      setBusy("");
    }
  }

  function checkWritten() {
    if (!card) return;
    setSelectedChoice("");
    setChecked(isCorrectAnswer(card, answer) ? "right" : "wrong");
  }

  function checkChoice(choice: string) {
    if (!card || checked) return;
    setSelectedChoice(choice);
    setChecked(answersMatch(choice, card.back) ? "right" : "wrong");
  }

  const choices = useMemo(() => {
    if (!card) return [];
    const baseChoices = parseChoices(card.choices);
    const source = card.card_type === "choice"
      ? baseChoices.some((choice) => answersMatch(choice, card.back)) ? baseChoices : [...baseChoices, card.back]
      : sessionCards.filter((item) => item.id !== card.id).slice(0, 3).map((item) => item.back).concat(card.back);
    return source.sort(() => 0.5 - Math.random());
  }, [card?.id, sessionCards]);

  const displayCorrect = card ? choices.find((choice) => answersMatch(choice, card.back)) ?? card.back : "";

  const completed = masteredIds.length;
  const total = sessionCards.length;
  const explanation = card ? [card.example, card.note].filter(Boolean).join(" · ") : "";
  const showManualRatings = card ? card.card_type !== "choice" && card.card_type !== "blank" || checked !== null : false;
  const scale = scaleDraft;
  const studyStyle = {
    "--study-face-min": `${Math.round(32 * scale)}px`,
    "--study-face-max": `${Math.round(72 * scale)}px`,
    "--study-word-min": `${Math.round(38 * scale)}px`,
    "--study-word-max": `${Math.round(72 * scale)}px`,
    "--study-phonetic-min": `${Math.round(18 * scale)}px`,
    "--study-phonetic-max": `${Math.round(28 * scale)}px`,
    "--study-back-min": `${Math.round(22 * scale)}px`,
    "--study-back-max": `${Math.round(34 * scale)}px`,
    "--study-small-size": `${Math.round(16 * scale)}px`,
    "--study-question-size": `${Math.round(24 * scale)}px`,
    "--study-choice-size": `${Math.round(16 * scale)}px`,
    "--study-result-size": `${Math.round(16 * scale)}px`
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

  async function toggleImmersive() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      setImmersive(false);
      return;
    }
    await document.documentElement.requestFullscreen?.().catch(() => undefined);
    setImmersive(true);
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
          <div className="mode-tabs compact-tabs">
            <button className={studyKind === "review" ? "active" : ""} onClick={() => setStudyKind("review")}>复习</button>
            <button className={studyKind === "new" ? "active" : ""} onClick={() => setStudyKind("new")}>新学</button>
          </div>
          <label>
            {studyKind === "new" ? "新学张数" : "复习张数"}
            <input type="number" min={1} max={200} value={sessionLimit} onChange={(event) => {
              const next = Math.max(1, Number(event.target.value) || 1);
              setSessionLimit(next);
            }} />
          </label>
          <button className="primary-button" disabled={busy === "session"} onClick={() => startSession()}><Sparkles />{busy === "session" ? "载入中" : "开始"}</button>
        </div>
      </div>

      {!card ? <EmptyState text={total > 0 ? "本轮已完成。" : studyKind === "new" ? "这个大卡组暂无可新学卡片。" : "这个大卡组暂无到期复习卡片。"} /> : (
        <div className="study-panel" style={studyStyle}>
          <div className="progress-line">
            <span>{completed}</span>
            <div><i style={{ width: `${Math.min((completed / Math.max(total, 1)) * 100, 100)}%` }} /></div>
            <span>{total}</span>
          </div>
          <div className="study-actions">
            <span className="type-pill">{cardTypeLabels[card.card_type]}</span>
            <span className="type-pill">待掌握 {queue.length}</span>
            <label className="study-scale-control" title="学习字号">
              <SlidersHorizontal />
              <input type="range" min={0.85} max={1.35} step={0.05} value={scaleDraft} onChange={(event) => saveScale(Number(event.target.value))} />
              <strong>{scaleSaving ? "保存中" : `${Math.round(scaleDraft * 100)}%`}</strong>
            </label>
            <button className="mini-button" title={immersive ? "退出沉浸学习" : "沉浸学习"} onClick={toggleImmersive}>{immersive ? <Minimize2 /> : <Maximize2 />}</button>
            <button className="mini-button" title="撤销上一张" disabled={history.length === 0 || Boolean(busy)} onClick={undo}><ArrowLeft /></button>
            <button className="mini-button" title="编辑当前卡片" onClick={() => setEditingStudyCard(card)}><Edit3 /></button>
            <button className="mini-button" title="发音" onClick={() => props.onSpeak(card.front, card.language ?? props.selectedDeck?.language)}><Volume2 /></button>
          </div>
          {editingStudyCard && <CardEditor card={editingStudyCard} onCancel={() => setEditingStudyCard(null)} onSubmit={async (payload) => { await props.onUpdateCard(editingStudyCard.id, { ...payload, baseUpdatedAt: editingStudyCard.updated_at }); setEditingStudyCard(null); }} />}
          {card.card_type !== "choice" && card.card_type !== "blank" && (
            <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((value) => !value)}>
              {flipped ? <CardBack card={card} /> : <CardFront card={card} />}
            </button>
          )}
          {card.card_type === "choice" && (
            <div className="question-box">
              <p>{card.front}</p>
              <ChoiceGrid choices={choices} answer={card.back} selected={selectedChoice} checked={checked} onChoose={checkChoice} />
              {checked && <AnswerFeedback checked={checked} correct={displayCorrect} explanation={explanation} selected={selectedChoice} />}
            </div>
          )}
          {card.card_type === "blank" && (
            <div className="question-box">
              <p>{blankPrompt(card.front)}</p>
              {card.example && <small>{card.example}</small>}
              <input value={answer} onChange={(event) => { setAnswer(event.target.value); setChecked(null); }} placeholder="输入答案" />
              <button className="primary-button" disabled={Boolean(busy)} onClick={checkWritten}>检查</button>
              {checked && <AnswerFeedback checked={checked} correct={correctAnswer(card)} explanation={explanation} selected={answer} />}
            </div>
          )}
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

function CardFront(props: { card: Card }) {
  if (props.card.card_type === "blank") return <span>{blankPrompt(props.card.front)}</span>;
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

function ChoiceGrid(props: { choices: string[]; answer: string; selected: string; checked: "right" | "wrong" | null; onChoose: (choice: string) => void }) {
  return (
    <div className="choice-grid">
      {props.choices.map((choice, index) => {
        const isSelected = choice === props.selected;
        const isAnswer = answersMatch(choice, props.answer);
        const state = props.checked && (isAnswer ? "correct" : isSelected ? "wrong" : "");
        return (
          <button
            className={state}
            disabled={props.checked !== null}
            key={`${choice}-${index}`}
            onClick={() => props.onChoose(choice)}
          >
            {choice}
          </button>
        );
      })}
    </div>
  );
}

function AnswerFeedback(props: { checked: "right" | "wrong"; correct: string; explanation: string; selected: string }) {
  const right = props.checked === "right";
  return (
    <div className={`result ${right ? "right" : "wrong"}`}>
      <strong>{right ? "回答正确" : "回答错误"}</strong>
      {!right && props.selected && <span>你的答案：{props.selected}</span>}
      <span>正确答案：{props.correct}</span>
      {props.explanation && <small>解析：{props.explanation}</small>}
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

function SettingsView(props: { settings: Settings; onSave: (settings: Partial<Settings>) => Promise<void>; onNotify: () => Promise<void>; saving: boolean; notifying: boolean }) {
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

  return (
    <form className="panel settings-panel" onSubmit={save}>
      <label>主题<select value={draft.theme} onChange={(event) => updateDraft({ theme: event.target.value as ThemeMode })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">暗黑</option></select></label>
      <label>默认发音语言<select value={draft.voiceLanguage} onChange={(event) => updateDraft({ voiceLanguage: event.target.value })}><option value="en-US">英语 en-US</option><option value="ja-JP">日语 ja-JP</option><option value="ko-KR">韩语 ko-KR</option><option value="fr-FR">法语 fr-FR</option><option value="de-DE">德语 de-DE</option></select></label>
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
      <div className="about-title"><Info /><div><p className="eyebrow">Xian 闪记卡</p><h2>版本 {version}</h2></div></div>
      <div className="schedule-box changelog-box">
        <h3>更新日志</h3>
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
