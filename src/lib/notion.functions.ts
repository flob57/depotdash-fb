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


// List vehicles (pages) from a Notion database. Returns each page's title.
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
    const vehicles: { id: string; name: string }[] = [];
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
          properties: Record<string, { type: string; title?: Array<{ plain_text: string }> }>;
        }>;
        has_more: boolean;
        next_cursor: string | null;
      };
      for (const page of res.results) {
        const titleProp = Object.values(page.properties).find((p) => p.type === "title");
        const name = (titleProp?.title ?? [])
          .map((t) => t.plain_text)
          .join("")
          .trim();
        if (name) vehicles.push({ id: page.id, name });
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
