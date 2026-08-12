import crypto from "node:crypto";

export type TomatoRecord = Record<string, unknown>;

export type TrustedTomatoRecord = TomatoRecord & {
  id: string;
  date: string;
  tomatoStatus: string;
  tomatoWeight: number;
  completionPercent: number;
  trustedAt: string;
};

export type HarvestLedger = {
  version: 1;
  initializedAt: string;
  activeSession: { id: string; observedAt: string } | null;
  consumedSessionIds: string[];
  records: TrustedTomatoRecord[];
};

export const trustedTomatoWeights: Record<string, number> = {
  "完美的🍅": 1,
  "有小瑕疵🍅": 0.9,
  "有大瑕疵🍅": 0.8,
  "被啃了一口🍅": 0.7,
  "半个🍅": 0.5
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function recordId(record: TomatoRecord, allowLegacyId: boolean) {
  const explicit = boundedText(record.id, 128);
  if (explicit) return explicit;
  if (!allowLegacyId) return "";
  return `legacy_${crypto.createHash("sha256").update(JSON.stringify({
    date: record.date,
    no: record.no,
    startTime: record.startTime,
    endTime: record.endTime,
    taskGoal: record.taskGoal,
    completionContent: record.completionContent,
    createdAt: record.createdAt
  })).digest("hex").slice(0, 24)}`;
}

export function normalizeTrustedTomatoRecord(
  record: TomatoRecord,
  options: { allowLegacyId: boolean; now?: Date; preserveTrustedWeight?: boolean }
): TrustedTomatoRecord | null {
  const id = recordId(record, options.allowLegacyId);
  const date = boundedText(record.date, 10);
  const tomatoStatus = boundedText(record.tomatoStatus, 32);
  const completionPercent = Number(record.completionPercent);
  const createdAt = boundedText(record.createdAt, 40);
  const createdTime = new Date(createdAt).getTime();
  const now = options.now ?? new Date();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(tomatoStatus in trustedTomatoWeights)) return null;
  if (!Number.isFinite(completionPercent) || completionPercent < 0 || completionPercent > 100) return null;
  if (!Number.isFinite(createdTime) || createdTime > now.getTime() + 5 * 60 * 1000) return null;
  const statusWeight = trustedTomatoWeights[tomatoStatus];
  const storedWeight = Number(record.tomatoWeight);
  const tomatoWeight = options.preserveTrustedWeight && Number.isFinite(storedWeight)
    ? Math.min(statusWeight, Math.max(0, storedWeight))
    : statusWeight;
  return {
    id,
    date,
    no: Number.isFinite(Number(record.no)) ? Math.max(0, Math.floor(Number(record.no))) : 0,
    startTime: boundedText(record.startTime, 16),
    endTime: boundedText(record.endTime, 16),
    taskGoal: boundedText(record.taskGoal, 500),
    completionContent: boundedText(record.completionContent, 2_000),
    completionPercent,
    startBattery: Number(record.startBattery),
    endBattery: Number(record.endBattery),
    startMood: Number(record.startMood),
    endMood: Number(record.endMood),
    tomatoStatus,
    tomatoWeight: Math.round(tomatoWeight * 100) / 100,
    remark: boundedText(record.remark, 1_000),
    relatedTaskId: boundedText(record.relatedTaskId, 128),
    createdAt,
    trustedAt: now.toISOString()
  } satisfies TrustedTomatoRecord;
}

function stateRecords(state: unknown) {
  const source = objectValue(state);
  return Array.isArray(source?.records)
    ? source.records.filter((record): record is TomatoRecord => Boolean(objectValue(record)))
    : [];
}

function activePomodoro(state: unknown) {
  return objectValue(objectValue(state)?.activePomodoro);
}

function activeSession(value: Record<string, unknown> | null, observedAt: string) {
  const id = boundedText(value?.id, 128);
  return id ? { id, observedAt } : null;
}

