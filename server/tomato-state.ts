export type TomatoStateWriteAssessment =
  | { ok: true }
  | { ok: false; reason: "invalid_revision" | "revision_conflict" | "record_regression" };

export function validateTomatoState(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "番茄数据格式无效";
  const value = state as Record<string, unknown>;
  if (!Array.isArray(value.records)) return "番茄记录必须是列表";
  for (const key of ["records", "recentTasks", "longTermGoals", "clipboardHistory"]) {
    const items = value[key];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > 20_000) return "番茄数据列表过大或格式无效";
    const ids = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "番茄数据包含无效记录";
      const id = (item as Record<string, unknown>).id;
      if (!["string", "number"].includes(typeof id) || !String(id).trim() || String(id).length > 128 || ids.has(String(id))) return "记录编号无效或重复";
      ids.add(String(id));
    }
  }
  for (const key of ["settings", "activePomodoro"]) {
    if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== "object" || Array.isArray(value[key]))) return "番茄设置格式无效";
  }
  function safeTree(node: unknown, depth: number): boolean {
    if (depth > 32) return false;
    if (!node || typeof node !== "object") return true;
    return Object.entries(node).every(([key, child]) => !["__proto__", "prototype", "constructor"].includes(key) && safeTree(child, depth + 1));
  }
  if (!safeTree(state, 0)) return "番茄数据包含不安全的字段或嵌套过深";
  if (Buffer.byteLength(JSON.stringify(state)) > 8 * 1024 * 1024) return "番茄数据不能超过 8 MB";
  return undefined;
}

function recordCount(state: unknown) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return 0;
  const records = (state as { records?: unknown }).records;
  return Array.isArray(records) ? records.length : 0;
}

export function assessTomatoStateWrite(
  currentRevision: number,
  requestedRevision: unknown,
  currentState: unknown,
  nextState: unknown,
  allowRecordReplacement: boolean
): TomatoStateWriteAssessment {
  if (!Number.isInteger(requestedRevision) || Number(requestedRevision) < 0) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (Number(requestedRevision) !== currentRevision) {
    return { ok: false, reason: "revision_conflict" };
  }

  const currentRecords = recordCount(currentState);
  const nextRecords = recordCount(nextState);
  const suspiciousDrop = Math.max(5, Math.ceil(currentRecords * 0.05));
  if (!allowRecordReplacement && currentRecords - nextRecords >= suspiciousDrop) {
    return { ok: false, reason: "record_regression" };
  }
  return { ok: true };
}
