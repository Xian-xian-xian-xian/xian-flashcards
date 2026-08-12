export const reviewUndoWindowMs = 15 * 60 * 1000;

export function isReviewDue(dueAt: unknown, now = new Date()) {
  const dueTime = new Date(String(dueAt ?? "")).getTime();
  return Number.isFinite(dueTime) && dueTime <= now.getTime();
}

export function reviewUndoExpiresAt(now = new Date()) {
  return new Date(now.getTime() + reviewUndoWindowMs).toISOString();
}
