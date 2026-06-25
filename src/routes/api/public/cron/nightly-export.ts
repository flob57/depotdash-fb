import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  exportSessionsRange,
  exportShiftsRange,
  exportDailyTotalsRange,
  exportDistanceSummary,
  exportFuelFillupsRange,
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
  fuel_fillups_db_id: string | null;
  timezone: string;
};

async function runForUser(s: Settings, force = false) {
  const tz = s.timezone || "Europe/Brussels";
  const now = new Date();
  // Only run at the user's local 23:xx hour (the cron pings hourly).
  if (!force && localHour(tz, now) !== 23) return { ok: false, skipped: true };
  const day = localDayInfo(tz, now);
  const summary: Record<string, unknown> = {};


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
    if (s.fuel_fillups_db_id) {
      summary.fuel = await exportFuelFillupsRange(
        supabaseAdmin,
        s.user_id,
        s.fuel_fillups_db_id,
        day.from,
        day.to,
      );
    }
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
  }
  return summary;
}

export const Route = createFileRoute("/api/public/cron/nightly-export")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Authenticate the scheduler with a server-only shared secret. The
        // previous publishable-key check was insufficient: that key is bundled
        // into the public client JS and could be replayed by anyone.
        const expected = process.env.CRON_SECRET ?? "";
        const provided =
          request.headers.get("x-cron-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const { timingSafeEqual } = await import("crypto");
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        const ok =
          expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
        if (!ok) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        const { data, error } = await supabaseAdmin
          .from("user_notion_settings")
          .select(
            "user_id, shifts_db_id, sessions_db_id, daily_totals_db_id, distance_summary_db_id, fuel_fillups_db_id, timezone",
          );
        if (error) {
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const settings = (data ?? []) as Settings[];
        let processed = 0;
        let skipped = 0;
        let errored = 0;
        for (const s of settings) {
          if (
            !s.shifts_db_id &&
            !s.sessions_db_id &&
            !s.daily_totals_db_id &&
            !s.distance_summary_db_id &&
            !s.fuel_fillups_db_id
          )
            continue;
          try {
            const r = await runForUser(s, force);
            if ((r as { skipped?: boolean }).skipped) skipped++;
            else if ((r as { error?: string }).error) {
              // Log server-side only; never leak per-user details to the caller.
              console.error("[nightly-export] user run failed", (r as { error: string }).error);
              errored++;
            } else processed++;
          } catch (e) {
            console.error("[nightly-export] unexpected error", e);
            errored++;
          }
        }
        // Aggregated response only — no user IDs, no per-user payloads.
        return new Response(
          JSON.stringify({
            ok: true,
            ran_at: new Date().toISOString(),
            processed,
            skipped,
            errored,
          }),
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
