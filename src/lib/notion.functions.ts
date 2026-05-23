import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/notion/v1";

type NotionProp = { id: string; name: string; type: string };
type NotionDb = { properties: Record<string, NotionProp> };

async function notionFetch(path: string, init: RequestInit = {}) {
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
  const cleaned = raw.replace(/-/g, "");
  const matches = cleaned.match(/[0-9a-f]{32}/gi);
  if (!matches || matches.length === 0) {
    throw new Error("Could not find a Notion database ID in the value provided.");
  }
  return matches[matches.length - 1];
}

async function resolveDatabase(rawId: string): Promise<{ id: string; db: NotionDb }> {
  const id = extractId(rawId);
  try {
    const db = await notionFetch(`/databases/${id}`) as NotionDb;
    return { id, db };
  } catch (e) {
    const msg = (e as Error).message;
    const mayBePage = /is a page/i.test(msg) || /\[404\]/.test(msg) || /Could not find database/i.test(msg);
    if (!mayBePage) throw e;
    let children: { results: Array<{ id: string; type: string }> };
    try {
      children = await notionFetch(`/blocks/${id}/children?page_size=100`) as typeof children;
    } catch {
      throw new Error(
        `Notion can't see this database or page. Open it in Notion → "..." menu → Connections → add "Lovable", then retry.`,
      );
    }
    const childDb = children.results.find((b) => b.type === "child_database");
    if (!childDb) {
      throw new Error(
        "That Notion link points to a page with no database inside. Create a database on that page (or share an existing database with the integration) and paste its link.",
      );
    }
    const db = await notionFetch(`/databases/${childDb.id}`) as NotionDb;
    return { id: childDb.id, db };
  }
}

function propFinder(db: NotionDb) {
  const map = Object.entries(db.properties).reduce<Record<string, NotionProp>>(
    (acc, [name, p]) => {
      acc[name.toLowerCase()] = { ...p, name };
      return acc;
    },
    {},
  );
  const title = Object.values(db.properties).find((p) => p.type === "title");
  if (!title) throw new Error("Target Notion database has no title property.");
  const find = (name: string, type: string) => {
    const p = map[name.toLowerCase()];
    return p && p.type === type ? p.name : null;
  };
  return { title, find };
}

async function createPage(databaseId: string, properties: Record<string, unknown>) {
  await notionFetch(`/pages`, {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
  });
}

const InputSchema = z.object({
  databaseId: z.string().min(1).max(500),
  period: z.enum(["day", "week", "month", "year"]),
});

function rangeFor(period: "day" | "week" | "month" | "year") {
  const now = new Date();
  const from = new Date(now);
  if (period === "day") from.setHours(0, 0, 0, 0);
  else if (period === "week") {
    const day = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to: now };
}

export const exportSessionsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);

    const { data: sessions, error } = await supabase
      .from("driving_sessions")
      .select("id, start_at, end_at, km_start, km_end, bus_reference")
      .eq("user_id", userId)
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString())
      .order("start_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!sessions || sessions.length === 0) {
      return { exported: 0, skipped: 0, total: 0 };
    }

    const { id: dbId, db } = await resolveDatabase(data.databaseId);
    const { title, find } = propFinder(db);

    const busProp = find("Bus", "rich_text") ?? find("Bus reference", "rich_text");
    const startProp = find("Start", "date") ?? find("Start at", "date");
    const stopProp = find("Stop", "date") ?? find("End", "date") ?? find("End at", "date");
    const durationProp = find("Duration (min)", "number") ?? find("Duration", "number");
    const distanceProp = find("Distance (km)", "number") ?? find("Distance", "number");
    const kmStartProp = find("km start", "number") ?? find("KM start", "number");
    const kmEndProp = find("km end", "number") ?? find("KM end", "number");

    let exported = 0, skipped = 0;
    const errors: string[] = [];

    for (const s of sessions) {
      if (!s.end_at) { skipped++; continue; }
      const start = new Date(s.start_at);
      const end = new Date(s.end_at);
      const durMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const distance = s.km_start != null && s.km_end != null
        ? Math.max(0, s.km_end - s.km_start) : null;
      const titleText = `${start.toISOString().slice(0, 10)} · ${s.bus_reference ?? "bus"}`;

      const properties: Record<string, unknown> = {
        [title.name]: { title: [{ text: { content: titleText } }] },
      };
      if (busProp) properties[busProp] = { rich_text: [{ text: { content: s.bus_reference ?? "" } }] };
      if (startProp) properties[startProp] = { date: { start: start.toISOString() } };
      if (stopProp) properties[stopProp] = { date: { start: end.toISOString() } };
      if (durationProp) properties[durationProp] = { number: durMin };
      if (distanceProp && distance != null) properties[distanceProp] = { number: distance };
      if (kmStartProp && s.km_start != null) properties[kmStartProp] = { number: s.km_start };
      if (kmEndProp && s.km_end != null) properties[kmEndProp] = { number: s.km_end };

      try { await createPage(dbId, properties); exported++; }
      catch (e) { errors.push((e as Error).message); }
    }

    return { exported, skipped, total: sessions.length, errors: errors.slice(0, 3) };
  });

