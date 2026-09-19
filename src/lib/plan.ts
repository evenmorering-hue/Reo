import type { DayPlan, ShortItem } from "./types";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function nextWeekday(from: Date): Date {
  const d = new Date(from);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Groups items into weekday-only batches of `perDay`, starting from the
 * next weekday, mirroring the "하루 3개 · 주말 제외" publishing cadence. */
export function buildDayPlan(items: ShortItem[], perDay: number): DayPlan[] {
  if (items.length === 0 || perDay <= 0) return [];

  const days: DayPlan[] = [];
  let cursor = nextWeekday(new Date());

  for (let i = 0; i < items.length; i += perDay) {
    const chunk = items.slice(i, i + perDay);
    const label = WEEKDAY_LABELS[cursor.getDay()];
    const dateLabel = `${cursor.getMonth() + 1}.${cursor.getDate()}`;
    days.push({ label, dateLabel, items: chunk });

    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    cursor = nextWeekday(cursor);
  }

  return days;
}
