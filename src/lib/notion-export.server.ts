// Shared Notion export helpers, callable from both authenticated server
// functions (user-scoped supabase) and the cron route (supabaseAdmin).

import { formatHm } from "@/lib/stats";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/notion/v1";

type NotionProp = { id: string; name: string; type: string };
type NotionDb = { properties: Record<string, NotionProp> };

export async function notionFetch(path: string, init: RequestInit = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!NOTION_API_KEY) throw new Error("Notion is not connected");

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": NOTION_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Notion API error [${res.status}]: ${(data as { message?: string }).message ?? JSON.stringify(data)}`,
    );
  }
  return data;
}

function extractId(raw: string): string {
  const source = raw.trim();
  let idSource = source;
  try {
    const url = new URL(source);
    idSource = url.pathname;
  } catch {
    /* plain ID */
  }
  const cleaned = idSource.replace(/-/g, "");
  const matches = cleaned.match(/[0-9a-f]{32}/gi);
  if (!matches || matches.length === 0) {
    throw new Error("Could not find a Notion database ID in the value provided.");
  }
  return matches[matches.length - 1];
}

function toDashed(id: string): string {
  const c = id.replace(/-/g, "");
  if (c.length !== 32) return id;
  return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;
}

async function searchForDatabase(
  targetId: string,
): Promise<{ id: string; properties: NotionDb["properties"] } | null> {
  const target = targetId.replace(/-/g, "").toLowerCase();
  try {
    const res = (await notionFetch(`/search`, {
      method: "POST",
      body: JSON.stringify({ filter: { value: "database", property: "object" }, page_size: 100 }),
    })) as { results: Array<{ id: string; object: string; properties?: NotionDb["properties"] }> };
    const hit = res.results.find(
      (r) => r.object === "database" && r.id.replace(/-/g, "").toLowerCase() === target,
    );
    if (hit && hit.properties) return { id: hit.id, properties: hit.properties };
  } catch {
    /* ignore */
  }
  return null;
}

export async function resolveDatabase(rawId: string): Promise<{ id: string; db: NotionDb }> {
  const id = extractId(rawId);
  const dashed = toDashed(id);
  for (const tryId of [dashed, id]) {
    try {
      const db = (await notionFetch(`/databases/${tryId}`)) as NotionDb;
      return { id: tryId, db };
    } catch {
      /* try next */
    }
  }
  try {
    const children = (await notionFetch(`/blocks/${dashed}/children?page_size=100`)) as {
      results: Array<{ id: string; type: string }>;
    };
    const childDb = children.results.find((b) => b.type === "child_database");
    if (childDb) {
      const db = (await notionFetch(`/databases/${childDb.id}`)) as NotionDb;
      return { id: childDb.id, db };
    }
  } catch {
    /* fall through */
  }
  const found = await searchForDatabase(id);
  if (found) return { id: found.id, db: { properties: found.properties } };
  throw new Error(
    `Notion can't see this database. Open it in Notion → "..." menu → Connections → add "Lovable".`,
  );
}

export function propFinder(db: NotionDb) {
  const map = Object.entries(db.properties).reduce<Record<string, NotionProp>>((acc, [name, p]) => {
    acc[name.toLowerCase()] = { ...p, name };
    return acc;
  }, {});
  const title = Object.values(db.properties).find((p) => p.type === "title");
  if (!title) throw new Error("Target Notion database has no title property.");
  const find = (name: string, type: string) => {
    const p = map[name.toLowerCase()];
    return p && p.type === type ? p.name : null;
  };
  return { title, find };
}