export const exportShiftsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);

    const { data: shifts, error } = await supabase
      .from("shifts")
      .select("id, on_duty_at, off_duty_at")
      .eq("user_id", userId)
      .gte("on_duty_at", from.toISOString())
      .lte("on_duty_at", to.toISOString())
      .order("on_duty_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!shifts || shifts.length === 0) return { exported: 0, skipped: 0, total: 0 };

    const { id: dbId, db } = await resolveDatabase(data.databaseId);
    const { title, find } = propFinder(db);

    const onProp = find("On duty", "date") ?? find("Start", "date");
    const offProp = find("Off duty", "date") ?? find("Stop", "date") ?? find("End", "date");
    const durationProp = find("Duration (min)", "number") ?? find("Duration", "number");

    let exported = 0, skipped = 0;
    const errors: string[] = [];

    for (const s of shifts) {
      if (!s.off_duty_at) { skipped++; continue; }
      const start = new Date(s.on_duty_at);
      const end = new Date(s.off_duty_at);
      const durMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const titleText = `${start.toISOString().slice(0, 10)} · on-duty`;

      const properties: Record<string, unknown> = {
        [title.name]: { title: [{ text: { content: titleText } }] },
      };
      if (onProp) properties[onProp] = { date: { start: start.toISOString() } };
      if (offProp) properties[offProp] = { date: { start: end.toISOString() } };
      if (durationProp) properties[durationProp] = { number: durMin };

      try { await createPage(dbId, properties); exported++; }
      catch (e) { errors.push((e as Error).message); }
    }

    return { exported, skipped, total: shifts.length, errors: errors.slice(0, 3) };
  });

export const exportDailyTotalsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);

    const [shiftsRes, sessionsRes] = await Promise.all([
      supabase.from("shifts")
        .select("id, on_duty_at, off_duty_at")
        .eq("user_id", userId)
        .gte("on_duty_at", from.toISOString())
        .lte("on_duty_at", to.toISOString()),
      supabase.from("driving_sessions")
        .select("id, start_at, end_at")
        .eq("user_id", userId)
        .gte("start_at", from.toISOString())
        .lte("start_at", to.toISOString()),
    ]);
    if (shiftsRes.error) throw new Error(shiftsRes.error.message);
    if (sessionsRes.error) throw new Error(sessionsRes.error.message);

    const totals = computeDailyTotals(shiftsRes.data ?? [], sessionsRes.data ?? []);
    if (totals.length === 0) return { exported: 0, skipped: 0, total: 0 };

    const { id: dbId, db } = await resolveDatabase(data.databaseId);
    const { title, find } = propFinder(db);

    const dateProp = find("Date", "date");
    const onProp = find("On duty (min)", "number") ?? find("On duty", "number");
    const drivingProp = find("Driving (min)", "number") ?? find("Driving", "number");
    const pctProp = find("Driving %", "number") ?? find("Percent", "number");

    let exported = 0;
    const errors: string[] = [];

    for (const t of totals) {
      const properties: Record<string, unknown> = {
        [title.name]: { title: [{ text: { content: t.date } }] },
      };
      if (dateProp) properties[dateProp] = { date: { start: t.date } };
      if (onProp) properties[onProp] = { number: Math.round(t.onDutyMs / 60000) };
      if (drivingProp) properties[drivingProp] = { number: Math.round(t.drivingMs / 60000) };
      if (pctProp) properties[pctProp] = { number: Math.round(t.percent * 10) / 10 };

      try { await createPage(dbId, properties); exported++; }
      catch (e) { errors.push((e as Error).message); }
    }

    return { exported, skipped: 0, total: totals.length, errors: errors.slice(0, 3) };
  });

type ShiftLite = { on_duty_at: string; off_duty_at: string | null };
type SessionLite = { start_at: string; end_at: string | null };

export function computeDailyTotals(shifts: ShiftLite[], sessions: SessionLite[]) {
  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const acc = new Map<string, { onDutyMs: number; drivingMs: number; anyOpen: boolean }>();
  const ensure = (k: string) => {
    let v = acc.get(k);
    if (!v) { v = { onDutyMs: 0, drivingMs: 0, anyOpen: false }; acc.set(k, v); }
    return v;
  };
  for (const s of shifts) {
    const k = dayKey(s.on_duty_at);
    const v = ensure(k);
    if (!s.off_duty_at) { v.anyOpen = true; continue; }
    v.onDutyMs += new Date(s.off_duty_at).getTime() - new Date(s.on_duty_at).getTime();
  }
  for (const s of sessions) {
    const k = dayKey(s.start_at);
    const v = ensure(k);
    if (!s.end_at) { v.anyOpen = true; continue; }
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
