import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notionFetch, resolveDatabase } from "@/lib/notion-export.server";

// French + English weekday names (lowercased, no accents) for matching.
const FR_DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const EN_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function localDateParts(tz: string, now: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  // Weekday index 0..6 (Sun..Sat)
  const wkShort = get("weekday").toLowerCase();
  const map: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const wkIdx = map[wkShort.slice(0, 3)] ?? new Date().getDay();
  return { iso, wkIdx };
}

type NotionTask = {
  id: string;
  name: string;
  days: string[]; // normalized day strings stored on the page
  lastCompletedISO: string | null;
  dayPropName: string | null;
  datePropName: string | null;
};

function extractTask(
  page: {
    id: string;
    properties: Record<string, {
      type: string;
      title?: Array<{ plain_text: string }>;
      rich_text?: Array<{ plain_text: string }>;
      select?: { name: string } | null;
      multi_select?: Array<{ name: string }>;
      status?: { name: string } | null;
      date?: { start: string } | null;
    }>;
  },
  dayPropName: string | null,
  datePropName: string | null,
): NotionTask {
  const propsEntries = Object.entries(page.properties);
  const titleEntry = propsEntries.find(([, p]) => p.type === "title");
  const name = (titleEntry?.[1].title ?? []).map((t) => t.plain_text).join("").trim();

  let days: string[] = [];
  if (dayPropName) {
    const p = page.properties[dayPropName];
    if (p) {
      if (p.type === "select" && p.select) days = [p.select.name];
      else if (p.type === "multi_select" && p.multi_select) days = p.multi_select.map((s) => s.name);
      else if (p.type === "status" && p.status) days = [p.status.name];
      else if (p.type === "rich_text" && p.rich_text) days = [p.rich_text.map((t) => t.plain_text).join("")];
    }
  }
  days = days.map(stripAccents).filter(Boolean);

  let lastCompletedISO: string | null = null;
  if (datePropName) {
    const p = page.properties[datePropName];
    if (p && p.type === "date" && p.date?.start) {
      lastCompletedISO = p.date.start.slice(0, 10);
    }
  }

  return { id: page.id, name, days, lastCompletedISO, dayPropName, datePropName };
}

function findDayProp(properties: Record<string, { type: string; name?: string }>): string | null {
  const candidates = ["jour", "jours", "day", "days", "weekday"];
  for (const [name, p] of Object.entries(properties)) {
    const n = stripAccents(name);
    if (
      candidates.some((c) => n === c || n.includes(c)) &&
      ["select", "multi_select", "status", "rich_text"].includes(p.type)
    ) return name;
  }
  // fallback: first select/multi_select prop
  for (const [name, p] of Object.entries(properties)) {
    if (["select", "multi_select", "status"].includes(p.type)) return name;
  }
  return null;
}

function findDateProp(properties: Record<string, { type: string }>): string | null {
  const preferred = ["last completed", "derniere realisation", "derniere completion", "completed", "done", "fait le"];
  for (const [name, p] of Object.entries(properties)) {
    if (p.type !== "date") continue;
    const n = stripAccents(name);
    if (preferred.some((c) => n.includes(c))) return name;
  }
  for (const [name, p] of Object.entries(properties)) {
    if (p.type === "date") return name;
  }
  return null;
}

async function getTimezone(supabase: ReturnType<typeof require>, userId: string): Promise<{ tz: string; dbId: string | null }> {
  const { data } = await supabase
    .from("user_notion_settings")
    .select("timezone, weekly_tasks_db_id")
    .eq("user_id", userId)
    .maybeSingle();
  return { tz: data?.timezone || "Europe/Brussels", dbId: data?.weekly_tasks_db_id ?? null };
}

export const getWeeklyTasksForToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const settings = await getTimezone(supabase as never, userId);
    if (!settings.dbId) {
      return { tasks: [] as Array<{ id: string; name: string }>, configured: false, error: null as string | null };
    }

    let dbId: string;
    let dayProp: string | null;
    let dateProp: string | null;
    try {
      const { id, db } = await resolveDatabase(settings.dbId);
      dbId = id;
      dayProp = findDayProp(db.properties as never);
      dateProp = findDateProp(db.properties as never);
    } catch (e) {
      return {
        tasks: [],
        configured: true,
        error: e instanceof Error ? e.message : "Failed to open the Notion database",
      };
    }

    const { iso: todayISO, wkIdx } = localDateParts(settings.tz, new Date());
    const todayNames = new Set<string>([
      stripAccents(FR_DAYS[wkIdx]),
      stripAccents(EN_DAYS[wkIdx]),
      // also short forms
      stripAccents(FR_DAYS[wkIdx]).slice(0, 3),
      stripAccents(EN_DAYS[wkIdx]).slice(0, 3),
    ]);

    const tasks: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = (await notionFetch(`/databases/${dbId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        results: Array<Parameters<typeof extractTask>[0]>;
        has_more: boolean;
        next_cursor: string | null;
      };
      for (const page of res.results) {
        const t = extractTask(page, dayProp, dateProp);
        if (!t.name) continue;
        // Match if any of the page's day labels starts with today's name (handles "Lun", "Lundi", "Monday").
        const matches = t.days.some((d) =>
          [...todayNames].some((tn) => d === tn || d.startsWith(tn) || tn.startsWith(d)),
        );
        if (!matches) continue;
        if (t.lastCompletedISO === todayISO) continue;
        tasks.push({ id: t.id, name: t.name });
      }
      hasMore = res.has_more;
      cursor = res.next_cursor ?? undefined;
    }
    return { tasks, configured: true, error: null, datePropName: dateProp };
  });

export const completeWeeklyTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pageId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const settings = await getTimezone(supabase as never, userId);
    if (!settings.dbId) throw new Error("Weekly-tasks database not configured.");

    const { db } = await resolveDatabase(settings.dbId);
    const dateProp = findDateProp(db.properties as never);
    if (!dateProp) {
      throw new Error(
        'Add a Date property (e.g. "Last completed") to your weekly-tasks Notion database.',
      );
    }
    const { iso } = localDateParts(settings.tz, new Date());
    await notionFetch(`/pages/${data.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [dateProp]: { date: { start: iso } },
        },
      }),
    });
    return { success: true };
  });
