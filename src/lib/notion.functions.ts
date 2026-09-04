import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  notionFetch,
  resolveDatabase,
  exportSessionsRange,
  exportShiftsRange,
  exportDailyTotalsRange,
  exportDistanceSummary,
  exportFuelFillupsRange,
  weekRangeLocal,
  monthRangeLocal,
  yearRangeLocal,
  localDayInfo,
} from "@/lib/notion-export.server";

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
    return exportSessionsRange(supabase, userId, data.databaseId, from, to);
  });

export const exportShiftsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);
    return exportShiftsRange(supabase, userId, data.databaseId, from, to);
  });

export const exportDailyTotalsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);
    return exportDailyTotalsRange(supabase, userId, data.databaseId, from, to);
  });


// List vehicles (pages) from a Notion database, including the metadata used by the driving-session card.
function notionKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function propertyText(property: any): string | null {
  if (!property) return null;
  if (property.type === "title") return (property.title ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? "").join("").trim() || null;
  if (property.type === "rich_text") return (property.rich_text ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? "").join("").trim() || null;
  if (property.type === "number") return property.number == null ? null : String(property.number);
  if (property.type === "select") return property.select?.name ?? null;
  if (property.type === "status") return property.status?.name ?? null;
  if (property.type === "formula") {
    const f = property.formula;
    if (!f) return null;
    if (f.type === "string") return f.string?.trim() || null;
    if (f.type === "number") return f.number == null ? null : String(f.number);
    if (f.type === "boolean") return f.boolean == null ? null : String(f.boolean);
  }
  return null;
}

function findVehicleProperty(properties: Record<string, any>, aliases: string[]): string | null {
  const wanted = aliases.map(notionKey);
  const entry = Object.entries(properties).find(([key]) => wanted.includes(notionKey(key)));
  return entry ? propertyText(entry[1]) : null;
}

function coverUrl(page: any): string | null {
  const cover = page.cover;
  if (!cover) return null;
  if (cover.type === "external") return cover.external?.url ?? null;
  if (cover.type === "file") return cover.file?.url ?? null;
  return null;
}

export const listVehiclesFromNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ databaseId: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data }) => {
    let dbId: string;
    try {
      const resolved = await resolveDatabase(data.databaseId);
      dbId = resolved.id;
    } catch (e) {
      return {
        vehicles: [],
        error: e instanceof Error ? e.message : "Failed to find the Notion database",
      };
    }

    type Vehicle = {
      id: string;
      name: string;
      registration: string | null;
      parkNumber: string | null;
      qubNumber: string | null;
      coverUrl: string | null;
    };

    const vehicles: Vehicle[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = (await notionFetch(`/databases/${dbId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        results: Array<{
          id: string;
          cover?: any;
          properties: Record<string, any>;
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };

      for (const page of res.results) {
        const titleProp = Object.values(page.properties).find((p: any) => p.type === "title");
        const name = propertyText(titleProp);
        if (!name) continue;

        vehicles.push({
          id: page.id,
          name,
          registration: findVehicleProperty(page.properties, ["Immatriculation", "Immat", "Plaque", "Registration"]),
          parkNumber: findVehicleProperty(page.properties, ["Numéro de parc", "N° de parc", "No de parc", "Parc", "Park number"]),
          qubNumber: findVehicleProperty(page.properties, ["Numéro QUB", "N° QUB", "No QUB", "QUB"]),
          coverUrl: coverUrl(page),
        });
      }

      hasMore = res.has_more;
      cursor = res.next_cursor ?? undefined;
    }

    vehicles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { vehicles };
  });

// ---- Per-user Notion settings (auto-export targets) ----

const SettingsSchema = z.object({
  shifts_db_id: z.string().max(500).nullable().optional(),
  sessions_db_id: z.string().max(500).nullable().optional(),
  daily_totals_db_id: z.string().max(500).nullable().optional(),
  distance_summary_db_id: z.string().max(500).nullable().optional(),
  fuel_fillups_db_id: z.string().max(500).nullable().optional(),
  weekly_tasks_db_id: z.string().max(500).nullable().optional(),
  parking_db_id: z.string().max(500).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
});


export const getNotionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_notion_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        user_id: userId,
        shifts_db_id: null,
        sessions_db_id: null,
        daily_totals_db_id: null,
        distance_summary_db_id: null,
        fuel_fillups_db_id: null,
        weekly_tasks_db_id: null,
        parking_db_id: null,
        timezone: "Europe/Brussels",
      }
    );
  });

export const saveNotionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      shifts_db_id: data.shifts_db_id ?? null,
      sessions_db_id: data.sessions_db_id ?? null,
      daily_totals_db_id: data.daily_totals_db_id ?? null,
      distance_summary_db_id: data.distance_summary_db_id ?? null,
      fuel_fillups_db_id: data.fuel_fillups_db_id ?? null,
      weekly_tasks_db_id: data.weekly_tasks_db_id ?? null,
      parking_db_id: data.parking_db_id ?? null,
      timezone: data.timezone ?? "Europe/Brussels",
    };
    const { error } = await supabase
      .from("user_notion_settings")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { success: true };
  });


// Manually trigger the same logic as the nightly cron, for the current user.
// Useful for testing the configured databases without waiting for 23:59.
export const runAutoExportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_notion_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("No Notion settings saved yet.");

    const tz = data.timezone || "Europe/Brussels";
    const now = new Date();
    const day = localDayInfo(tz, now);
    type R = { exported: number; skipped: number; total: number; errors: string[] };
    const summary: {
      shifts?: R; sessions?: R; daily_totals?: R; fuel?: R;
      week?: R; month?: R; year?: R;
    } = {};

    if (data.shifts_db_id) {
      summary.shifts = await exportShiftsRange(
        supabase, userId, data.shifts_db_id, day.from, day.to,
      );
    }
    if (data.sessions_db_id) {
      summary.sessions = await exportSessionsRange(
        supabase, userId, data.sessions_db_id, day.from, day.to,
      );
    }
    if (data.daily_totals_db_id) {
      summary.daily_totals = await exportDailyTotalsRange(
        supabase, userId, data.daily_totals_db_id, day.from, day.to,
      );
    }
    if (data.distance_summary_db_id) {
      const w = weekRangeLocal(tz, now);
      summary.week = await exportDistanceSummary(
        supabase, userId, data.distance_summary_db_id, "This week", w.from, w.to,
      );
      const m = monthRangeLocal(tz, now);
      summary.month = await exportDistanceSummary(
        supabase, userId, data.distance_summary_db_id, "This month", m.from, m.to,
      );
      const y = yearRangeLocal(tz, now);
      summary.year = await exportDistanceSummary(
        supabase, userId, data.distance_summary_db_id, "This year", y.from, y.to,
      );
    }
    if (data.fuel_fillups_db_id) {
      summary.fuel = await exportFuelFillupsRange(
        supabase, userId, data.fuel_fillups_db_id, day.from, day.to,
      );
    }
    return summary;
  });
