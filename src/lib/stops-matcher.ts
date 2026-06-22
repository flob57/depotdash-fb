import stopsData from "@/data/gtfs-stops.json";

export type StopPoint = { id: string; lat: number; lon: number };
export type StopEntry = { name: string; norm: string; points: StopPoint[] };

const STOPS = stopsData as StopEntry[];

export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

export type StopMatch = {
  matched: StopEntry;
  confidence: "exact" | "high" | "low";
  distance: number;
} | null;

/** Fuzzy-match a timetable stop name to a GTFS stop entry. */
export function matchStop(name: string): StopMatch {
  const q = normalizeName(name);
  if (!q) return null;

  // Exact
  const exact = STOPS.find((s) => s.norm === q);
  if (exact) return { matched: exact, confidence: "exact", distance: 0 };

  // Containment (one side fully includes the other)
  const contains = STOPS.filter((s) => s.norm.includes(q) || q.includes(s.norm));
  if (contains.length === 1) {
    return { matched: contains[0], confidence: "high", distance: 0 };
  }

  // Levenshtein
  let best: StopEntry | null = null;
  let bestD = Infinity;
  let second = Infinity;
  for (const s of STOPS) {
    const d = levenshtein(q, s.norm);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = s;
    } else if (d < second) {
      second = d;
    }
  }
  if (!best) return null;
  const maxLen = Math.max(q.length, best.norm.length);
  const ratio = 1 - bestD / maxLen;
  // Require clear gap from runner-up to call it high-confidence
  if (ratio >= 0.85 && second - bestD >= 2) {
    return { matched: best, confidence: "high", distance: bestD };
  }
  if (ratio >= 0.75 && second - bestD >= 1) {
    return { matched: best, confidence: "low", distance: bestD };
  }
  return null;
}

/** Haversine distance in metres. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Pick the closest of an entry's points to a position. */
export function pickClosestPoint(
  entry: StopEntry,
  lat: number,
  lon: number,
): { point: StopPoint; distance: number } | null {
  if (!entry.points.length) return null;
  let best = entry.points[0];
  let bestD = haversineMeters(lat, lon, best.lat, best.lon);
  for (let i = 1; i < entry.points.length; i++) {
    const p = entry.points[i];
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { point: best, distance: bestD };
}