export async function createPage(databaseId: string, properties: Record<string, unknown>) {
  await notionFetch(`/pages`, {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
}

// Add a "Duration" property: prefer rich_text "Xh YYm", fallback to number (minutes).
function setDurationProp(
  properties: Record<string, unknown>,
  find: (name: string, type: string) => string | null,
  durationMs: number,
) {
  const minutes = Math.round(durationMs / 60000);
  const text = formatHm(durationMs);
  const textProp =
    find("Duration", "rich_text") ??
    find("Duration (h:m)", "rich_text") ??
    find("Duration (hm)", "rich_text");
  if (textProp) {
    properties[textProp] = { rich_text: [{ text: { content: text } }] };
    return;
  }
  const numProp = find("Duration (min)", "number") ?? find("Duration", "number");
  if (numProp) properties[numProp] = { number: minutes };
}

// ---- Minimal supabase client shape we need ----
type Sb = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string,
      ) => {
        gte: (
          c: string,
          v: string,
        ) => {
          lte: (
            c: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
};

type DrivingSession = {
  start_at: string;
  end_at: string | null;
  km_start: number | null;
  km_end: number | null;
  bus_reference: string | null;
};
type Shift = { on_duty_at: string; off_duty_at: string | null };

export type ExportResult = { exported: number; skipped: number; total: number; errors: string[] };

export async function exportSessionsRange(
  supabase: Sb,
  userId: string,
  databaseId: string,
  from: Date,
  to: Date,
): Promise<ExportResult> {
  const { data, error } = await supabase
    .from("driving_sessions")
    .select("id, start_at, end_at, km_start, km_end, bus_reference")
    .eq("user_id", userId)
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString())
    .order("start_at", { ascending: true });
  if (error) throw new Error(error.message);
  const sessions = (data ?? []) as DrivingSession[];
  if (sessions.length === 0) return { exported: 0, skipped: 0, total: 0, errors: [] };

  const { id: dbId, db } = await resolveDatabase(databaseId);
  const { title, find } = propFinder(db);

  const busProp = find("Bus", "rich_text") ?? find("Bus reference", "rich_text");
  const startProp = find("Start", "date") ?? find("Start at", "date");
  const stopProp = find("Stop", "date") ?? find("End", "date") ?? find("End at", "date");
  const distanceProp = find("Distance (km)", "number") ?? find("Distance", "number");
  const kmStartProp = find("km start", "number") ?? find("KM start", "number");
  const kmEndProp = find("km end", "number") ?? find("KM end", "number");

  let exported = 0,
    skipped = 0;
  const errors: string[] = [];
  for (const s of sessions) {
    if (!s.end_at) {
      skipped++;
      continue;
    }
    const start = new Date(s.start_at);
    const end = new Date(s.end_at);
    const distance =
      s.km_start != null && s.km_end != null ? Math.max(0, s.km_end - s.km_start) : null;
    const titleText = `${start.toISOString().slice(0, 10)} · ${s.bus_reference ?? "bus"}`;

    const properties: Record<string, unknown> = {
      [title.name]: { title: [{ text: { content: titleText } }] },
    };
    if (busProp)
      properties[busProp] = { rich_text: [{ text: { content: s.bus_reference ?? "" } }] };
    if (startProp) properties[startProp] = { date: { start: start.toISOString() } };
    if (stopProp) properties[stopProp] = { date: { start: end.toISOString() } };
    setDurationProp(properties, find, end.getTime() - start.getTime());
    if (distanceProp && distance != null) properties[distanceProp] = { number: distance };
    if (kmStartProp && s.km_start != null) properties[kmStartProp] = { number: s.km_start };
    if (kmEndProp && s.km_end != null) properties[kmEndProp] = { number: s.km_end };

    try {
      await createPage(dbId, properties);
      exported++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { exported, skipped, total: sessions.length, errors: errors.slice(0, 3) };
}

export async function exportShiftsRange(
  supabase: Sb,
  userId: string,
  databaseId: string,
  from: Date,
  to: Date,
): Promise<ExportResult> {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, on_duty_at, off_duty_at")
    .eq("user_id", userId)
    .gte("on_duty_at", from.toISOString())
    .lte("on_duty_at", to.toISOString())
    .order("on_duty_at", { ascending: true });
  if (error) throw new Error(error.message);
  const shifts = (data ?? []) as Shift[];
  if (shifts.length === 0) return { exported: 0, skipped: 0, total: 0, errors: [] };

  const { id: dbId, db } = await resolveDatabase(databaseId);
  const { title, find } = propFinder(db);

  const onProp = find("On duty", "date") ?? find("Start", "date");
  const offProp = find("Off duty", "date") ?? find("Stop", "date") ?? find("End", "date");

  let exported = 0,
    skipped = 0;
  const errors: string[] = [];
  for (const s of shifts) {
    if (!s.off_duty_at) {
      skipped++;
      continue;
    }
    const start = new Date(s.on_duty_at);
    const end = new Date(s.off_duty_at);
    const titleText = `${start.toISOString().slice(0, 10)} · on-duty`;

    const properties: Record<string, unknown> = {
      [title.name]: { title: [{ text: { content: titleText } }] },
    };
    if (onProp) properties[onProp] = { date: { start: start.toISOString() } };
    if (offProp) properties[offProp] = { date: { start: end.toISOString() } };
    setDurationProp(properties, find, end.getTime() - start.getTime());

    try {
      await createPage(dbId, properties);
      exported++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { exported, skipped, total: shifts.length, errors: errors.slice(0, 3) };
}

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

export async function exportDailyTotalsRange(
  supabase: Sb,
  userId: string,
  databaseId: string,
  from: Date,
  to: Date,
): Promise<ExportResult> {
  const [shiftsRes, sessionsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, on_duty_at, off_duty_at")
      .eq("user_id", userId)
      .gte("on_duty_at", from.toISOString())
      .lte("on_duty_at", to.toISOString())
      .order("on_duty_at", { ascending: true }),
    supabase
      .from("driving_sessions")
      .select("id, start_at, end_at, km_start, km_end, bus_reference")
      .eq("user_id", userId)
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString())
      .order("start_at", { ascending: true }),
  ]);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  const totals = computeDailyTotals(
    (shiftsRes.data ?? []) as Shift[],
    (sessionsRes.data ?? []) as DrivingSession[],
  );
  if (totals.length === 0) return { exported: 0, skipped: 0, total: 0, errors: [] };

  const { id: dbId, db } = await resolveDatabase(databaseId);
  const { title, find } = propFinder(db);

  const dateProp = find("Date", "date");
  // Prefer rich_text columns named "On duty" / "Driving"; fall back to number(min).
  const onTextProp = find("On duty", "rich_text") ?? find("On duty (h:m)", "rich_text");
  const drivingTextProp = find("Driving", "rich_text") ?? find("Driving (h:m)", "rich_text");
  const onNumProp = find("On duty (min)", "number") ?? find("On duty", "number");
  const drivingNumProp = find("Driving (min)", "number") ?? find("Driving", "number");
  const pctProp = find("Driving %", "number") ?? find("Percent", "number");

  let exported = 0;
  const errors: string[] = [];
  for (const t of totals) {
    const properties: Record<string, unknown> = {
      [title.name]: { title: [{ text: { content: t.date } }] },
    };
    if (dateProp) properties[dateProp] = { date: { start: t.date } };
    if (onTextProp)
      properties[onTextProp] = { rich_text: [{ text: { content: formatHm(t.onDutyMs) } }] };
    else if (onNumProp) properties[onNumProp] = { number: Math.round(t.onDutyMs / 60000) };
    if (drivingTextProp)
      properties[drivingTextProp] = {
        rich_text: [{ text: { content: formatHm(t.drivingMs) } }],
      };
    else if (drivingNumProp)
      properties[drivingNumProp] = { number: Math.round(t.drivingMs / 60000) };
    if (pctProp) properties[pctProp] = { number: Math.round(t.percent * 10) / 10 };

    try {
      await createPage(dbId, properties);
      exported++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { exported, skipped: 0, total: totals.length, errors: errors.slice(0, 3) };
}

// Export a single "distance summary" row (Period + Total km).
export async function exportDistanceSummary(
  supabase: Sb,
  userId: string,
  databaseId: string,
  periodLabel: string,
  from: Date,
  to: Date,
): Promise<ExportResult> {
  const { data, error } = await supabase
    .from("driving_sessions")
    .select("id, start_at, end_at, km_start, km_end, bus_reference")
    .eq("user_id", userId)
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString())
    .order("start_at", { ascending: true });
  if (error) throw new Error(error.message);
  const sessions = (data ?? []) as DrivingSession[];
  let km = 0;
  for (const s of sessions) {
    if (s.km_start != null && s.km_end != null) km += Math.max(0, s.km_end - s.km_start);
  }

  const { id: dbId, db } = await resolveDatabase(databaseId);
  const { title, find } = propFinder(db);

  const periodProp = find("Period", "rich_text") ?? find("Period", "select");
  const kmProp = find("Total km", "number") ?? find("Km", "number") ?? find("Distance", "number");
  const dateProp = find("Date", "date");

  const titleText = `${periodLabel} · ${to.toISOString().slice(0, 10)}`;
  const properties: Record<string, unknown> = {
    [title.name]: { title: [{ text: { content: titleText } }] },
  };
  if (periodProp) {
    const propMeta = db.properties[periodProp];
    if (propMeta?.type === "select") {
      properties[periodProp] = { select: { name: periodLabel } };
    } else {
      properties[periodProp] = { rich_text: [{ text: { content: periodLabel } }] };
    }
  }
  if (kmProp) properties[kmProp] = { number: km };
  if (dateProp) properties[dateProp] = { date: { start: to.toISOString().slice(0, 10) } };

  try {
    await createPage(dbId, properties);
    return { exported: 1, skipped: 0, total: 1, errors: [] };
  } catch (e) {
    return { exported: 0, skipped: 0, total: 1, errors: [(e as Error).message] };
  }
}

// ---- Timezone helpers ----

function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
    hour12: false,
  }).formatToParts(at);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] ?? "0", 10));
}

