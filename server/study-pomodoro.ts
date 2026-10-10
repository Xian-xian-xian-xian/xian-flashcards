// The study page needs the current timer, not the growing history or attachments.
export function studyPomodoroState(state: Record<string, unknown> | null) {
  const active = state?.activePomodoro;
  if (!active || typeof active !== "object" || Array.isArray(active)) return { activePomodoro: null };
  const value = active as Record<string, unknown>;
  return {
    activePomodoro: {
      no: value.no,
      taskGoal: typeof value.taskGoal === "string" ? value.taskGoal.slice(0, 1000) : undefined,
      durationSeconds: value.durationSeconds,
      breakDurationSeconds: value.breakDurationSeconds,
      remainingSeconds: value.remainingSeconds,
      status: value.status,
      phase: value.phase,
      endAt: value.endAt
    }
  };
}
