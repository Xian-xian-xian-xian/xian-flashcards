const dayMilliseconds = 24 * 60 * 60 * 1000;

function parseDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? date
    : null;
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isDateKey(value: string) {
  return Boolean(parseDateKey(value));
}

export function addDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error(`无效日期：${dateKey}`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function isoWeekIdForDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error(`无效日期：${dateKey}`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / dayMilliseconds) + 1) / 7);
  return `${weekYear}-${String(week).padStart(2, "0")}`;
}

export function mondayDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) throw new Error(`无效日期：${dateKey}`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return formatDateKey(date);
}

export function dailyStreak(completedDates: Iterable<string>, today: string) {
  const completed = new Set(completedDates);
  let cursor = completed.has(today) ? today : addDateKey(today, -1);
  let streak = 0;
  while (completed.has(cursor)) {
    streak += 1;
    cursor = addDateKey(cursor, -1);
  }
  return streak;
}

export function currentWeekMakeupDates(completedDates: Iterable<string>, today: string) {
  const completed = new Set(completedDates);
  const monday = mondayDateKey(today);
  const dates: string[] = [];
  for (let cursor = monday; cursor < today; cursor = addDateKey(cursor, 1)) {
    if (!completed.has(cursor)) dates.push(cursor);
  }
  return dates;
}