export type LocalDayInfo = {
  from: Date; // local 00:00:00 as UTC instant
  to: Date; // local 23:59:59.999 as UTC instant
  year: number;
  month: number; // 0-11
  day: number;
  dayOfWeek: number; // 0=Sun
  isLastDayOfMonth: boolean;
  isLastDayOfYear: boolean;
};

export function localDayInfo(tz: string, now = new Date()): LocalDayInfo {
  const offMin = tzOffsetMinutes(tz, now);
  const shifted = new Date(now.getTime() + offMin * 60000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const dow = shifted.getUTCDay();
  const fromUtc = new Date(Date.UTC(y, m, d) - offMin * 60000);
  const toUtc = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - offMin * 60000);
  // Tomorrow local date
  const tomorrow = new Date(Date.UTC(y, m, d + 1));
  const isLastDayOfMonth = tomorrow.getUTCMonth() !== m;
  const isLastDayOfYear = tomorrow.getUTCFullYear() !== y;
  return {
    from: fromUtc,
    to: toUtc,
    year: y,
    month: m,
    day: d,
    dayOfWeek: dow,
    isLastDayOfMonth,
    isLastDayOfYear,
  };
}

export function weekRangeLocal(tz: string, now = new Date()): { from: Date; to: Date } {
  // Week ending on Sunday (matches "This week" expectation: Mon–Sun).
  const day = localDayInfo(tz, now);
  // ISO week starts Monday: Mon=1..Sun=0; offset back to most recent Monday
  const offsetToMonday = day.dayOfWeek === 0 ? 6 : day.dayOfWeek - 1;
  const offMin = tzOffsetMinutes(tz, now);
  const from = new Date(Date.UTC(day.year, day.month, day.day - offsetToMonday) - offMin * 60000);
  return { from, to: day.to };
}

export function monthRangeLocal(tz: string, now = new Date()): { from: Date; to: Date } {
  const day = localDayInfo(tz, now);
  const offMin = tzOffsetMinutes(tz, now);
  const from = new Date(Date.UTC(day.year, day.month, 1) - offMin * 60000);
  return { from, to: day.to };
}

export function yearRangeLocal(tz: string, now = new Date()): { from: Date; to: Date } {
  const day = localDayInfo(tz, now);
  const offMin = tzOffsetMinutes(tz, now);
  const from = new Date(Date.UTC(day.year, 0, 1) - offMin * 60000);
  return { from, to: day.to };
}
