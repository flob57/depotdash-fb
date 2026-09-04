export type DeclaredHour = {
  id: string;
  work_date: string; // YYYY-MM-DD
  minutes: number;
  note: string | null;
};

export function sumDeclaredMs(declared: DeclaredHour[]): number {
  return declared.reduce((acc, d) => acc + d.minutes * 60000, 0);
}

// Parse user input like "7.5", "7,5", "7:30", "7h30", "7h", "450m"
// Returns minutes, or null if invalid.
export function parseHoursInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".");
  if (!s) return null;

  // hh:mm or hhhmm
  const colon = s.match(/^(\d+)[:h](\d{0,2})$/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = colon[2] ? parseInt(colon[2], 10) : 0;
    if (isNaN(h) || isNaN(m) || m >= 60) return null;
    return h * 60 + m;
  }

  // pure minutes "120m"
  const minOnly = s.match(/^(\d+)m$/);
  if (minOnly) return parseInt(minOnly[1], 10);

  // decimal hours
  const dec = Number(s);
  if (!isNaN(dec) && dec >= 0) return Math.round(dec * 60);
  return null;
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h}h${m.toString().padStart(2, "0")}`;
}


export function formatDeclaredSchedule(note: string | null): string | null {
  if (!note) return null;
  const ranges = Array.from(note.matchAll(/(?:AM|PM)\s+(\d{1,2}:\d{2})[–-](\d{1,2}:\d{2})/g))
    .map((m) => `${m[1]}–${m[2]}`);
  return ranges.length ? ranges.join(" · ") : null;
}
