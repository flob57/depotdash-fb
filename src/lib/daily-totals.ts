import type { Shift, Session as DrivingSession } from "@/lib/stats";

export type DailyTotal = { date: string; onDutyMs: number; drivingMs: number; percent: number };

export function computeDailyTotals(shifts: Shift[], sessions: DrivingSession[]): DailyTotal[] {
  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const acc = new Map<string, { onDutyMs: number; drivingMs: number; anyOpen: boolean }>();
  const ensure = (k: string) => {
    let v = acc.get(k);
    if (!v) {
      v = { onDutyMs: 0, drivingMs: 0, anyOpen: false };
      acc.set(k, v);
    }
    return v;
  };
  for (const s of shifts) {
    const k = dayKey(s.on_duty_at);
    const v = ensure(k);
    if (!s.off_duty_at) {
      v.anyOpen = true;
      continue;
    }
    v.onDutyMs += new Date(s.off_duty_at).getTime() - new Date(s.on_duty_at).getTime();
  }
  for (const s of sessions) {
    const k = dayKey(s.start_at);
    const v = ensure(k);
    if (!s.end_at) {
      v.anyOpen = true;
      continue;
    }
    v.drivingMs += new Date(s.end_at).getTime() - new Date(s.start_at).getTime();
  }
  return Array.from(acc.entries())
    .filter(([, v]) => !v.anyOpen && v.onDutyMs > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({
      date,
      onDutyMs: v.onDutyMs,
      drivingMs: v.drivingMs,
      percent: v.onDutyMs > 0 ? (v.drivingMs / v.onDutyMs) * 100 : 0,
    }));
}
