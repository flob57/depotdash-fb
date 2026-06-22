import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  haversineMeters,
  matchStop,
  pickClosestPoint,
  type StopPoint,
} from "./stops-matcher";

export type VehiclePos = {
  entityId: string;
  vehicleLabel: string | null;
  vehicleId: string | null;
  routeId: string | null;
  tripId: string | null;
  lat: number;
  lon: number;
  timestamp: number | null;
};

const STORAGE_KEY = "gtfsrt_feed_v1";

export function decodeGtfsRt(buffer: ArrayBuffer | Uint8Array): {
  vehicles: VehiclePos[];
  feedTimestamp: number | null;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
  const vehicles: VehiclePos[] = [];
  for (const ent of feed.entity ?? []) {
    const v = ent.vehicle;
    if (!v?.position) continue;
    vehicles.push({
      entityId: String(ent.id ?? ""),
      vehicleLabel: v.vehicle?.label ?? null,
      vehicleId: v.vehicle?.id ?? null,
      routeId: v.trip?.routeId ?? null,
      tripId: v.trip?.tripId ?? null,
      lat: v.position.latitude,
      lon: v.position.longitude,
      timestamp: v.timestamp ? Number(v.timestamp) : null,
    });
  }
  const fts = feed.header?.timestamp ? Number(feed.header.timestamp) : null;
  return { vehicles, feedTimestamp: fts };
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function saveFeedToStorage(bytes: Uint8Array) {
  if (typeof window === "undefined") return;
  const payload = {
    b64: b64Encode(bytes),
    uploadedAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new Event("gtfsrt:updated"));
}

export function loadFeedFromStorage(): {
  vehicles: VehiclePos[];
  feedTimestamp: number | null;
  uploadedAt: number;
} | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const { b64, uploadedAt } = JSON.parse(raw) as {
      b64: string;
      uploadedAt: number;
    };
    const { vehicles, feedTimestamp } = decodeGtfsRt(b64Decode(b64));
    return { vehicles, feedTimestamp, uploadedAt };
  } catch {
    return null;
  }
}

export function clearFeedFromStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("gtfsrt:updated"));
}

/** Normalise a route identifier for fuzzy comparison. */
function normRoute(s: string | null | undefined): string {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Try to match a vehicle to a departure by:
 *  1) vehicle label = departure.vehicle
 *  2) GTFS routeId matches the departure route label (e.g. "P174" / "6")
 */
export function findVehicleForDeparture(
  vehicles: VehiclePos[],
  dep: { route: string; vehicle: string | null },
): VehiclePos | null {
  const depVeh = normRoute(dep.vehicle);
  if (depVeh) {
    const byVeh = vehicles.find(
      (v) => normRoute(v.vehicleLabel) === depVeh || normRoute(v.vehicleId) === depVeh,
    );
    if (byVeh) return byVeh;
  }
  const depRoute = normRoute(dep.route.split(".")[0]);
  if (depRoute) {
    const byRoute = vehicles.filter((v) => normRoute(v.routeId) === depRoute);
    if (byRoute.length === 1) return byRoute[0];
    // multiple buses on the same route — prefer one whose vehicle label matches digits
    if (byRoute.length > 1 && depVeh) {
      const m = byRoute.find((v) => normRoute(v.vehicleLabel) === depVeh);
      if (m) return m;
    }
  }
  return null;
}

export type TimetableStopGeo = {
  stop: string;
  time: string;
  mins: number;
  point: StopPoint | null;
};

/** Resolve GPS coordinates for a timetable, using the vehicle position to pick directional duplicates. */
export function geocodeTimetable(
  timetable: { stop: string; time: string }[],
  vehicleLat: number,
  vehicleLon: number,
): TimetableStopGeo[] {
  return timetable.map((s) => {
    const [h, m] = s.time.split(":");
    const mins = Number(h) * 60 + Number(m);
    const match = matchStop(s.stop);
    let point: StopPoint | null = null;
    if (match) {
      const picked = pickClosestPoint(match.matched, vehicleLat, vehicleLon);
      point = picked?.point ?? null;
    }
    return { stop: s.stop, time: s.time, mins, point };
  });
}

/**
 * Project the vehicle position onto the timetable polyline.
 * Returns segment index, fraction within segment, and chart % (0..100).
 * Also estimates the "theoretical timetable time" at the vehicle location.
 */
export function projectVehicleOnTimetable(
  stops: TimetableStopGeo[],
  vLat: number,
  vLon: number,
): {
  pct: number;
  segIndex: number;
  frac: number;
  theoreticalMins: number;
  perpDistance: number;
} | null {
  const geo = stops.filter((s) => s.point);
  if (geo.length < 2) return null;
  const sorted = [...geo].sort((a, b) => a.mins - b.mins);

  let bestIdx = 0;
  let bestFrac = 0;
  let bestDist = Infinity;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i].point!;
    const b = sorted[i + 1].point!;
    // Approximate planar projection in metres
    const segLen = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    if (segLen < 1) continue;
    // Vector AB and AV (using equirectangular approx in metres)
    const latRef = (a.lat + b.lat) / 2;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((latRef * Math.PI) / 180);
    const abx = (b.lon - a.lon) * mPerDegLon;
    const aby = (b.lat - a.lat) * mPerDegLat;
    const avx = (vLon - a.lon) * mPerDegLon;
    const avy = (vLat - a.lat) * mPerDegLat;
    const ab2 = abx * abx + aby * aby;
    let t = (avx * abx + avy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const projx = abx * t;
    const projy = aby * t;
    const dx = avx - projx;
    const dy = avy - projy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
      bestFrac = t;
    }
  }

  // Map back to original timetable index space (use all stops, not just geo ones)
  // For chart %, use position relative to the full timetable list using time interpolation.
  const a = sorted[bestIdx];
  const b = sorted[bestIdx + 1];
  const theoreticalMins = a.mins + (b.mins - a.mins) * bestFrac;

  // chart pct: locate this time within the full stop list
  const all = [...stops].sort((x, y) => x.mins - y.mins);
  let pct = 0;
  if (theoreticalMins <= all[0].mins) pct = 0;
  else if (theoreticalMins >= all[all.length - 1].mins) pct = 100;
  else {
    for (let i = 0; i < all.length - 1; i++) {
      if (theoreticalMins >= all[i].mins && theoreticalMins <= all[i + 1].mins) {
        const span = all[i + 1].mins - all[i].mins;
        const frac = span === 0 ? 0 : (theoreticalMins - all[i].mins) / span;
        pct = ((i + frac) / (all.length - 1)) * 100;
        break;
      }
    }
  }

  return {
    pct,
    segIndex: bestIdx,
    frac: bestFrac,
    theoreticalMins,
    perpDistance: bestDist,
  };
}

export function formatDelay(deltaSeconds: number): string {
  if (Math.abs(deltaSeconds) < 30) return "À l'heure";
  const sign = deltaSeconds >= 0 ? "+" : "−";
  const abs = Math.abs(deltaSeconds);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  return `${sign}${m}m ${String(s).padStart(2, "0")}s`;
}

/** delaySeconds > 0 = late, < 0 = early. */
export function delayColor(delaySeconds: number): "green" | "orange" | "red" {
  if (delaySeconds < -30) return "red"; // early
  if (delaySeconds > 5 * 60) return "orange"; // > 5 min late
  return "green";
}
