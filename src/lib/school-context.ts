export type SchoolHoliday = {
  id: string;
  label: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
};

export type ServiceSlot = "weekday" | "wed" | "sat_hol";

export const SLOT_LABELS: Record<ServiceSlot, string> = {
  weekday: "Services Lestonan période scolaire (L/M/J/V)",
  wed: "Services Mer PS (Mercredi période scolaire)",
  sat_hol: "Services Sam + PV (Samedi + vacances)",
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isHoliday(date: Date, holidays: SchoolHoliday[]): boolean {
  const k = ymd(date);
  return holidays.some((h) => k >= h.start_date && k <= h.end_date);
}

/** Returns ISO weekday: Mon=1..Sun=7 */
export function isoWeekday(date: Date) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

export function pickSlot(date: Date, holidays: SchoolHoliday[]): ServiceSlot {
  const wd = isoWeekday(date);
  const holiday = isHoliday(date, holidays);
  // Sunday: keep sat_hol as the fallback (no service typically, but pick something valid)
  if (wd === 7) return "sat_hol";
  if (holiday) return "sat_hol"; // Mon–Sat during holidays
  // School term:
  if (wd === 6) return "sat_hol"; // Saturday term
  if (wd === 3) return "wed"; // Wednesday term
  return "weekday"; // Mon, Tue, Thu, Fri term
}