function uniqueRecords(records: TrustedTomatoRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

export function createHarvestLedger(state: unknown, now = new Date()): HarvestLedger {
  const active = activePomodoro(state);
  const observedSession = activeSession(active, now.toISOString());
  const records = uniqueRecords(stateRecords(state)
    .map((record) => normalizeTrustedTomatoRecord(record, { allowLegacyId: true, now }))
    .filter((record): record is TrustedTomatoRecord => Boolean(record)));
  return {
    version: 1,
    initializedAt: now.toISOString(),
    activeSession: observedSession,
    consumedSessionIds: observedSession && (active?.recordSubmitted === true || boundedText(active?.submittedRecordId, 128))
      ? [observedSession.id]
      : [],
    records
  };
}

export function normalizeHarvestLedger(value: unknown): HarvestLedger | null {
  const source = objectValue(value);
  if (source?.version !== 1 || !Array.isArray(source.records) || typeof source.initializedAt !== "string") return null;
  const records = uniqueRecords(source.records
    .map((record) => objectValue(record))
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => {
      const trustedAt = new Date(String(record.trustedAt ?? source.initializedAt));
      return normalizeTrustedTomatoRecord(record, {
        allowLegacyId: true,
        now: Number.isFinite(trustedAt.getTime()) ? trustedAt : new Date(),
        preserveTrustedWeight: true
      });
    })
    .filter((record): record is TrustedTomatoRecord => Boolean(record)));
  const active = objectValue(source.activeSession);
  return {
    version: 1,
    initializedAt: source.initializedAt,
    activeSession: active && typeof active.id === "string" && typeof active.observedAt === "string"
      ? { id: active.id, observedAt: active.observedAt }
      : null,
    consumedSessionIds: Array.isArray(source.consumedSessionIds)
      ? Array.from(new Set(source.consumedSessionIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))).slice(-5_000)
      : [],
    records
  };
}

export function updateHarvestLedger(ledger: HarvestLedger, previousState: unknown, nextState: unknown, now = new Date()) {
  const records = [...ledger.records];
  const trustedIds = new Set(records.map((record) => record.id));
  const previousActive = activePomodoro(previousState);
  const nextActive = activePomodoro(nextState);
  const nextRawRecords = stateRecords(nextState);
  const newRecords = nextRawRecords.filter((record) => {
    const id = recordId(record, false);
    return id && !trustedIds.has(id);
  });
  const observedActiveId = ledger.activeSession?.id;
  const consumedSessionIds = new Set(ledger.consumedSessionIds);
  const previousActiveId = boundedText(previousActive?.id, 128);
  const submittedRecordId = boundedText(nextActive?.submittedRecordId, 128);
  const acceptedId = observedActiveId && !consumedSessionIds.has(observedActiveId) && previousActiveId === observedActiveId
    ? submittedRecordId || (!nextActive && newRecords.length === 1 ? recordId(newRecords[0], false) : "")
    : "";
  const acceptedRecord = newRecords.find((record) => recordId(record, false) === acceptedId);
  if (acceptedRecord) {
    const normalized = normalizeTrustedTomatoRecord(acceptedRecord, { allowLegacyId: false, now });
    if (normalized && ledger.activeSession) {
      const observedAt = new Date(ledger.activeSession.observedAt).getTime();
      const elapsedWeight = Number.isFinite(observedAt)
        ? Math.min(1, Math.max(0, (now.getTime() - observedAt) / (25 * 60 * 1000)))
        : 0;
      normalized.tomatoWeight = Math.round(Math.min(normalized.tomatoWeight, elapsedWeight) * 100) / 100;
      records.push(normalized);
      consumedSessionIds.add(observedActiveId!);
    }
  }
  const nextActiveSession = activeSession(nextActive, now.toISOString());
  return {
    ...ledger,
    activeSession: nextActiveSession?.id === ledger.activeSession?.id ? ledger.activeSession : nextActiveSession,
    consumedSessionIds: Array.from(consumedSessionIds).slice(-5_000),
    records
  } satisfies HarvestLedger;
}

export function trustedTomatoWeight(record: TomatoRecord) {
  const statusWeight = trustedTomatoWeights[String(record.tomatoStatus ?? "")] ?? 0;
  const storedWeight = Number(record.tomatoWeight);
  return Number.isFinite(storedWeight)
    ? Math.round(Math.min(statusWeight, Math.max(0, storedWeight)) * 100) / 100
    : statusWeight;
}
