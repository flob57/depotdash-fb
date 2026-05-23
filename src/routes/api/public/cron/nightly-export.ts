import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  exportSessionsRange,
  exportShiftsRange,
  exportDailyTotalsRange,
  exportDistanceSummary,
  localDayInfo,
  localHour,
  weekRangeLocal,
  monthRangeLocal,
  yearRangeLocal,
} from "@/lib/notion-export.server";

type Settings = {
  user_id: string;
  shifts_db_id: string | null;
  sessions_db_id: string | null;
  daily_totals_db_id: string | null;
  distance_summary_db_id: string | null;
  timezone: string;
};

async function runForUser(s: Settings) {
  const tz = s.timezone || "Europe/Brussels";
  const now = new Date();
  // Only run at the user's local 23:xx hour (the cron pings hourly).
  if (localHour(tz, now) !== 23) return { user_id: s.user_id, skipped: "not 23:xx local" };
  const day = localDayInfo(tz, now);
  const summary: Record<string, unknown> = { user_id: s.user_id, timezone: tz };

  try {
    if (s.shifts_db_id) {
      summary.shifts = await exportShiftsRange(
        supabaseAdmin,
        s.user_id,
        s.shifts_db_id,
        day.from,
        day.to,
      );
    }
    if (s.sessions_db_id) {
      summary.sessions = await exportSessionsRange(
        supabaseAdmin,
        s.user_id,
        s.sessions_db_id,
        day.from,
        day.to,
      );
    }
    if (s.daily_totals_db_id) {
      summary.daily_totals = await exportDailyTotalsRange(
        supabaseAdmin,
        s.user_id,
        s.daily_totals_db_id,
        day.from,
        day.to,
      );
    }
    if (s.distance_summary_db_id) {
      // Sunday → This week
      if (day.dayOfWeek === 0) {
        const r = weekRangeLocal(tz, now);
        summary.week = await exportDistanceSummary(
          supabaseAdmin,
          s.user_id,
          s.distance_summary_db_id,
          "This week",
          r.from,
          r.to,
        );
      }
      // Last day of month → This month
      if (day.isLastDayOfMonth) {
        const r = monthRangeLocal(tz, now);
        summary.month = await exportDistanceSummary(
          supabaseAdmin,
          s.user_id,
          s.distance_summary_db_id,
          "This month",
          r.from,
          r.to,
        );
      }
      // Last day of year → This year
      if (day.isLastDayOfYear) {
        const r = yearRangeLocal(tz, now);
        summary.year = await exportDistanceSummary(
          supabaseAdmin,
          s.user_id,
          s.distance_summary_db_id,
          "This year",
          r.from,
          r.to,
        );
      }
    }
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
  }
  return summary;
}

export const Route = createFileRoute("/api/public/cron/nightly-export")({
  server: {
    handlers: {
      POST: async () => {
        const { data, error } = await supabaseAdmin
          .from("user_notion_settings")
          .select(
            "user_id, shifts_db_id, sessions_db_id, daily_totals_db_id, distance_summary_db_id, timezone",
          );
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const settings = (data ?? []) as Settings[];
        const results = [];
        for (const s of settings) {
          if (
            !s.shifts_db_id &&
            !s.sessions_db_id &&
            !s.daily_totals_db_id &&
            !s.distance_summary_db_id
          )
            continue;
          results.push(await runForUser(s));
        }
        return new Response(
          JSON.stringify({ ran_at: new Date().toISOString(), users: results.length, results }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      GET: async () =>
        new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
