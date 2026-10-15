(function () {
  "use strict";

  const STORAGE_KEY = "xianTomatoBaseStateV2";
  const SYNC_META_KEY = "xianTomatoBaseSyncV1";
  const SYNC_BACKUP_KEY = "xianTomatoBaseBeforeSyncV1";
  const LEGACY_STORAGE_KEY = "tomatoCabinStateV1";
  const STORAGE_UPGRADE_KEY = "xianTomatoBaseV2Initialized";
  const REMOTE_STATE_ENDPOINT = "/api/tomatoes/state";
  const AUTH_STATUS_ENDPOINT = "/api/auth/status";
  const DEFAULT_POMODORO_MINUTES = 25;
  const MIN_POMODORO_MINUTES = 1;
  const MAX_POMODORO_MINUTES = 180;
  const POMODORO_SECONDS = DEFAULT_POMODORO_MINUTES * 60;
  const BREAK_SECONDS = 5 * 60;
  const REVIEW_UNLOCK_SECONDS = 2 * 60;
  const WEIGHT_MINUTES = 25;
  const TOMATO_WEIGHTS = {
    "完美的🍅": 1,
    "被啃了一口🍅": 0.7,
    "有小瑕疵🍅": 0.9,
    "有大瑕疵🍅": 0.8,
    "半个🍅": 0.5
  };
  const DEFAULT_CLIPBOARD_FORMAT = {
    delimiter: " | ",
    keywordCase: "upper",
    fields: {
      marker: true,
      content: true,
      energyMood: true,
      status: true,
      total: true
    }
  };
  const QUOTES = [
    "不用一下子很厉害，今天先种下一个番茄。",
    "你不是没进步，只是进步正在累计。",
    "先开始 25 分钟，剩下的交给惯性。",
    "今天只要比昨天多一点点，就算赢。",
    "别急，稳定的人最后会很强。",
    "感觉慢也没关系，能回来继续就很好。",
    "把注意力放回眼前这一小步，就够了。",
    "休息不是退后，是为了更安稳地继续。"
  ];

  let appState = loadState();
  let timerInterval = null;
  let currentQuote = "";
  let breakMinutesDirty = false;
  let homeColumnSyncFrame = null;
  let selectedRecordsDate = dateISO();
  let remoteHydratePromise = null;
  let syncUsername = null;
  let remoteStateReady = false;
  let remoteStateRevision = null;
  let lastSyncedState = null;
  let remoteSaveTimer = null;
  let remoteSavePromise = null;
  let remoteSavePending = false;
  let pendingRecordReplacement = false;
  let fullscreenRestoreFocus = null;

  const $ = (id) => document.getElementById(id);

  const elements = {
    siteTitle: $("siteTitle"),
    todayLabel: $("todayLabel"),
    nearestGoalSummary: $("nearestGoalSummary"),
    currentUserLabel: $("currentUserLabel"),
    syncNowBtn: $("syncNowBtn"),
    notificationBtn: $("notificationBtn"),
    themeToggle: $("themeToggle"),
    fullscreenBtn: $("fullscreenBtn"),
    fullscreenView: $("fullscreenView"),
    fullscreenExitBtn: $("fullscreenExitBtn"),
    fullscreenDate: $("fullscreenDate"),
    fullscreenClock: $("fullscreenClock"),
    fullscreenTomatoCount: $("fullscreenTomatoCount"),
    fullscreenTimerDisplay: $("fullscreenTimerDisplay"),
    fullscreenTimerStatus: $("fullscreenTimerStatus"),
    fullscreenStartForm: $("fullscreenStartForm"),
    fullscreenStartBtn: $("fullscreenStartBtn"),
    fullscreenCheckInForm: $("fullscreenCheckInForm"),
    fullscreenTaskGoalSelect: $("fullscreenTaskGoalSelect"),
    fullscreenTaskGoalInput: $("fullscreenTaskGoalInput"),
    fullscreenStartBatteryInput: $("fullscreenStartBatteryInput"),
    fullscreenStartMoodInput: $("fullscreenStartMoodInput"),
    fullscreenBreakForm: $("fullscreenBreakForm"),
    fullscreenBreakMinutesInput: $("fullscreenBreakMinutesInput"),
    fullscreenActionRow: $("fullscreenActionRow"),
    fullscreenPauseBtn: $("fullscreenPauseBtn"),
    fullscreenReviewBtn: $("fullscreenReviewBtn"),
    fullscreenEarlyFinishBtn: $("fullscreenEarlyFinishBtn"),
    fullscreenResetBtn: $("fullscreenResetBtn"),
    timerDisplay: $("timerDisplay"),
    timerStatus: $("timerStatus"),
    durationBadge: $("durationBadge"),
    startBtn: $("startBtn"),
    startForm: $("startForm"),
    checkInForm: $("checkInForm"),
    taskGoalSelect: $("taskGoalSelect"),
    taskGoalInput: $("taskGoalInput"),
    startBatteryInput: $("startBatteryInput"),
    startMoodInput: $("startMoodInput"),
    breakForm: $("breakForm"),
    breakMinutesInput: $("breakMinutesInput"),
    timerActionRow: $("timerActionRow"),
    saveCheckInBtn: $("saveCheckInBtn"),
    timerControls: $("timerControls"),
    pauseBtn: $("pauseBtn"),
    reviewBtn: $("reviewBtn"),
    earlyFinishBtn: $("earlyFinishBtn"),
    resetBtn: $("resetBtn"),
    todayTargetForm: $("todayTargetForm"),
    todayTargetInput: $("todayTargetInput"),
    targetText: $("targetText"),
    targetProgressText: $("targetProgressText"),
    targetProgressBar: $("targetProgressBar"),
    targetEncourage: $("targetEncourage"),
    recordsTitle: $("recordsTitle"),
    recordsDateInput: $("recordsDateInput"),
    recordsBody: $("recordsBody"),
    recordsEmpty: $("recordsEmpty"),
    exportCsvBtn: $("exportCsvBtn"),
    statsGrid: $("statsGrid"),
    gentleQuote: $("gentleQuote"),
    newQuoteBtn: $("newQuoteBtn"),
    addLongGoalBtn: $("addLongGoalBtn"),
    longGoalsList: $("longGoalsList"),
    longGoalsEmpty: $("longGoalsEmpty"),
    tasksBody: $("tasksBody"),
    tasksEmpty: $("tasksEmpty"),
    addTaskBtn: $("addTaskBtn"),
    latestCopyPanel: $("latestCopyPanel"),
    latestCopyText: $("latestCopyText"),
    copyLatestBtn: $("copyLatestBtn"),
    copyFormatForm: $("copyFormatForm"),
    copyDelimiterInput: $("copyDelimiterInput"),
    copyKeywordCaseSelect: $("copyKeywordCaseSelect"),
    clipboardHistory: $("clipboardHistory"),
    clipboardEmpty: $("clipboardEmpty"),
    exportJsonBtn: $("exportJsonBtn"),
    importJsonInput: $("importJsonInput"),
    clearDataBtn: $("clearDataBtn"),
    finishModal: $("finishModal"),
    finishForm: $("finishForm"),
    finishModalTip: $("finishModalTip"),
    finishSubmitBtn: $("finishSubmitBtn"),
    completionInput: $("completionInput"),
    completionPercentInput: $("completionPercentInput"),
    endBatteryInput: $("endBatteryInput"),
    endMoodInput: $("endMoodInput"),
    tomatoStatusInput: $("tomatoStatusInput"),
    relatedTaskInput: $("relatedTaskInput"),
    finishRemarkInput: $("finishRemarkInput"),
    continuationBreakMinutesInput: $("continuationBreakMinutesInput"),
    nextPomodoroMinutesInput: $("nextPomodoroMinutesInput"),
    durationModal: $("durationModal"),
    durationForm: $("durationForm"),
    durationModalTip: $("durationModalTip"),
    pomodoroMinutesInput: $("pomodoroMinutesInput"),
    recordModal: $("recordModal"),
    recordForm: $("recordForm"),
    editRecordId: $("editRecordId"),
    editCompletionInput: $("editCompletionInput"),
    editCompletionPercentInput: $("editCompletionPercentInput"),
    editStartTimeInput: $("editStartTimeInput"),
    editEndTimeInput: $("editEndTimeInput"),
    editStartBatteryInput: $("editStartBatteryInput"),
    editEndBatteryInput: $("editEndBatteryInput"),
    editStartMoodInput: $("editStartMoodInput"),
    editEndMoodInput: $("editEndMoodInput"),
    editTomatoStatusInput: $("editTomatoStatusInput"),
    editRelatedTaskInput: $("editRelatedTaskInput"),
    editRemarkInput: $("editRemarkInput"),
    taskModal: $("taskModal"),
    taskForm: $("taskForm"),
    taskIdInput: $("taskIdInput"),
    recentTaskNameInput: $("recentTaskNameInput"),
    estimatedTomatoesInput: $("estimatedTomatoesInput"),
    progressPercentInput: $("progressPercentInput"),
    recentTaskRemarkInput: $("recentTaskRemarkInput"),
    longGoalModal: $("longGoalModal"),
    longGoalForm: $("longGoalForm"),
    longGoalIdInput: $("longGoalIdInput"),
    longGoalNameInput: $("longGoalNameInput"),
    longGoalDateInput: $("longGoalDateInput"),
    longGoalRemarkInput: $("longGoalRemarkInput"),
    toastStack: $("toastStack")
  };

  init();

  function init() {
    fillTomatoSelect(elements.tomatoStatusInput);
    fillTomatoSelect(elements.editTomatoStatusInput);
    bindEvents();
    setRandomQuote();
    reconcileActiveTimer();
    hydrateActiveForm();
    applyTheme();
    renderAll();
    startTimerLoop();
    hydrateRemoteState();
  }

  function defaultState() {
    return {
      settings: {
        todayTargetTomatoes: 8,
        theme: "light",
        pomodoroMinutes: DEFAULT_POMODORO_MINUTES,
        clipboardFormat: defaultClipboardFormat()
      },
      activePomodoro: null,
      records: [],
      recentTasks: [],
      longTermGoals: [],
      clipboardHistory: []
    };
  }

  function loadState() {
    try {
      if (localStorage.getItem(STORAGE_UPGRADE_KEY) !== "1") {
        const existingState = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
        const migratedState = normalizeState(existingState ? JSON.parse(existingState) : null);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedState));
        localStorage.setItem(STORAGE_UPGRADE_KEY, "1");
        return migratedState;
      }
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return normalizeState(parsed);
    } catch (error) {
      return defaultState();
    }
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    raw = JSON.parse(JSON.stringify(raw), (key, value) => ["__proto__", "prototype", "constructor"].includes(key) ? undefined : value);
    const state = {
      settings: Object.assign({}, base.settings, raw.settings || {}),
      activePomodoro: raw.activePomodoro || null,
      records: Array.isArray(raw.records) ? raw.records : [],
      recentTasks: Array.isArray(raw.recentTasks) ? raw.recentTasks : [],
      longTermGoals: Array.isArray(raw.longTermGoals) ? raw.longTermGoals : [],
      clipboardHistory: Array.isArray(raw.clipboardHistory) ? raw.clipboardHistory.slice(0, 10) : []
    };
    state.settings.clipboardFormat = normalizeClipboardFormat(state.settings.clipboardFormat);
    state.settings.pomodoroMinutes = normalizeWholeMinutes(
      state.settings.pomodoroMinutes,
      DEFAULT_POMODORO_MINUTES,
      MIN_POMODORO_MINUTES,
      MAX_POMODORO_MINUTES
    );
    state.records = state.records.map((record) => ({
      ...record,
      tomatoWeight: Number(record.tomatoWeight ?? TOMATO_WEIGHTS[record.tomatoStatus] ?? 0),
      completionPercent: clampPercent(Number(record.completionPercent ?? parsePercent(record.completionContent)))
    }));
    state.recentTasks = state.recentTasks.map((task) => normalizeTask(task, state.records));
    state.clipboardHistory = state.clipboardHistory.map(normalizeClipboardEntry);
    if (state.activePomodoro) {
      state.activePomodoro.phase = state.activePomodoro.phase || (state.activePomodoro.status === "awaitingSubmission" ? "complete" : "focus");
      state.activePomodoro.durationSeconds = normalizeDurationSeconds(
        state.activePomodoro.durationSeconds,
        state.settings.pomodoroMinutes * 60
      );
      state.activePomodoro.breakDurationSeconds = Number(state.activePomodoro.breakDurationSeconds) || BREAK_SECONDS;
      state.activePomodoro.checkInSaved = state.activePomodoro.checkInSaved ?? Boolean(state.activePomodoro.taskGoal && state.activePomodoro.startBattery !== null && state.activePomodoro.startMood !== null);
      state.activePomodoro.relatedTaskId = state.activePomodoro.relatedTaskId || "";
      state.activePomodoro.focusSoundCuesPlayed = Array.isArray(state.activePomodoro.focusSoundCuesPlayed)
        ? state.activePomodoro.focusSoundCuesPlayed
        : [];
      state.activePomodoro.autoContinue = Boolean(
        state.activePomodoro.autoContinue && Number(state.activePomodoro.nextPomodoroDurationSeconds) > 0
      );
      state.activePomodoro.nextPomodoroDurationSeconds = state.activePomodoro.autoContinue
        ? normalizeDurationSeconds(state.activePomodoro.nextPomodoroDurationSeconds, state.settings.pomodoroMinutes * 60)
        : null;
    }
    return state;
  }

  function normalizeTask(task, records) {
    const estimated = Number(task.estimatedTomatoes) || 0;
    let progressPercent = Number(task.progressPercent);
    if (!Number.isFinite(progressPercent)) {
      const linked = records.filter((record) => record.relatedTaskId === task.id);
      const completed = (Number(task.manualCompleted) || 0) + sumWeight(linked);
      progressPercent = estimated > 0 ? completed / estimated * 100 : 0;
    }
    return {
      ...task,
      estimatedTomatoes: estimated,
      progressPercent: clampPercent(progressPercent)
    };
  }

  function defaultClipboardFormat() {
    return {
      delimiter: DEFAULT_CLIPBOARD_FORMAT.delimiter,
      keywordCase: DEFAULT_CLIPBOARD_FORMAT.keywordCase,
      fields: { ...DEFAULT_CLIPBOARD_FORMAT.fields }
    };
  }

  function normalizeClipboardFormat(raw) {
    const defaults = defaultClipboardFormat();
    if (!raw || typeof raw !== "object") return defaults;
    const delimiter = typeof raw.delimiter === "string" ? raw.delimiter : defaults.delimiter;
    const keywordCase = raw.keywordCase === "lower" ? "lower" : "upper";
    const rawFields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
    return {
      delimiter,
      keywordCase,
      fields: Object.keys(defaults.fields).reduce((fields, key) => {
        fields[key] = rawFields[key] === undefined ? defaults.fields[key] : Boolean(rawFields[key]);
        return fields;
      }, {})
    };
  }

  function normalizeClipboardEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return {
        id: uid(),
        type: "TEXT",
        text: "",
        createdAt: new Date().toISOString()
      };
    }
    const normalized = {
      ...entry,
      id: entry.id || uid(),
      type: entry.type || "TEXT",
      text: typeof entry.text === "string" ? entry.text : "",
      createdAt: entry.createdAt || new Date().toISOString()
    };
    if (!normalized.data && normalized.text) {
      normalized.data = parseClipboardText(normalized.text, normalized.type, normalized.createdAt);
    }
    return normalized;
  }

  function parseClipboardText(text, type, createdAt) {
    if (type === "GO") {
      const match = text.match(/^(\d+)GO\s*\|\s*(.*?)\s*\|\s*🔋([\d.]+)\s*😊([\d.]+)$/);
      if (!match) return null;
      return {
        no: Number(match[1]),
        content: match[2],
        startBattery: Number(match[3]),
        startMood: Number(match[4])
      };
    }
    if (type === "BACK") {
      const match = text.match(/^(\d+)BACK\s*\|\s*(.*?)\s+([\d.]+)%\s*\|\s*🔋([\d.]+)→([\d.]+)\s*😊([\d.]+)→([\d.]+)\s*\|\s*(.*?)\s*\|\s*合计[\d.]+个🍅$/);
      if (!match) return null;
      const remarkMatch = match[8].match(/^(.*)（(.*)）$/);
      return {
        no: Number(match[1]),
        content: match[2],
        completionPercent: Number(match[3]),
        startBattery: Number(match[4]),
        endBattery: Number(match[5]),
        startMood: Number(match[6]),
        endMood: Number(match[7]),
        tomatoStatus: remarkMatch ? remarkMatch[1] : match[8],
        remark: remarkMatch ? remarkMatch[2] : "",
        date: dateISO(new Date(createdAt))
      };
    }
    return null;
  }

  function saveState(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    queueRemoteSave(false, options.allowRecordReplacement === true);
  }

  function readSyncMeta() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_META_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function rememberSyncedState(state) {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify({ username: syncUsername, state }));
    lastSyncedState = cloneJson(state);
  }

  function backupBeforeSync() {
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      username: readSyncMeta()?.username || null,
      state: appState
    }));
  }

  function renderSiteIdentity(username) {
    const title = username ? `${username}的番茄基地` : "番茄基地";
    if (elements.siteTitle) elements.siteTitle.textContent = title;
    document.title = `${title} | 专注学习看板`;
    if (elements.currentUserLabel) elements.currentUserLabel.textContent = username ? `用户：${username}` : "未登录";
  }

  async function hydrateAuthStatus() {
    const response = await fetch(AUTH_STATUS_ENDPOINT, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("auth status unavailable");
    const status = await response.json();
    const username = status.user?.username || null;
    renderSiteIdentity(username);
    return username;
  }

  function requireLogin() {
    remoteStateReady = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    renderSiteIdentity(null);
    window.location.assign(`/tomatoes-login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  function mergeInitialState(local, remote, meta, username) {
    if (meta?.username && meta.username !== username) return cloneJson(remote);
    if (meta?.username === username && meta.state) {
      return mergeThreeWay(meta.state, local, remote);
    }
    // First upgrade: no baseline exists. Never infer deletions from absence.
    // Shared record IDs identify the owner of legacy local data.
    const remoteIds = new Set(remote.records.map((record) => record.id));
    const sameLegacyAccount = local.records.some((record) => remoteIds.has(record.id));
    if (!sameLegacyAccount && !meta?.username) return cloneJson(remote);
    const merged = cloneJson(remote);
    for (const key of ["records", "recentTasks", "longTermGoals", "clipboardHistory"]) {
      const items = new Map(remote[key].map((item) => [item.id, item]));
      for (const item of local[key]) {
        if (!items.has(item.id)) items.set(item.id, cloneJson(item));
      }
      merged[key] = [...items.values()];
    }
    merged.clipboardHistory.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const localTimer = local.activePomodoro;
    const remoteTimer = remote.activePomodoro;
    if (localTimer && (!remoteTimer || (localTimer.startedAt || "") > (remoteTimer.startedAt || ""))) {
      merged.activePomodoro = cloneJson(localTimer);
    }
    return merged;
  }

  async function hydrateRemoteState() {
    if (!isHttpPage()) return;
    if (remoteHydratePromise) return remoteHydratePromise;
    remoteHydratePromise = loadRemoteState();
    try {
      return await remoteHydratePromise;
    } finally {
      remoteHydratePromise = null;
    }
  }

  async function loadRemoteState() {
    remoteStateReady = false;
    try {
      const username = await hydrateAuthStatus();
      if (!username) {
        requireLogin();
        return;
      }
      const response = await fetch(REMOTE_STATE_ENDPOINT, { credentials: "include", cache: "no-store" });
      if (response.status === 401) {
        requireLogin();
        return;
      }
      if (!response.ok) throw new Error("remote state unavailable");
      const payload = await response.json();
      const meta = readSyncMeta();
      const remote = normalizeState(payload.state);
      // Read appState after the request: typing/timer events may have changed it.
      const newCloudAccount = !payload.state && meta?.username === username;
      const merged = normalizeState(newCloudAccount ? cloneJson(appState) : mergeInitialState(appState, remote, meta, username));
      backupBeforeSync(); // If storage is full, abort rather than discard local data.
      syncUsername = username;
      rememberSyncedState(remote);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      appState = merged;
      remoteStateRevision = Number.isInteger(payload.revision) ? payload.revision : 0;
      remoteStateReady = true;
      selectedRecordsDate = dateISO();
      reconcileActiveTimer();
      hydrateActiveForm();
      applyTheme();
      renderAll();
      if (!jsonEqual(appState, remote)) {
        setSyncLabel("待上传");
        queueRemoteSave(true);
      } else {
        setSyncLabel("已同步");
      }
    } catch (error) {
      remoteStateReady = false;
      setSyncLabel("同步失败");
      showToast("暂时无法同步，已保留本机数据。请检查网络或浏览器存储空间后重试。");
    }
  }

  function queueRemoteSave(immediate = false, allowRecordReplacement = false) {
    if (!remoteStateReady || !isHttpPage()) return;
    pendingRecordReplacement = pendingRecordReplacement || allowRecordReplacement;
    window.clearTimeout(remoteSaveTimer);
    remoteSaveTimer = window.setTimeout(saveRemoteState, immediate ? 0 : 600);
  }

  async function saveRemoteState() {
    if (!remoteStateReady) return false;
    window.clearTimeout(remoteSaveTimer);
    if (remoteSavePromise) {
      remoteSavePending = true;
      return remoteSavePromise;
    }
    const allowRecordReplacement = pendingRecordReplacement;
    pendingRecordReplacement = false;
    remoteSavePromise = performRemoteSave(allowRecordReplacement);
    const result = await remoteSavePromise;
    remoteSavePromise = null;
    if (remoteSavePending) {
      remoteSavePending = false;
      return saveRemoteState();
    }
    return result;
  }

  async function performRemoteSave(allowRecordReplacement, retryCount = 0) {
    try {
      setSyncLabel("同步中");
      const username = await hydrateAuthStatus();
      if (!username) {
        requireLogin();
        return false;
      }
      if (username !== syncUsername) {
        remoteStateReady = false;
        await hydrateRemoteState();
        return false;
      }
      const stateSnapshot = cloneJson(appState);
      const response = await fetch(REMOTE_STATE_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          state: stateSnapshot,
          baseRevision: remoteStateRevision,
          allowRecordReplacement
        })
      });
      if (response.status === 401) {
        requireLogin();
        return false;
      }
      if (response.status === 409) {
        const conflict = await response.json();
        if (!conflict.state || !Number.isInteger(conflict.revision)) throw new Error("invalid conflict response");
        const remoteState = normalizeState(conflict.state);
        const mergedState = normalizeState(mergeThreeWay(lastSyncedState, appState, remoteState));
        const hasLocalChanges = !jsonEqual(mergedState, remoteState);
        backupBeforeSync();
        appState = mergedState;
        remoteStateRevision = conflict.revision;
        rememberSyncedState(remoteState);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
        reconcileActiveTimer();
        hydrateActiveForm();
        applyTheme();
        renderAll();
        showToast(hasLocalChanges ? "检测到其他页面的新数据，已安全合并并重新同步。" : "检测到其他页面的新数据，已采用云端最新版本。");
        if (hasLocalChanges && retryCount < 2) {
          return performRemoteSave(allowRecordReplacement, retryCount + 1);
        }
        setSyncLabel(hasLocalChanges ? "同步失败" : "已同步");
        return !hasLocalChanges;
      }
      if (response.status === 422) {
        const blocked = await response.json().catch(() => null);
        showToast(blocked?.message || "检测到记录异常减少，云端已阻止覆盖。");
        setSyncLabel("已保护");
        return false;
      }
      if (!response.ok) throw new Error("remote save failed");
      const saved = await response.json();
      remoteStateRevision = Number.isInteger(saved.revision) ? saved.revision : remoteStateRevision;
      rememberSyncedState(stateSnapshot);
      if (!jsonEqual(appState, stateSnapshot)) remoteSavePending = true;
      setSyncLabel("已同步");
      return true;
    } catch (error) {
      // Local persistence remains available if the network is temporarily down.
      setSyncLabel("同步失败");
      return false;
    }
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function mergeThreeWay(base, local, remote) {
    if (jsonEqual(local, base)) return cloneJson(remote);
    if (jsonEqual(remote, base)) return cloneJson(local);
    if (Array.isArray(local) && Array.isArray(remote)) {
      const arraysHaveIds = [...local, ...remote, ...(Array.isArray(base) ? base : [])]
        .every((item) => item && typeof item === "object" && !Array.isArray(item) && item.id);
      if (!arraysHaveIds) return cloneJson(local);
      const baseById = new Map((Array.isArray(base) ? base : []).map((item) => [item.id, item]));
      const localById = new Map(local.map((item) => [item.id, item]));
      const remoteById = new Map(remote.map((item) => [item.id, item]));
      const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
      const merged = [];
      ids.forEach((id) => {
        const item = mergeThreeWay(baseById.get(id), localById.get(id), remoteById.get(id));
        if (item !== undefined) merged.push(item);
      });
      return merged;
    }
    if (local && remote && typeof local === "object" && typeof remote === "object" && !Array.isArray(local) && !Array.isArray(remote)) {
      const baseObject = base && typeof base === "object" && !Array.isArray(base) ? base : {};
      const merged = {};
      new Set([...Object.keys(baseObject), ...Object.keys(local), ...Object.keys(remote)]).forEach((key) => {
        if (["__proto__", "prototype", "constructor"].includes(key)) return;
        const value = mergeThreeWay(baseObject[key], local[key], remote[key]);
        if (value !== undefined) merged[key] = value;
      });
      return merged;
    }
    return cloneJson(local);
  }

  async function syncNow() {
    if (!isHttpPage()) {
      showToast("本地文件模式下无法同步，请从线上地址打开。");
      return;
    }
    // Manual sync must pull and merge first, even if this page was once online.
    // Wait for our pending write so its acknowledgement cannot race hydration.
    if (remoteSavePromise) await remoteSavePromise;
    await hydrateRemoteState();
    if (!remoteStateReady) return;
    const ok = await saveRemoteState();
    showToast(ok ? "已同步到当前登录用户。" : "同步失败，请稍后再试。");
  }

  function setSyncLabel(text) {
    if (!elements.syncNowBtn) return;
    elements.syncNowBtn.textContent = text;
    if (text !== "同步") {
      window.clearTimeout(elements.syncNowBtn._syncLabelTimer);
      elements.syncNowBtn._syncLabelTimer = window.setTimeout(() => {
        elements.syncNowBtn.textContent = "同步";
      }, 1800);
    }
  }

  function isHttpPage() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function hydrateActiveForm() {
    const active = appState.activePomodoro;
    if (!active || active.phase !== "focus") return;
    elements.taskGoalSelect.value = active.relatedTaskId || "";
    elements.fullscreenTaskGoalSelect.value = active.relatedTaskId || "";
    elements.taskGoalInput.value = active.taskGoal || "";
    elements.fullscreenTaskGoalInput.value = active.taskGoal || "";
    elements.startBatteryInput.value = active.startBattery === null ? "" : trimNumber(active.startBattery);
    elements.fullscreenStartBatteryInput.value = active.startBattery === null ? "" : trimNumber(active.startBattery);
    elements.startMoodInput.value = active.startMood === null ? "" : trimNumber(active.startMood);
    elements.fullscreenStartMoodInput.value = active.startMood === null ? "" : trimNumber(active.startMood);
  }

  function bindEvents() {
    elements.startForm.addEventListener("submit", startPomodoro);
    elements.fullscreenStartForm.addEventListener("submit", startPomodoro);
    elements.durationBadge.addEventListener("click", openDurationModal);
    elements.durationForm.addEventListener("submit", savePomodoroDuration);
    elements.syncNowBtn?.addEventListener("click", syncNow);
    elements.checkInForm.addEventListener("submit", saveCheckIn);
    elements.fullscreenCheckInForm.addEventListener("submit", saveCheckIn);
    elements.taskGoalSelect.addEventListener("change", selectTaskGoal);
    elements.fullscreenTaskGoalSelect.addEventListener("change", selectTaskGoal);
    elements.breakForm.addEventListener("submit", changeBreakDuration);
    elements.fullscreenBreakForm.addEventListener("submit", changeBreakDuration);
    elements.breakMinutesInput.addEventListener("input", () => {
      breakMinutesDirty = true;
    });
    elements.fullscreenBreakMinutesInput.addEventListener("input", () => {
      breakMinutesDirty = true;
    });
    elements.pauseBtn.addEventListener("click", togglePause);
    elements.fullscreenPauseBtn.addEventListener("click", togglePause);
    elements.reviewBtn.addEventListener("click", openFinishModal);
    elements.fullscreenReviewBtn.addEventListener("click", openFinishModal);
    elements.earlyFinishBtn.addEventListener("click", finishEarly);
    elements.fullscreenEarlyFinishBtn.addEventListener("click", finishEarly);
    elements.resetBtn.addEventListener("click", resetPomodoro);
    elements.fullscreenResetBtn.addEventListener("click", resetPomodoro);
    elements.todayTargetForm.addEventListener("submit", setTodayTarget);
    elements.finishForm.addEventListener("submit", submitFinishedPomodoro);
    elements.recordForm.addEventListener("submit", saveEditedRecord);
    elements.taskForm.addEventListener("submit", saveTask);
    elements.longGoalForm.addEventListener("submit", saveLongGoal);
    elements.addTaskBtn.addEventListener("click", () => openTaskModal());
    elements.addLongGoalBtn.addEventListener("click", () => openLongGoalModal());
    elements.newQuoteBtn.addEventListener("click", setRandomQuote);
    elements.notificationBtn.addEventListener("click", requestNotification);
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.fullscreenBtn.addEventListener("click", toggleFullscreen);
    elements.fullscreenExitBtn.addEventListener("click", exitFullscreen);
    elements.exportJsonBtn.addEventListener("click", exportJson);
    elements.importJsonInput.addEventListener("change", importJson);
    elements.clearDataBtn.addEventListener("click", clearAllData);
    elements.exportCsvBtn.addEventListener("click", exportSelectedDateCsv);
    elements.recordsDateInput.addEventListener("change", changeRecordsDate);
    elements.copyFormatForm.addEventListener("submit", (event) => event.preventDefault());
    elements.copyDelimiterInput.addEventListener("input", updateClipboardFormat);
    elements.copyKeywordCaseSelect.addEventListener("change", updateClipboardFormat);
    document.querySelectorAll("[data-copy-field]").forEach((checkbox) => {
      checkbox.addEventListener("change", updateClipboardFormat);
    });
    elements.copyLatestBtn.addEventListener("click", () => {
      if (appState.clipboardHistory[0]) {
        copyText(displayClipboardText(appState.clipboardHistory[0]));
      }
    });
    elements.recordsBody.addEventListener("click", onRecordTableClick);
    elements.tasksBody.addEventListener("click", onTaskTableClick);
    elements.longGoalsList.addEventListener("click", onLongGoalClick);
    elements.clipboardHistory.addEventListener("click", onClipboardClick);
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });
    document.addEventListener("keydown", handleKeyboardShortcuts);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("fullscreenerror", () => {
      showToast("当前浏览器未允许进入原生全屏，请检查页面权限。");
    });
    window.addEventListener("resize", syncHomeColumnHeight);
  }

  function renderAll() {
    renderClock();
    elements.todayTargetInput.value = trimNumber(appState.settings.todayTargetTomatoes);
    renderTimer();
    renderTarget();
    renderRecords();
    renderStats();
    renderFullscreenStats();
    renderTasks();
    renderTaskOptions();
    renderLongGoals();
    renderClipboardFormat();
    renderClipboard();
    renderNotificationButton();
    syncHomeColumnHeight();
  }

  function renderClock() {
    const now = new Date();
    const headerDate = formatHeaderDate(now);
    elements.todayLabel.textContent = headerDate;
    elements.fullscreenDate.textContent = headerDate;
    elements.fullscreenClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  function renderFullscreenStats() {
    const actualCount = recordsOnDate(dateISO()).length;
    elements.fullscreenTomatoCount.textContent = `今日 ${actualCount} 个🍅`;
    elements.fullscreenTomatoCount.setAttribute("aria-label", `今日实际记录 ${actualCount} 个番茄`);
  }

  function syncHomeColumnHeight() {
    if (homeColumnSyncFrame) cancelAnimationFrame(homeColumnSyncFrame);
    homeColumnSyncFrame = requestAnimationFrame(() => {
      homeColumnSyncFrame = null;
      const aboveFold = document.querySelector(".above-fold");
      const focusSide = document.querySelector(".focus-side");
      if (!aboveFold || !focusSide) return;
      if (window.matchMedia("(max-width: 1120px)").matches) {
        aboveFold.style.removeProperty("--home-column-max-height");
        return;
      }
      const children = Array.from(focusSide.children).filter((child) => !child.classList.contains("is-hidden"));
      const gap = parseFloat(getComputedStyle(focusSide).rowGap) || 0;
      const height = children.reduce((total, child) => total + child.getBoundingClientRect().height, 0)
        + Math.max(0, children.length - 1) * gap;
      if (height > 0) {
        aboveFold.style.setProperty("--home-column-max-height", `${Math.ceil(height)}px`);
      }
    });
  }

  function openDurationModal() {
    elements.pomodoroMinutesInput.value = trimNumber(appState.settings.pomodoroMinutes);
    elements.durationModalTip.textContent = appState.activePomodoro
      ? "当前倒计时不会改变；新时长会用于下一次手动开始的番茄。"
      : "保存后会更新待开始番茄的倒计时和开始按钮。";
    openModal("durationModal");
    elements.pomodoroMinutesInput.focus();
    elements.pomodoroMinutesInput.select();
  }

  function savePomodoroDuration(event) {
    event.preventDefault();
    const minutes = readWholeMinutes(
      elements.pomodoroMinutesInput.value,
      MIN_POMODORO_MINUTES,
      MAX_POMODORO_MINUTES
    );
    if (minutes === null) {
      showToast(`番茄时长需为 ${MIN_POMODORO_MINUTES} 至 ${MAX_POMODORO_MINUTES} 分钟的整数。`);
      return;
    }
    appState.settings.pomodoroMinutes = minutes;
    saveState();
    closeModal("durationModal");
    renderTimer();
    showToast(`默认番茄时长已设置为 ${minutes} 分钟。`);
  }

  function startPomodoro(event) {
    event.preventDefault();
    if (appState.activePomodoro) {
      if (canOpenReview(appState.activePomodoro)) {
        openFinishModal();
      } else {
        showToast("已经有一个番茄在进行中了。");
      }
      return;
    }
    beginPomodoro(appState.settings.pomodoroMinutes * 60);
  }

  function beginPomodoro(durationSeconds, carry = {}, autoStarted = false) {
    const today = dateISO();
    const no = nextNumberForToday(today);
    const startDate = new Date();
    const safeDurationSeconds = normalizeDurationSeconds(durationSeconds, appState.settings.pomodoroMinutes * 60);
    appState.activePomodoro = {
      id: uid(),
      date: today,
      no,
      taskGoal: carry.taskGoal || "",
      relatedTaskId: carry.relatedTaskId || "",
      startTime: timeHHMM(startDate),
      startBattery: carry.startBattery ?? null,
      startMood: carry.startMood ?? null,
      durationSeconds: safeDurationSeconds,
      remainingSeconds: safeDurationSeconds,
      status: "running",
      phase: "focus",
      checkInSaved: false,
      focusSoundCuesPlayed: [],
      breakDurationSeconds: BREAK_SECONDS,
      endAt: new Date(Date.now() + safeDurationSeconds * 1000).toISOString(),
      startedAt: startDate.toISOString(),
      endedEarly: false,
      autoContinue: false,
      nextPomodoroDurationSeconds: null
    };
    saveState();
    elements.checkInForm.reset();
    elements.fullscreenCheckInForm.reset();
    hydrateActiveForm();
    renderAll();
    const minutes = trimNumber(safeDurationSeconds / 60);
    showToast(autoStarted
      ? `休息结束，已自动开始 ${minutes} 分钟的下一颗番茄。请确认并保存当前状态。`
      : `${minutes} 分钟专注开始啦，记得补充当前状态。`);
    focusActiveCheckInField();
  }

  function startNextPomodoro(previous) {
    const draft = previous.reviewDraft || {};
    beginPomodoro(previous.nextPomodoroDurationSeconds, {
      taskGoal: previous.taskGoal,
      relatedTaskId: draft.relatedTaskId || previous.relatedTaskId,
      startBattery: draft.endBattery ?? null,
      startMood: draft.endMood ?? null
    }, true);
  }

  function focusActiveCheckInField() {
    const target = document.body.classList.contains("is-fullscreen-mode")
      ? elements.fullscreenTaskGoalInput
      : elements.taskGoalInput;
    target.focus();
  }

  function selectTaskGoal(event) {
    const active = appState.activePomodoro;
    const isFullscreen = event.currentTarget === elements.fullscreenTaskGoalSelect;
    const taskSelect = isFullscreen ? elements.fullscreenTaskGoalSelect : elements.taskGoalSelect;
    const taskInput = isFullscreen ? elements.fullscreenTaskGoalInput : elements.taskGoalInput;
    const taskId = taskSelect.value || "";
    const task = appState.recentTasks.find((item) => item.id === taskId);
    if (task) {
      taskInput.value = task.name;
    }
    if (active && active.phase === "focus") {
      active.relatedTaskId = taskId;
      if (task) active.taskGoal = task.name;
      elements.taskGoalSelect.value = taskId;
      elements.fullscreenTaskGoalSelect.value = taskId;
      elements.taskGoalInput.value = active.taskGoal || "";
      elements.fullscreenTaskGoalInput.value = active.taskGoal || "";
      saveState();
      renderTimer();
    }
  }

  function saveCheckIn(event) {
    event.preventDefault();
    const active = appState.activePomodoro;
    if (!active || active.phase !== "focus") return;
    const isFullscreen = event.currentTarget === elements.fullscreenCheckInForm;
    const fields = isFullscreen
      ? {
        taskGoalInput: elements.fullscreenTaskGoalInput,
        taskGoalSelect: elements.fullscreenTaskGoalSelect,
        startBatteryInput: elements.fullscreenStartBatteryInput,
        startMoodInput: elements.fullscreenStartMoodInput
      }
      : {
        taskGoalInput: elements.taskGoalInput,
        taskGoalSelect: elements.taskGoalSelect,
        startBatteryInput: elements.startBatteryInput,
        startMoodInput: elements.startMoodInput
      };
    const taskGoal = fields.taskGoalInput.value.trim();
    const relatedTaskId = fields.taskGoalSelect.value || "";
    const startBattery = readScore(fields.startBatteryInput.value);
    const startMood = readScore(fields.startMoodInput.value);
    if (!taskGoal) {
      showToast("请填写当前任务目标。");
      return;
    }
    if (startBattery === null || startMood === null) {
      showToast("身体电量和心情值需在 0 到 10 之间。");
      return;
    }
    active.taskGoal = taskGoal;
    active.relatedTaskId = relatedTaskId;
    active.startBattery = startBattery;
    active.startMood = startMood;
    elements.taskGoalSelect.value = relatedTaskId;
    elements.fullscreenTaskGoalSelect.value = relatedTaskId;
    elements.taskGoalInput.value = taskGoal;
    elements.fullscreenTaskGoalInput.value = taskGoal;
    elements.startBatteryInput.value = trimNumber(startBattery);
    elements.fullscreenStartBatteryInput.value = trimNumber(startBattery);
    elements.startMoodInput.value = trimNumber(startMood);
    elements.fullscreenStartMoodInput.value = trimNumber(startMood);
    if (!active.checkInSaved) {
      createClipboardEntry("GO", {
        no: active.no,
        content: taskGoal,
        startBattery,
        startMood
      });
    }
    active.checkInSaved = true;
    saveState();
    renderTimer();
    showToast("当前状态已保存。");
  }

  function changeBreakDuration(event) {
    event.preventDefault();
    const active = appState.activePomodoro;
    if (!active || active.phase !== "break") return;
    const input = event.currentTarget === elements.fullscreenBreakForm
      ? elements.fullscreenBreakMinutesInput
      : elements.breakMinutesInput;
    const minutes = Number(input.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      showToast("休息时间需为 1 至 120 分钟。");
      return;
    }
    active.breakDurationSeconds = minutes * 60;
    active.remainingSeconds = active.breakDurationSeconds;
    active.endAt = active.status === "running" ? new Date(Date.now() + active.remainingSeconds * 1000).toISOString() : null;
    elements.breakMinutesInput.value = trimNumber(minutes);
    elements.fullscreenBreakMinutesInput.value = trimNumber(minutes);
    breakMinutesDirty = false;
    saveState();
    renderTimer();
    showToast("休息时间已更新。");
  }

  function togglePause() {
    const active = appState.activePomodoro;
    if (!active) return;
    if (active.phase === "complete") {
      openFinishModal();
      return;
    }
    if (active.status === "running") {
      active.remainingSeconds = remainingSeconds(active);
      active.status = "paused";
      active.endAt = null;
      showToast(active.phase === "break" ? "休息倒计时已暂停。" : "已暂停，准备好再继续。");
    } else if (active.status === "paused") {
      active.status = "running";
      active.endAt = new Date(Date.now() + active.remainingSeconds * 1000).toISOString();
      showToast(active.phase === "break" ? "继续休息。" : "继续专注。");
    }
    saveState();
    renderTimer();
  }

  function canOpenReview(active) {
    return Boolean(active && !active.recordSubmitted && (active.phase !== "focus" || remainingSeconds(active) <= REVIEW_UNLOCK_SECONDS));
  }

  function finishEarly() {
    const active = appState.activePomodoro;
    if (!active) return;
    if (active.phase === "focus") {
      startBreak(true);
    } else if (active.phase === "break") {
      finishBreak(true);
    }
  }

  function startBreak(endedEarly = false) {
    const active = appState.activePomodoro;
    if (!active) return;
    active.phase = "break";
    active.focusEndTime = timeHHMM(new Date());
    if (active.recordSubmitted && active.submittedRecordId) {
      const submittedRecord = appState.records.find((record) => record.id === active.submittedRecordId);
      if (submittedRecord) {
        submittedRecord.endTime = active.focusEndTime;
      }
    }
    active.endedEarly = Boolean(endedEarly);
    active.breakDurationSeconds = active.breakDurationSeconds || BREAK_SECONDS;
    active.remainingSeconds = active.breakDurationSeconds;
    active.status = "running";
    active.endAt = new Date(Date.now() + active.remainingSeconds * 1000).toISOString();
    breakMinutesDirty = false;
    saveState();
    if (endedEarly) {
      showToast("专注已提前结束，已开始休息倒计时。");
    } else {
      alertPomodoroFinished(active);
    }
    renderAll();
    if (endedEarly && !active.recordSubmitted) {
      openFinishModal();
    }
  }

  function finishBreak(endedEarly = false) {
    const active = appState.activePomodoro;
    if (!active) return;
    if (!endedEarly) {
      alertBreakFinished();
    }
    if (active.recordSubmitted) {
      if (active.autoContinue && active.nextPomodoroDurationSeconds) {
        startNextPomodoro(active);
        return;
      }
      appState.activePomodoro = null;
      saveState();
      renderAll();
      showToast(endedEarly ? "休息已提前结束，可以开始下一颗番茄了。" : "休息结束，可以开始下一颗番茄了。");
      return;
    }
    active.phase = "complete";
    active.status = "awaitingSubmission";
    active.remainingSeconds = 0;
    active.endAt = null;
    saveState();
    renderTimer();
    showToast(endedEarly ? "休息已提前结束，请提交本次回顾。" : "休息结束，记得提交本次回顾。");
    if (endedEarly) {
      openFinishModal();
    }
  }

  function resetPomodoro() {
    if (!appState.activePomodoro) return;
    const resetMessage = appState.activePomodoro.recordSubmitted
      ? "确认重置当前流程吗？已经提交的番茄记录会保留。"
      : "确认重置当前流程吗？尚未提交的番茄内容不会保存为记录。";
    if (!window.confirm(resetMessage)) return;
    appState.activePomodoro = null;
    saveState();
    closeModal("finishModal");
    elements.finishForm.reset();
    renderAll();
    showToast("当前计时已重置。");
  }

  function openFinishModal() {
    const active = appState.activePomodoro;
    if (!active || !canOpenReview(active)) {
      showToast("专注进入最后 2 分钟后，才可以填写回顾。");
      return;
    }
    const draft = active.reviewDraft || {};
    elements.completionInput.value = draft.completionContent || active.taskGoal || "";
    elements.completionPercentInput.value = draft.completionPercent ?? "";
    elements.endBatteryInput.value = draft.endBattery ?? (active.startBattery === null ? "" : trimNumber(active.startBattery));
    elements.endMoodInput.value = draft.endMood ?? (active.startMood === null ? "" : trimNumber(active.startMood));
    elements.tomatoStatusInput.value = draft.tomatoStatus || "完美的🍅";
    elements.relatedTaskInput.value = draft.relatedTaskId || active.relatedTaskId || "";
    elements.finishRemarkInput.value = draft.remark || "";
    elements.continuationBreakMinutesInput.value = draft.continuationBreakMinutes ?? "";
    elements.nextPomodoroMinutesInput.value = draft.nextPomodoroMinutes ?? "";
    elements.finishModalTip.textContent = active.phase === "focus"
      ? `已经进入最后 2 分钟，提交后会立即复制 BACK 内容；专注倒计时仍会继续到 ${trimNumber(active.durationSeconds / 60)} 分钟结束。`
      : active.endedEarly
        ? "专注已提前结束，请记录任务进度和当前状态；提交不会打断正在进行的休息倒计时。"
        : "专注已完成，提交回顾不会打断正在进行的休息倒计时。";
    elements.finishSubmitBtn.textContent = "提交回顾";
    openModal("finishModal");
    elements.completionInput.focus();
  }

  function submitFinishedPomodoro(event) {
    event.preventDefault();
    const active = appState.activePomodoro;
    if (!active) {
      closeModal("finishModal");
      return;
    }
    const completionContent = elements.completionInput.value.trim();
    const completionPercent = readPercent(elements.completionPercentInput.value);
    const endBattery = readScore(elements.endBatteryInput.value);
    const endMood = readScore(elements.endMoodInput.value);
    const tomatoStatus = elements.tomatoStatusInput.value;
    const continuationBreakRaw = elements.continuationBreakMinutesInput.value.trim();
    const nextPomodoroRaw = elements.nextPomodoroMinutesInput.value.trim();
    const wantsContinuation = continuationBreakRaw !== "" || nextPomodoroRaw !== "";
    if (!active.checkInSaved || active.startBattery === null || active.startMood === null) {
      showToast("请先保存专注开始时的任务、电量和心情。");
      return;
    }
    if (!completionContent) {
      showToast("请填写任务完成情况。");
      return;
    }
    if (completionPercent === null) {
      showToast("完成百分比需在 0 到 100 之间。");
      return;
    }
    if (endBattery === null || endMood === null) {
      showToast("结束后的身体电量和心情值需在 0 到 10 之间。");
      return;
    }
    if (wantsContinuation && (continuationBreakRaw === "" || nextPomodoroRaw === "")) {
      showToast("要自动继续，请同时填写本次休息时间和下个番茄时间；否则请将两项都留空。");
      return;
    }
    const continuationBreakMinutes = wantsContinuation
      ? readWholeMinutes(continuationBreakRaw, 1, 120)
      : null;
    const nextPomodoroMinutes = wantsContinuation
      ? readWholeMinutes(nextPomodoroRaw, MIN_POMODORO_MINUTES, MAX_POMODORO_MINUTES)
      : null;
    if (wantsContinuation && continuationBreakMinutes === null) {
      showToast("本次休息时间需为 1 至 120 分钟的整数。");
      return;
    }
    if (wantsContinuation && nextPomodoroMinutes === null) {
      showToast(`下个番茄时间需为 ${MIN_POMODORO_MINUTES} 至 ${MAX_POMODORO_MINUTES} 分钟的整数。`);
      return;
    }
    active.reviewDraft = {
      completionContent,
      completionPercent,
      endBattery,
      endMood,
      tomatoStatus,
      remark: elements.finishRemarkInput.value.trim(),
      relatedTaskId: elements.relatedTaskInput.value || "",
      continuationBreakMinutes,
      nextPomodoroMinutes
    };
    configureContinuation(active, continuationBreakMinutes, nextPomodoroMinutes);
    if (active.recordSubmitted) {
      closeModal("finishModal");
      return;
    }
    const record = {
      id: uid(),
      date: active.date,
      no: active.no,
      startTime: active.startTime,
      endTime: active.focusEndTime || (active.phase === "focus" && active.status === "running" && active.endAt
        ? timeHHMM(new Date(active.endAt))
        : timeHHMM(new Date())),
      taskGoal: active.taskGoal,
      completionContent,
      completionPercent,
      startBattery: active.startBattery,
      endBattery,
      startMood: active.startMood,
      endMood,
      tomatoStatus,
      tomatoWeight: TOMATO_WEIGHTS[tomatoStatus],
      remark: active.reviewDraft.remark,
      relatedTaskId: active.reviewDraft.relatedTaskId,
      createdAt: new Date().toISOString()
    };
    appState.records.push(record);
    syncTaskProgress(record.relatedTaskId, record.completionPercent);
    active.recordSubmitted = true;
    active.submittedRecordId = record.id;
    createClipboardEntry("BACK", {
      no: record.no,
      content: record.completionContent,
      completionPercent: record.completionPercent,
      startBattery: record.startBattery,
      endBattery: record.endBattery,
      startMood: record.startMood,
      endMood: record.endMood,
      tomatoStatus: record.tomatoStatus,
      remark: record.remark,
      date: record.date
    });
    const submittedPhase = active.phase;
    if (submittedPhase === "focus" || submittedPhase === "break") {
      saveState();
    } else if (active.autoContinue) {
      elements.finishModal.classList.add("is-hidden");
      startNextPomodoro(active);
    } else {
      appState.activePomodoro = null;
      saveState();
    }
    elements.finishForm.reset();
    closeModal("finishModal");
    selectedRecordsDate = record.date;
    renderAll();
    showToast(submittedPhase === "focus"
      ? active.autoContinue
        ? `回顾已提交；专注结束后休息 ${continuationBreakMinutes} 分钟，再自动开始 ${nextPomodoroMinutes} 分钟番茄。`
        : "回顾已提交，BACK 内容已复制；专注倒计时会继续运行。"
      : submittedPhase === "break"
        ? active.autoContinue
          ? `番茄已保存；休息结束后会自动开始 ${nextPomodoroMinutes} 分钟番茄。`
          : "番茄已保存，休息倒计时继续进行。"
        : active.autoContinue
          ? `番茄已保存，已自动开始 ${nextPomodoroMinutes} 分钟番茄。`
          : "已保存这颗番茄，今天的积累又多了一点。");
  }

  function configureContinuation(active, breakMinutes, nextPomodoroMinutes) {
    const enabled = breakMinutes !== null && nextPomodoroMinutes !== null;
    active.autoContinue = enabled;
    active.nextPomodoroDurationSeconds = enabled ? nextPomodoroMinutes * 60 : null;
    if (!enabled) return;
    const nextBreakDurationSeconds = breakMinutes * 60;
    if (active.phase === "break") {
      const previousDurationSeconds = Number(active.breakDurationSeconds) || BREAK_SECONDS;
      const elapsedSeconds = Math.max(0, previousDurationSeconds - remainingSeconds(active));
      active.breakDurationSeconds = nextBreakDurationSeconds;
      active.remainingSeconds = Math.max(0, nextBreakDurationSeconds - elapsedSeconds);
      active.endAt = active.status === "running"
        ? new Date(Date.now() + active.remainingSeconds * 1000).toISOString()
        : null;
      breakMinutesDirty = false;
      return;
    }
    active.breakDurationSeconds = nextBreakDurationSeconds;
  }

  function renderTimer() {
    const active = appState.activePomodoro;
    if (!active || active.phase !== "break") {
      breakMinutesDirty = false;
    }
    const defaultDurationSeconds = appState.settings.pomodoroMinutes * 60;
    const seconds = active ? remainingSeconds(active) : defaultDurationSeconds;
    const showCheckInFields = Boolean(active && active.phase === "focus" && !active.checkInSaved);
    elements.timerDisplay.textContent = displaySeconds(seconds);
    elements.timerDisplay.classList.toggle("is-ringing", Boolean(active && active.phase === "complete"));
    elements.startForm.classList.toggle("is-hidden", Boolean(active));
    elements.checkInForm.classList.toggle("is-hidden", !showCheckInFields);
    elements.breakForm.classList.toggle("is-hidden", !active || active.phase !== "break");
    elements.timerActionRow.classList.toggle("is-hidden", !active);
    elements.saveCheckInBtn.classList.toggle("is-hidden", !showCheckInFields);
    elements.timerControls.classList.toggle("is-hidden", !active);
    const displayedFocusMinutes = active && active.phase === "focus"
      ? active.durationSeconds / 60
      : appState.settings.pomodoroMinutes;
    elements.durationBadge.textContent = active && active.phase === "break"
      ? `${trimNumber(active.breakDurationSeconds / 60)} min break`
      : `${trimNumber(displayedFocusMinutes)} min`;
    elements.durationBadge.setAttribute("aria-label", `设置番茄时长，当前默认 ${trimNumber(appState.settings.pomodoroMinutes)} 分钟`);
    elements.startBtn.textContent = `开始 ${trimNumber(appState.settings.pomodoroMinutes)} 分钟专注`;
    if (!active) {
      elements.timerStatus.textContent = "准备好时，从一个小目标开始。";
      elements.reviewBtn.classList.add("is-hidden");
      elements.earlyFinishBtn.classList.add("is-hidden");
      renderFullscreenTimer(active, seconds, showCheckInFields);
      return;
    }
    if (active.phase === "focus") {
      const goal = active.taskGoal || "请保存当前状态";
      elements.timerStatus.textContent = active.recordSubmitted
        ? active.status === "paused" ? `专注已暂停 · 回顾已提交` : `第 ${active.no} 个番茄进行中 · 回顾已提交`
        : active.status === "paused" ? `专注已暂停 · ${goal}` : `第 ${active.no} 个番茄进行中 · ${goal}`;
      elements.pauseBtn.textContent = active.status === "paused" ? "继续" : "暂停";
      elements.pauseBtn.classList.remove("is-hidden");
      elements.reviewBtn.classList.toggle("is-hidden", !canOpenReview(active));
      elements.earlyFinishBtn.classList.remove("is-hidden");
    } else if (active.phase === "break") {
      if (!breakMinutesDirty) {
        elements.breakMinutesInput.value = trimNumber(active.breakDurationSeconds / 60);
        elements.fullscreenBreakMinutesInput.value = trimNumber(active.breakDurationSeconds / 60);
      }
      elements.timerStatus.textContent = active.recordSubmitted
        ? active.autoContinue
          ? `休息中 · 结束后自动开始 ${trimNumber(active.nextPomodoroDurationSeconds / 60)} 分钟番茄`
          : "休息中 · 本次回顾已提交"
        : "休息中 · 可以提交本次回顾";
      elements.pauseBtn.textContent = active.status === "paused" ? "继续休息" : "暂停";
      elements.pauseBtn.classList.remove("is-hidden");
      elements.reviewBtn.classList.toggle("is-hidden", Boolean(active.recordSubmitted));
      elements.earlyFinishBtn.classList.remove("is-hidden");
    } else {
      elements.timerStatus.textContent = "休息已结束，请提交本次回顾。";
      elements.pauseBtn.classList.add("is-hidden");
      elements.reviewBtn.classList.remove("is-hidden");
      elements.earlyFinishBtn.classList.add("is-hidden");
    }
    renderFullscreenTimer(active, seconds, showCheckInFields);
  }

  function renderFullscreenTimer(active, seconds, showCheckInFields) {
    elements.fullscreenTimerDisplay.textContent = displaySeconds(seconds);
    elements.fullscreenTimerDisplay.classList.toggle("is-ringing", Boolean(active && active.phase === "complete"));
    elements.fullscreenTimerStatus.textContent = elements.timerStatus.textContent;
    elements.fullscreenStartForm.classList.toggle("is-hidden", Boolean(active));
    elements.fullscreenStartBtn.textContent = `开始 ${trimNumber(appState.settings.pomodoroMinutes)} 分钟专注`;
    elements.fullscreenCheckInForm.classList.toggle("is-hidden", !showCheckInFields);
    elements.fullscreenBreakForm.classList.toggle("is-hidden", !active || active.phase !== "break");
    elements.fullscreenActionRow.classList.toggle("is-hidden", !active);
    [
      elements.fullscreenPauseBtn,
      elements.fullscreenReviewBtn,
      elements.fullscreenEarlyFinishBtn,
      elements.fullscreenResetBtn
    ].forEach((button) => button.classList.add("is-hidden"));
    if (!active) return;
    elements.fullscreenResetBtn.classList.remove("is-hidden");
    if (active.phase === "focus") {
      elements.fullscreenPauseBtn.textContent = active.status === "paused" ? "继续" : "暂停";
      elements.fullscreenPauseBtn.classList.remove("is-hidden");
      elements.fullscreenReviewBtn.classList.toggle("is-hidden", !canOpenReview(active));
      elements.fullscreenEarlyFinishBtn.classList.remove("is-hidden");
      return;
    }
    if (active.phase === "break") {
      elements.fullscreenPauseBtn.textContent = active.status === "paused" ? "继续休息" : "暂停";
      elements.fullscreenPauseBtn.classList.remove("is-hidden");
      elements.fullscreenReviewBtn.classList.toggle("is-hidden", Boolean(active.recordSubmitted));
      elements.fullscreenEarlyFinishBtn.classList.remove("is-hidden");
      return;
    }
    elements.fullscreenReviewBtn.classList.remove("is-hidden");
  }

  function reconcileActiveTimer() {
    const active = appState.activePomodoro;
    if (!active) return;
    if (active.status === "running" && remainingSeconds(active) <= 0) {
      if (active.phase === "focus") startBreak();
      else if (active.phase === "break") finishBreak();
    }
  }

  function startTimerLoop() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      renderClock();
      const active = appState.activePomodoro;
      if (!active || active.status !== "running") return;
      const seconds = remainingSeconds(active);
      if (seconds <= 0) {
        if (active.phase === "focus") startBreak();
        else if (active.phase === "break") finishBreak();
        return;
      }
      playDueFocusSoundCue(active, seconds);
      renderTimer();
    }, 1000);
  }

  function playDueFocusSoundCue(active, seconds) {
    if (active.phase !== "focus") return;
    const played = active.focusSoundCuesPlayed || (active.focusSoundCuesPlayed = []);
    const cues = [
      { id: "halfway", remainingSeconds: active.durationSeconds / 2 },
      { id: "review", remainingSeconds: REVIEW_UNLOCK_SECONDS }
    ];
    const dueCues = cues.filter((cue) =>
      seconds <= cue.remainingSeconds && !played.includes(cue.id)
    );
    if (!dueCues.length) return;
    dueCues.forEach((cue) => played.push(cue.id));
    playGentleReminderSound(dueCues[dueCues.length - 1].id);
    saveState();
  }

  function remainingSeconds(active) {
    if (!active) return appState.settings.pomodoroMinutes * 60;
    if (active.status === "running" && active.endAt) {
      return Math.max(0, Math.ceil((new Date(active.endAt).getTime() - Date.now()) / 1000));
    }
    return Math.max(0, Number(active.remainingSeconds) || 0);
  }

  function setTodayTarget(event) {
    event.preventDefault();
    const target = Number(elements.todayTargetInput.value);
    if (!Number.isFinite(target) || target <= 0) {
      showToast("今日目标需大于 0。");
      return;
    }
    appState.settings.todayTargetTomatoes = target;
    saveState();
    renderTarget();
    syncHomeColumnHeight();
    showToast("今日目标已更新。");
  }

  function renderTarget() {
    const records = recordsOnDate(dateISO());
    const valid = sumWeight(records);
    const target = Number(appState.settings.todayTargetTomatoes) || 8;
    const percentage = valid / target * 100;
    elements.targetText.textContent = `今日目标：${trimNumber(target)} 个🍅`;
    elements.targetProgressText.textContent = `今日已完成：${trimNumber(valid)} 个有效🍅 · 今日实际记录：${records.length} 个🍅 · 完成率：${trimNumber(valid)} / ${trimNumber(target)}`;
    elements.targetProgressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    if (valid > target) {
      elements.targetEncourage.textContent = "今天已经超额种番茄啦，辛苦但很棒！";
    } else if (valid === target) {
      elements.targetEncourage.textContent = "今天的目标稳稳完成了，给自己一点休息时间吧。";
    } else if (valid > 0) {
      elements.targetEncourage.textContent = "已经启动起来了，下一颗番茄会更容易。";
    } else {
      elements.targetEncourage.textContent = "今天还没有番茄，先开始一颗吧。";
    }
  }

  function renderRecords() {
    selectedRecordsDate = isValidDateISO(selectedRecordsDate) ? selectedRecordsDate : dateISO();
    elements.recordsDateInput.value = selectedRecordsDate;
    const today = dateISO();
    elements.recordsTitle.textContent = selectedRecordsDate === today ? "今日番茄记录" : `${selectedRecordsDate} 番茄记录`;
    const records = sortedRecords(recordsOnDate(selectedRecordsDate));
    elements.recordsEmpty.classList.toggle("is-hidden", records.length > 0);
    elements.recordsEmpty.textContent = selectedRecordsDate === today
      ? "今天还没有番茄，先开始一颗吧。"
      : "这一天还没有番茄记录。";
    elements.recordsBody.innerHTML = "";
    records.forEach((record) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(shortDate(record.date))}</td>
        <td>${escapeHtml(record.no)}</td>
        <td>${escapeHtml(record.startTime)}</td>
        <td>${escapeHtml(record.endTime)}</td>
        <td class="wrap">${escapeHtml(record.completionContent)}</td>
        <td>${escapeHtml(stateText(record))}</td>
        <td class="wrap">${escapeHtml(remarkText(record))}</td>
        <td><div class="row-actions"><button class="link-action" data-action="edit-record" data-id="${escapeHtml(record.id)}" type="button">编辑</button><button class="link-action remove" data-action="delete-record" data-id="${escapeHtml(record.id)}" type="button">删除</button></div></td>
      `;
      elements.recordsBody.appendChild(tr);
    });
  }

  function changeRecordsDate() {
    selectedRecordsDate = isValidDateISO(elements.recordsDateInput.value) ? elements.recordsDateInput.value : dateISO();
    renderRecords();
  }

  function onRecordTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const record = appState.records.find((item) => item.id === button.dataset.id);
    if (!record) return;
    if (button.dataset.action === "edit-record") {
      openRecordModal(record);
    } else if (button.dataset.action === "delete-record") {
      if (!window.confirm("确认删除这条番茄记录吗？删除后统计会同步更新。")) return;
      appState.records = appState.records.filter((item) => item.id !== record.id);
      saveState();
      renderAll();
      showToast("番茄记录已删除。");
    }
  }

  function openRecordModal(record) {
    elements.editRecordId.value = record.id;
    elements.editCompletionInput.value = record.completionContent;
    elements.editCompletionPercentInput.value = trimNumber(record.completionPercent ?? parsePercent(record.completionContent) ?? 0);
    elements.editStartTimeInput.value = record.startTime;
    elements.editEndTimeInput.value = record.endTime;
    elements.editStartBatteryInput.value = trimNumber(record.startBattery);
    elements.editEndBatteryInput.value = trimNumber(record.endBattery);
    elements.editStartMoodInput.value = trimNumber(record.startMood);
    elements.editEndMoodInput.value = trimNumber(record.endMood);
    elements.editTomatoStatusInput.value = record.tomatoStatus;
    elements.editRelatedTaskInput.value = record.relatedTaskId || "";
    elements.editRemarkInput.value = record.remark || "";
    openModal("recordModal");
  }

  function saveEditedRecord(event) {
    event.preventDefault();
    const record = appState.records.find((item) => item.id === elements.editRecordId.value);
    if (!record) return;
    const startBattery = readScore(elements.editStartBatteryInput.value);
    const endBattery = readScore(elements.editEndBatteryInput.value);
    const startMood = readScore(elements.editStartMoodInput.value);
    const endMood = readScore(elements.editEndMoodInput.value);
    const completionPercent = readPercent(elements.editCompletionPercentInput.value);
    if ([startBattery, endBattery, startMood, endMood].some((value) => value === null)) {
      showToast("电量和心情值需在 0 到 10 之间。");
      return;
    }
    if (!elements.editCompletionInput.value.trim()) {
      showToast("完成情况不能为空。");
      return;
    }
    if (completionPercent === null) {
      showToast("完成百分比需在 0 到 100 之间。");
      return;
    }
    record.completionContent = elements.editCompletionInput.value.trim();
    record.completionPercent = completionPercent;
    record.startTime = elements.editStartTimeInput.value;
    record.endTime = elements.editEndTimeInput.value;
    record.startBattery = startBattery;
    record.endBattery = endBattery;
    record.startMood = startMood;
    record.endMood = endMood;
    record.tomatoStatus = elements.editTomatoStatusInput.value;
    record.tomatoWeight = TOMATO_WEIGHTS[record.tomatoStatus];
    record.relatedTaskId = elements.editRelatedTaskInput.value || "";
    record.remark = elements.editRemarkInput.value.trim();
    syncTaskProgress(record.relatedTaskId, record.completionPercent);
    saveState();
    closeModal("recordModal");
    renderAll();
    showToast("番茄记录已更新。");
  }

  function renderStats() {
    const today = new Date();
    const periods = [
      { label: "今日", records: appState.records.filter((r) => r.date === dateISO(today)) },
      { label: "本周", records: appState.records.filter((r) => sameWeek(r.date, today)) },
      { label: "本月", records: appState.records.filter((r) => sameMonth(r.date, today)) },
      { label: "本年", records: appState.records.filter((r) => sameYear(r.date, today)) }
    ];
    elements.statsGrid.innerHTML = periods.map((period) => {
      const valid = sumWeight(period.records);
      const mins = valid * WEIGHT_MINUTES;
      return `
        <article class="stat-tile">
          <h3>${period.label}</h3>
          <strong>${trimNumber(valid)} 🍅</strong>
          <p>实际 ${period.records.length} 个 · ${trimNumber(mins)} 分钟<br>${formatChineseDuration(mins)}</p>
        </article>
      `;
    }).join("");
  }

  function renderTasks() {
    elements.tasksBody.innerHTML = "";
    elements.tasksEmpty.classList.toggle("is-hidden", appState.recentTasks.length > 0);
    appState.recentTasks.forEach((task) => {
      const completed = completedForTask(task);
      const estimated = Number(task.estimatedTomatoes) || 0;
      const percentage = progressForTask(task);
      const status = completed <= 0 ? "未开始" : completed >= estimated ? "已完成" : "进行中";
      const article = document.createElement("article");
      article.className = "task-item";
      article.innerHTML = `
        <div class="task-item-head">
          <h3>${escapeHtml(task.name)}</h3>
          <span class="status-chip">${status}</span>
        </div>
        <div class="task-meta">
          <span>预计 ${trimNumber(estimated)} 🍅</span>
          <span>已完成 ${trimNumber(completed)} 🍅</span>
          <span>${trimNumber(percentage, 1)}%</span>
        </div>
        <div class="task-progress">
          <div class="progress-track"><span style="width:${Math.min(100, Math.max(0, percentage))}%"></span></div>
        </div>
        <p class="task-remark">${escapeHtml(task.remark || "暂无备注")}</p>
        <div class="row-actions"><button class="link-action" data-action="edit-task" data-id="${escapeHtml(task.id)}" type="button">编辑</button><button class="link-action remove" data-action="delete-task" data-id="${escapeHtml(task.id)}" type="button">删除</button></div>
      `;
      elements.tasksBody.appendChild(article);
    });
  }

  function completedForTask(task) {
    return roundWeight((Number(task.estimatedTomatoes) || 0) * progressForTask(task) / 100);
  }

  function progressForTask(task) {
    return clampPercent(Number(task.progressPercent) || 0);
  }

  function renderTaskOptions() {
    const options = ['<option value="">不关联 To Do</option>'].concat(
      appState.recentTasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.name)}</option>`)
    ).join("");
    const goalOptions = ['<option value="">不关联 To Do / 自定义目标</option>'].concat(
      appState.recentTasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.name)}</option>`)
    ).join("");
    const currentGoal = appState.activePomodoro?.relatedTaskId || elements.taskGoalSelect.value || elements.fullscreenTaskGoalSelect.value;
    const currentFinish = elements.relatedTaskInput.value;
    const currentEdit = elements.editRelatedTaskInput.value;
    elements.taskGoalSelect.innerHTML = goalOptions;
    elements.fullscreenTaskGoalSelect.innerHTML = goalOptions;
    elements.relatedTaskInput.innerHTML = options;
    elements.editRelatedTaskInput.innerHTML = options;
    elements.taskGoalSelect.value = currentGoal;
    elements.fullscreenTaskGoalSelect.value = currentGoal;
    elements.relatedTaskInput.value = currentFinish;
    elements.editRelatedTaskInput.value = currentEdit;
  }

  function onTaskTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const task = appState.recentTasks.find((item) => item.id === button.dataset.id);
    if (!task) return;
    if (button.dataset.action === "edit-task") {
      openTaskModal(task);
    } else if (button.dataset.action === "delete-task") {
      if (!window.confirm("确认删除这条 To Do 吗？已关联的番茄记录会保留，但不再归属清单项。")) return;
      appState.recentTasks = appState.recentTasks.filter((item) => item.id !== task.id);
      appState.records.forEach((record) => {
        if (record.relatedTaskId === task.id) record.relatedTaskId = "";
      });
      saveState();
      renderAll();
      showToast("To Do 已删除。");
    }
  }

  function openTaskModal(task) {
    elements.taskForm.reset();
    elements.taskIdInput.value = task ? task.id : "";
    $("taskModalTitle").textContent = task ? "编辑 To Do" : "新增 To Do";
    if (task) {
      elements.recentTaskNameInput.value = task.name;
      elements.estimatedTomatoesInput.value = trimNumber(task.estimatedTomatoes);
      elements.progressPercentInput.value = trimNumber(progressForTask(task));
      elements.recentTaskRemarkInput.value = task.remark || "";
    } else {
      elements.progressPercentInput.value = "0";
    }
    openModal("taskModal");
  }

  function saveTask(event) {
    event.preventDefault();
    const name = elements.recentTaskNameInput.value.trim();
    const estimated = Number(elements.estimatedTomatoesInput.value);
    const progressPercent = readPercent(elements.progressPercentInput.value);
    if (!name || !Number.isFinite(estimated) || estimated <= 0 || progressPercent === null) {
      showToast("请填写有效的 To Do 名称、番茄数量和完成百分比。");
      return;
    }
    const existing = appState.recentTasks.find((task) => task.id === elements.taskIdInput.value);
    const data = {
      id: existing ? existing.id : uid(),
      name,
      estimatedTomatoes: estimated,
      progressPercent,
      remark: elements.recentTaskRemarkInput.value.trim()
    };
    if (existing) {
      Object.assign(existing, data);
    } else {
      appState.recentTasks.push(data);
    }
    saveState();
    closeModal("taskModal");
    renderAll();
    showToast("To Do 已保存。");
  }

  function setRandomQuote() {
    let next = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    if (QUOTES.length > 1 && next === currentQuote) {
      next = QUOTES[(QUOTES.indexOf(next) + 1) % QUOTES.length];
    }
    currentQuote = next;
    elements.gentleQuote.textContent = next;
  }

  function renderLongGoals() {
    const sorted = [...appState.longTermGoals].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    renderNearestGoal(sorted);
    elements.longGoalsList.innerHTML = "";
    elements.longGoalsEmpty.classList.toggle("is-hidden", sorted.length > 0);
    sorted.forEach((goal) => {
      const days = daysUntil(goal.targetDate);
      const dayLabel = days < 0 ? "已到期" : days === 0 ? "就是今天" : `${days} 天`;
      const item = document.createElement("article");
      item.className = "countdown-item";
      item.innerHTML = `
        <span class="days-badge">${dayLabel}</span>
        <div class="countdown-content"><h3>${escapeHtml(goal.name)}</h3><p>${escapeHtml(goal.targetDate)}${goal.remark ? ` · ${escapeHtml(goal.remark)}` : ""}</p></div>
        <div class="row-actions"><button class="link-action" data-action="edit-long" data-id="${escapeHtml(goal.id)}" type="button">编辑</button><button class="link-action remove" data-action="delete-long" data-id="${escapeHtml(goal.id)}" type="button">删除</button></div>
      `;
      elements.longGoalsList.appendChild(item);
    });
  }

  function renderNearestGoal(sortedGoals) {
    const nearest = sortedGoals.find((goal) => daysUntil(goal.targetDate) >= 0);
    if (!nearest) {
      elements.nearestGoalSummary.textContent = "暂无未来倒数日目标";
      elements.nearestGoalSummary.removeAttribute("title");
      return;
    }
    const days = daysUntil(nearest.targetDate);
    const dayLabel = days === 0 ? "就是今天" : `还有 ${days} 天`;
    elements.nearestGoalSummary.textContent = `${nearest.name} · ${dayLabel}`;
    elements.nearestGoalSummary.title = `${nearest.name} · ${nearest.targetDate}`;
  }

  function onLongGoalClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const goal = appState.longTermGoals.find((item) => item.id === button.dataset.id);
    if (!goal) return;
    if (button.dataset.action === "edit-long") {
      openLongGoalModal(goal);
    } else if (button.dataset.action === "delete-long") {
      if (!window.confirm("确认删除这个长期目标吗？")) return;
      appState.longTermGoals = appState.longTermGoals.filter((item) => item.id !== goal.id);
      saveState();
      renderLongGoals();
      showToast("长期目标已删除。");
    }
  }

  function openLongGoalModal(goal) {
    elements.longGoalForm.reset();
    elements.longGoalIdInput.value = goal ? goal.id : "";
    $("longGoalModalTitle").textContent = goal ? "编辑长期目标" : "新增长期目标";
    if (goal) {
      elements.longGoalNameInput.value = goal.name;
      elements.longGoalDateInput.value = goal.targetDate;
      elements.longGoalRemarkInput.value = goal.remark || "";
    }
    openModal("longGoalModal");
  }

  function saveLongGoal(event) {
    event.preventDefault();
    const name = elements.longGoalNameInput.value.trim();
    const targetDate = elements.longGoalDateInput.value;
    if (!name || !targetDate) {
      showToast("请填写长期目标名称和日期。");
      return;
    }
    const existing = appState.longTermGoals.find((goal) => goal.id === elements.longGoalIdInput.value);
    const data = {
      id: existing ? existing.id : uid(),
      name,
      targetDate,
      remark: elements.longGoalRemarkInput.value.trim()
    };
    if (existing) Object.assign(existing, data);
    else appState.longTermGoals.push(data);
    saveState();
    closeModal("longGoalModal");
    renderLongGoals();
    showToast("长期目标已保存。");
  }

  function updateClipboardFormat() {
    const fields = {};
    document.querySelectorAll("[data-copy-field]").forEach((checkbox) => {
      fields[checkbox.dataset.copyField] = checkbox.checked;
    });
    if (!Object.values(fields).some(Boolean)) {
      fields.marker = true;
      const markerInput = document.querySelector('[data-copy-field="marker"]');
      if (markerInput) markerInput.checked = true;
      showToast("至少保留一项复制内容。");
    }
    appState.settings.clipboardFormat = normalizeClipboardFormat({
      delimiter: elements.copyDelimiterInput.value,
      keywordCase: elements.copyKeywordCaseSelect.value,
      fields
    });
    saveState();
    renderClipboard();
  }

  function renderClipboardFormat() {
    const format = normalizeClipboardFormat(appState.settings.clipboardFormat);
    appState.settings.clipboardFormat = format;
    elements.copyDelimiterInput.value = format.delimiter;
    elements.copyKeywordCaseSelect.value = format.keywordCase;
    document.querySelectorAll("[data-copy-field]").forEach((checkbox) => {
      checkbox.checked = Boolean(format.fields[checkbox.dataset.copyField]);
    });
  }

  function createClipboardEntry(type, data) {
    const entry = {
      id: uid(),
      type,
      data,
      createdAt: new Date().toISOString()
    };
    entry.text = formatClipboardEntry(entry);
    appState.clipboardHistory.unshift(entry);
    appState.clipboardHistory = appState.clipboardHistory.slice(0, 10);
    saveState();
    renderClipboard();
    copyText(displayClipboardText(entry));
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else if (!copyTextWithSelection(text)) {
        throw new Error("Clipboard unavailable");
      }
      showToast("内容已复制到剪贴板。");
    } catch (error) {
      showToast("浏览器未允许自动复制，请手动选中文本复制。");
    }
  }

  function copyTextWithSelection(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
      if (selection) {
        selection.removeAllRanges();
        if (selectedRange) selection.addRange(selectedRange);
      }
    }
    return copied;
  }

  function renderClipboard() {
    const latest = appState.clipboardHistory[0];
    elements.latestCopyPanel.classList.toggle("is-hidden", !latest);
    elements.clipboardEmpty.classList.toggle("is-hidden", appState.clipboardHistory.length > 0);
    elements.latestCopyText.textContent = latest ? displayClipboardText(latest) : "";
    elements.clipboardHistory.innerHTML = "";
    appState.clipboardHistory.forEach((entry) => {
      const text = displayClipboardText(entry);
      const row = document.createElement("div");
      row.className = "copy-entry";
      row.innerHTML = `
        <span class="copy-time">${escapeHtml(formatDateTime(entry.createdAt))}</span>
        <p>${escapeHtml(text)}</p>
        <button class="tiny-btn" data-copy-id="${escapeHtml(entry.id)}" type="button">复制</button>
      `;
      elements.clipboardHistory.appendChild(row);
    });
    syncHomeColumnHeight();
  }

  function displayClipboardText(entry) {
    if (!entry) return "";
    if (entry.data) return formatClipboardEntry(entry);
    if (entry.type !== "BACK") return entry.text || "";
    const entryDate = dateISO(new Date(entry.createdAt));
    const validCount = sumWeight(recordsOnDate(entryDate));
    if (!Number.isFinite(validCount)) return entry.text || "";
    return (entry.text || "").replace(/合计\d+(?:\.\d+)?个🍅$/, `合计${trimNumber(validCount)}个🍅`);
  }

  function formatClipboardEntry(entry) {
    const format = normalizeClipboardFormat(appState.settings.clipboardFormat);
    const fields = format.fields;
    const parts = [];
    const data = entry.data || {};
    if (fields.marker) parts.push(`${data.no || ""}${formatClipboardKeyword(entry.type, format.keywordCase)}`.trim());
    if (fields.content && data.content) {
      parts.push(entry.type === "BACK"
        ? `${data.content} ${trimNumber(data.completionPercent, 1)}%`
        : data.content);
    }
    if (fields.energyMood) {
      if (entry.type === "BACK") {
        parts.push(`🔋${trimNumber(data.startBattery)}→${trimNumber(data.endBattery)} 😊${trimNumber(data.startMood)}→${trimNumber(data.endMood)}`);
      } else {
        parts.push(`🔋${trimNumber(data.startBattery)} 😊${trimNumber(data.startMood)}`);
      }
    }
    if (entry.type === "BACK" && fields.status && data.tomatoStatus) {
      parts.push(data.remark ? `${data.tomatoStatus}（${data.remark}）` : data.tomatoStatus);
    }
    if (entry.type === "BACK" && fields.total) {
      const entryDate = data.date || dateISO(new Date(entry.createdAt));
      const validCount = sumWeight(recordsOnDate(entryDate));
      parts.push(`合计${trimNumber(validCount)}个🍅`);
    }
    return parts.filter((part) => part !== "").join(format.delimiter);
  }

  function formatClipboardKeyword(type, keywordCase) {
    const keyword = type === "BACK" ? "BACK" : "GO";
    return keywordCase === "lower" ? keyword.toLowerCase() : keyword;
  }

  function onClipboardClick(event) {
    const button = event.target.closest("button[data-copy-id]");
    if (!button) return;
    const entry = appState.clipboardHistory.find((item) => item.id === button.dataset.copyId);
    if (entry) copyText(displayClipboardText(entry));
  }

  async function requestNotification() {
    if (!("Notification" in window)) {
      showToast("当前浏览器不支持桌面通知。");
      return;
    }
    const result = await Notification.requestPermission();
    renderNotificationButton();
    showToast(result === "granted" ? "番茄结束时会发送浏览器通知。" : "未开启通知，也可以继续正常使用。");
  }

  function renderNotificationButton() {
    if (!("Notification" in window)) {
      elements.notificationBtn.textContent = "不支持通知";
      elements.notificationBtn.disabled = true;
      return;
    }
    elements.notificationBtn.textContent = Notification.permission === "granted" ? "通知已开启" : "开启结束通知";
  }

  function alertPomodoroFinished(active) {
    const focusMinutes = trimNumber((active.durationSeconds || POMODORO_SECONDS) / 60);
    const breakMinutes = trimNumber((active.breakDurationSeconds || BREAK_SECONDS) / 60);
    playCompletionSound("focus");
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("番茄时间到啦 🍅", {
        body: `这一段专注已完成，${breakMinutes} 分钟休息已经开始。`
      });
    }
    showToast(`${focusMinutes} 分钟专注完成，已开始 ${breakMinutes} 分钟休息倒计时。`);
  }

  function alertBreakFinished() {
    playCompletionSound("break");
  }

  function playGentleReminderSound(cueId) {
    const frequencies = cueId === "halfway" ? [659.25, 783.99] : [783.99, 659.25];
    playSound(frequencies.map((frequency, index) => ({
      frequency,
      start: index * 0.2,
      duration: 0.38,
      volume: 0.065,
      type: "sine"
    })));
  }

  function playCompletionSound(phase) {
    const frequencies = phase === "focus"
      ? [523.25, 659.25, 783.99, 1046.5]
      : [783.99, 659.25, 523.25, 392];
    playSound(frequencies.map((frequency, index) => ({
      frequency,
      start: index * 0.16,
      duration: 0.33,
      volume: 0.2,
      type: "triangle"
    })));
  }

  function playSound(notes) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      notes.forEach((note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + note.start;
        oscillator.type = note.type;
        oscillator.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(note.volume, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + note.duration + 0.01);
      });
      const endAt = Math.max(...notes.map((note) => note.start + note.duration));
      setTimeout(() => context.close(), (endAt + 0.5) * 1000);
    } catch (error) {
      // Audio is optional when browser autoplay policy blocks it.
    }
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncTimerFormDrafts(toFullscreen) {
    const active = appState.activePomodoro;
    if (!active) return;
    if (active.phase === "focus" && !active.checkInSaved) {
      const source = toFullscreen
        ? [elements.taskGoalSelect, elements.taskGoalInput, elements.startBatteryInput, elements.startMoodInput]
        : [elements.fullscreenTaskGoalSelect, elements.fullscreenTaskGoalInput, elements.fullscreenStartBatteryInput, elements.fullscreenStartMoodInput];
      const target = toFullscreen
        ? [elements.fullscreenTaskGoalSelect, elements.fullscreenTaskGoalInput, elements.fullscreenStartBatteryInput, elements.fullscreenStartMoodInput]
        : [elements.taskGoalSelect, elements.taskGoalInput, elements.startBatteryInput, elements.startMoodInput];
      source.forEach((field, index) => {
        target[index].value = field.value;
      });
    }
    if (active.phase === "break") {
      const source = toFullscreen ? elements.breakMinutesInput : elements.fullscreenBreakMinutesInput;
      const target = toFullscreen ? elements.fullscreenBreakMinutesInput : elements.breakMinutesInput;
      target.value = source.value;
    }
  }

  function toggleFullscreen() {
    if (fullscreenElement() || document.body.classList.contains("is-fullscreen-mode")) {
      exitFullscreen();
      return;
    }
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) {
      showToast("当前浏览器不支持原生全屏，请使用最新版 Chrome、Edge 或 Firefox。");
      return;
    }
    syncTimerFormDrafts(true);
    fullscreenRestoreFocus = document.activeElement;
    Promise.resolve(request.call(root, { navigationUI: "hide" })).catch(() => {
      fullscreenRestoreFocus = null;
      showToast("当前浏览器未允许进入原生全屏，请检查页面权限。");
    });
  }

  function exitFullscreen() {
    syncTimerFormDrafts(false);
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit || !fullscreenElement()) {
      if (document.body.classList.contains("is-fullscreen-mode")) handleFullscreenChange();
      return;
    }
    Promise.resolve(exit.call(document)).catch(() => {
      showToast("退出全屏失败，请按 Esc 返回普通页面。");
    });
  }

  function handleFullscreenChange() {
    const isFullscreen = Boolean(fullscreenElement());
    const wasFullscreen = document.body.classList.contains("is-fullscreen-mode");
    if (wasFullscreen && !isFullscreen) syncTimerFormDrafts(false);
    document.body.classList.toggle("is-fullscreen-mode", isFullscreen);
    elements.fullscreenView.setAttribute("aria-hidden", String(!isFullscreen));
    elements.fullscreenView.inert = !isFullscreen;
    elements.fullscreenBtn.textContent = isFullscreen ? "⛶ 退出全屏" : "⛶ 全屏专注";
    elements.fullscreenBtn.setAttribute("aria-label", isFullscreen ? "退出全屏专注" : "进入全屏专注");
    renderTimer();
    renderClock();
    if (!isFullscreen && fullscreenRestoreFocus && typeof fullscreenRestoreFocus.focus === "function") {
      fullscreenRestoreFocus.focus();
      fullscreenRestoreFocus = null;
    }
  }

  function toggleTheme() {
    appState.settings.theme = appState.settings.theme === "dark" ? "light" : "dark";
    saveState();
    applyTheme();
  }

  function applyTheme() {
    document.body.classList.toggle("dark", appState.settings.theme === "dark");
    elements.themeToggle.textContent = appState.settings.theme === "dark" ? "☀️ 浅色" : "🌙 深色";
  }

  function exportJson() {
    downloadFile(`xian-tomato-base-backup-${dateISO()}.json`, JSON.stringify(appState, null, 2), "application/json;charset=utf-8");
    showToast("JSON 备份已导出。");
  }

  async function importJson(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (!window.confirm("覆盖导入会替换当前全部数据。确认继续吗？")) return;
    try {
      const imported = JSON.parse(await file.text());
      appState = normalizeState(imported);
      selectedRecordsDate = dateISO();
      saveState({ allowRecordReplacement: true });
      reconcileActiveTimer();
      hydrateActiveForm();
      applyTheme();
      renderAll();
      showToast("JSON 数据已覆盖导入。");
    } catch (error) {
      showToast("导入失败，请选择有效的 JSON 备份文件。");
    }
  }

  function clearAllData() {
    if (!window.confirm("确认清空全部番茄、To Do 和目标数据吗？")) return;
    if (!window.confirm("清空后无法撤销。请再次确认是否继续。")) return;
    appState = defaultState();
    selectedRecordsDate = dateISO();
    saveState({ allowRecordReplacement: true });
    closeAllModals();
    setRandomQuote();
    applyTheme();
    renderAll();
    showToast("全部数据已清空。");
  }

  function exportSelectedDateCsv() {
    const records = sortedRecords(recordsOnDate(selectedRecordsDate));
    const headers = ["Date", "No.", "Start", "End", "Content", "State", "Remark"];
    const rows = records.map((record) => {
      return [
        shortDate(record.date),
        record.no,
        record.startTime,
        record.endTime,
        record.completionContent,
        stateText(record),
        remarkText(record)
      ];
    });
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`tomato-records-${selectedRecordsDate}.csv`, csv, "text/csv;charset=utf-8");
    showToast("当前日期记录 CSV 已导出。");
  }

  function handleKeyboardShortcuts(event) {
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if (event.ctrlKey && event.key === "Enter" && !elements.finishModal.classList.contains("is-hidden")) {
      event.preventDefault();
      elements.finishForm.requestSubmit();
      return;
    }
    if (event.key === "Escape") {
      const visibleModal = document.querySelector(".modal-backdrop:not(.is-hidden)");
      if (visibleModal) {
        closeModal(visibleModal.id);
      } else if (fullscreenElement() || document.body.classList.contains("is-fullscreen-mode")) {
        exitFullscreen();
      } else if (appState.activePomodoro) {
        resetPomodoro();
      }
      return;
    }
    if (event.code === "Space" && !typing && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!appState.activePomodoro) {
        elements.startForm.requestSubmit();
      } else {
        togglePause();
      }
    }
  }

  function openModal(id) {
    $(id).classList.remove("is-hidden");
  }

  function closeModal(id) {
    if (id === "finishModal") preserveReviewDraft();
    $(id).classList.add("is-hidden");
  }

  function preserveReviewDraft() {
    const active = appState.activePomodoro;
    if (!active || active.recordSubmitted || elements.finishModal.classList.contains("is-hidden")) return;
    active.reviewDraft = {
      completionContent: elements.completionInput.value.trim(),
      completionPercent: elements.completionPercentInput.value,
      endBattery: elements.endBatteryInput.value,
      endMood: elements.endMoodInput.value,
      tomatoStatus: elements.tomatoStatusInput.value,
      remark: elements.finishRemarkInput.value.trim(),
      relatedTaskId: elements.relatedTaskInput.value || "",
      continuationBreakMinutes: elements.continuationBreakMinutesInput.value,
      nextPomodoroMinutes: elements.nextPomodoroMinutesInput.value
    };
    saveState();
  }

  function closeAllModals() {
    document.querySelectorAll(".modal-backdrop").forEach((modal) => modal.classList.add("is-hidden"));
  }

  function fillTomatoSelect(select) {
    select.innerHTML = Object.entries(TOMATO_WEIGHTS).map(([name, weight]) =>
      `<option value="${name}">${name} (${trimNumber(weight)})</option>`
    ).join("");
  }

  function recordsOnDate(date) {
    return appState.records.filter((record) => record.date === date);
  }

  function isValidDateISO(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function sortedRecords(records) {
    return [...records].sort((a, b) =>
      a.date.localeCompare(b.date)
      || (Number(a.no) || 0) - (Number(b.no) || 0)
      || String(a.startTime || "").localeCompare(String(b.startTime || ""))
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );
  }

  function nextNumberForToday(date) {
    const allNumbers = recordsOnDate(date).map((record) => Number(record.no) || 0);
    return Math.max(0, ...allNumbers) + 1;
  }

  function sumWeight(records) {
    return roundWeight(records.reduce((sum, record) => sum + (Number(record.tomatoWeight) || 0), 0));
  }

  function roundWeight(value) {
    return Math.round(value * 100) / 100;
  }

  function sameWeek(dateString, reference) {
    const date = parseLocalDate(dateString);
    const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const weekday = start.getDay() || 7;
    start.setDate(start.getDate() - weekday + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return date >= start && date < end;
  }

  function sameMonth(dateString, reference) {
    const date = parseLocalDate(dateString);
    return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth();
  }

  function sameYear(dateString, reference) {
    return parseLocalDate(dateString).getFullYear() === reference.getFullYear();
  }

  function daysUntil(targetDate) {
    const target = parseLocalDate(targetDate);
    const today = parseLocalDate(dateISO());
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function dateISO(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseLocalDate(value) {
    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function shortDate(value) {
    return value.replaceAll("-", "").slice(2);
  }

  function timeHHMM(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatHeaderDate(date) {
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    return `${date.getFullYear()} / ${pad(date.getMonth() + 1)} / ${pad(date.getDate())} ${weekday}`;
  }

  function formatDateTime(iso) {
    const date = new Date(iso);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${timeHHMM(date)}`;
  }

  function displaySeconds(seconds) {
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }

  function formatClockMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const remaining = roundWeight(minutes - hours * 60);
    const displayMinutes = remaining < 10 ? `0${trimNumber(remaining)}` : trimNumber(remaining);
    return `${hours}:${displayMinutes}`;
  }

  function formatChineseDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const remaining = roundWeight(minutes - hours * 60);
    return `${hours}小时${trimNumber(remaining)}分钟`;
  }

  function stateText(record) {
    return `🔋${trimNumber(record.startBattery)}→${trimNumber(record.endBattery)} 😊${trimNumber(record.startMood)}→${trimNumber(record.endMood)}`;
  }

  function remarkText(record) {
    return record.remark ? `${record.tomatoStatus}（${record.remark}）` : record.tomatoStatus;
  }

  function syncTaskProgress(taskId, percent) {
    if (!taskId) return;
    const task = appState.recentTasks.find((item) => item.id === taskId);
    if (task) {
      task.progressPercent = clampPercent(percent);
    }
  }

  function readScore(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 10 ? Math.round(number * 10) / 10 : null;
  }

  function readWholeMinutes(value, min, max) {
    if (String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
  }

  function normalizeWholeMinutes(value, fallback, min, max) {
    return readWholeMinutes(value, min, max) ?? fallback;
  }

  function normalizeDurationSeconds(value, fallback) {
    const seconds = Number(value);
    const minSeconds = MIN_POMODORO_MINUTES * 60;
    const maxSeconds = MAX_POMODORO_MINUTES * 60;
    return Number.isFinite(seconds) && seconds >= minSeconds && seconds <= maxSeconds
      ? Math.round(seconds)
      : fallback;
  }

  function readPercent(value) {
    if (String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? clampPercent(number) : null;
  }

  function parsePercent(value) {
    const match = String(value || "").match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? clampPercent(Number(match[1])) : null;
  }

  function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, Math.round(number * 10) / 10));
  }

  function trimNumber(value, precision = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return Number(number.toFixed(precision)).toString();
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    const safe = /^\s*[=+@-]/.test(text) ? "'" + text : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    elements.toastStack.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }
})();
