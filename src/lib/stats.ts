import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  eachDayOfInterval, isWeekend,
} from "date-fns";

export type Shift = {
  id: string;
  on_duty_at: string;
  off_duty_at: string | null;
};

export type Session = {
  id: string;
  shift_id: string | null;
  start_at: string;
  end_at: string | null;
  km_start: number | null;
  km_end: number | null;
  bus_reference: string | null;
};

export const DAILY_DUE_MS = 7.5 * 3600 * 1000; // 7h30
export const WEEKLY_DUE_MS = 37.5 * 3600 * 1000; // 37h30

export function overlap(start: Date, end: Date, from: Date, to: Date): number {
  const s = Math.max(start.getTime(), from.getTime());
  const e = Math.min(end.getTime(), to.getTime());
  return Math.max(0, e - s);
}

export function sumShiftsMs(shifts: Shift[], from: Date, to: Date, now = new Date()): number {
  let total = 0;
  for (const s of shifts) {
    const start = new Date(s.on_duty_at);
    const end = s.off_duty_at ? new Date(s.off_duty_at) : now;
    total += overlap(start, end, from, to);
  }
  return total;
}

export function sumDrivingMs(sessions: Session[], from: Date, to: Date, now = new Date()): number {
  let total = 0;
  for (const s of sessions) {
    const start = new Date(s.start_at);
    const end = s.end_at ? new Date(s.end_at) : now;
    total += overlap(start, end, from, to);
  }
  return total;
}

export function sumKm(sessions: Session[], from: Date, to: Date): number {
  let total = 0;
  for (const s of sessions) {
    if (s.km_start == null || s.km_end == null) continue;
    const start = new Date(s.start_at);
    if (start >= from && start <= to) total += Math.max(0, s.km_end - s.km_start);
  }
  return total;
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isHoliday(d: Date, holidays?: Set<string>): boolean {
  return !!holidays && holidays.has(dateKey(d));
}

export function dueHoursMs(from: Date, to: Date, holidays?: Set<string>): number {
  // 7h30 per weekday (Mon-Fri), excluding public holidays
  const days = eachDayOfInterval({ start: startOfDay(from), end: startOfDay(to) });
  let count = 0;
  for (const d of days) if (!isWeekend(d) && !isHoliday(d, holidays)) count++;
  return count * DAILY_DUE_MS;
}

export function ranges(now = new Date()) {
  return {
    day: { from: startOfDay(now), to: endOfDay(now) },
    week: { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) },
    month: { from: startOfMonth(now), to: endOfMonth(now) },
    year: { from: startOfYear(now), to: endOfYear(now) },
  };
}

export function formatHm(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

export function formatHmSigned(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  return sign + formatHm(Math.abs(ms));
}
