import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  planningDbId,
  fetchTodayRouteIds,
  fetchRouteDetails,
  pushPassageToNotion,
  createActualTimesDatabase,
  parisWeekday,
  parisHm,
  type SaeRoute,
} from "@/lib/sae.server";


function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Today's routes
export const getTodayRoutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ date: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase
      .from("user_notion_settings")
      .select("planning_db_id")
      .eq("user_id", userId)
      .maybeSingle();
    const dbId = planningDbId(settings?.planning_db_id);
    const iso = data.date ?? todayIso();
    try {
      const ids = await fetchTodayRouteIds(dbId, iso);
      const routes: SaeRoute[] = [];
      for (const id of ids) {
        try {
          routes.push(await fetchRouteDetails(id));
        } catch (e) {
          console.error("fetchRouteDetails failed", id, e);
        }
      }
      routes.sort((a, b) => (a.depTime ?? "").localeCompare(b.depTime ?? ""));
      return { routes, date: iso, error: null as string | null };
    } catch (e) {
      return {
        routes: [],
        date: iso,
        error: e instanceof Error ? e.message : "Notion error",
      };
    }
  });

export const getRouteDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ routeId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    return await fetchRouteDetails(data.routeId);
  });

// Record one stop passage. Saves to Supabase and (if configured) pushes to Notion.
export const recordStopPassage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workDate: z.string(),
        routeId: z.string().min(1),
        routeName: z.string().min(1),
        stopIndex: z.number().int().min(1),
        stopName: z.string().min(1),
        scheduledTime: z.string().nullable().optional(),
        actualIso: z.string().optional(),
        paxOn: z.number().int().min(0).optional(),
        paxOff: z.number().int().min(0).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const actualIso = data.actualIso ?? new Date().toISOString();
    const scheduledTime = data.scheduledTime ?? null;
    const paxOn = data.paxOn ?? 0;
    const paxOff = data.paxOff ?? 0;

    // diff (minutes): actual - scheduled, on the same date.
    let diff: number | null = null;
    let status: string | null = null;
    if (scheduledTime) {
      const [h, m] = scheduledTime.split(":").map((n) => parseInt(n, 10));
      if (Number.isFinite(h) && Number.isFinite(m)) {
        const sched = new Date(actualIso);
        sched.setHours(h, m, 0, 0);
        diff = Math.round((new Date(actualIso).getTime() - sched.getTime()) / 60000);
        if (diff < 0) status = "en avance";
        else if (diff <= 5) status = "à l'heure";
        else status = "en retard";
      }
    }

    const row = {
      user_id: userId,
      work_date: data.workDate,
      route_notion_id: data.routeId,
      route_name: data.routeName,
      stop_index: data.stopIndex,
      stop_name: data.stopName,
      scheduled_time: scheduledTime,
      actual_time: actualIso,
      diff_minutes: diff,
      status,
      pax_on: paxOn,
      pax_off: paxOff,
    };

    const { data: saved, error } = await supabase
      .from("actual_stop_times")
      .upsert(row, { onConflict: "user_id,work_date,route_notion_id,stop_index" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Running pax on board for this route (up to and including this stop).
    const { data: routeRows } = await supabase
      .from("actual_stop_times")
      .select("stop_index, pax_on, pax_off")
      .eq("user_id", userId)
      .eq("work_date", data.workDate)
      .eq("route_notion_id", data.routeId)
      .lte("stop_index", data.stopIndex);
    const paxOnBoard = (routeRows ?? []).reduce(
      (acc, r: any) => acc + (r.pax_on ?? 0) - (r.pax_off ?? 0),
      0,
    );

    // Sync to Notion (best-effort, do not fail the user click).
    const { data: settings } = await supabase
      .from("user_notion_settings")
      .select("actual_times_db_id")
      .eq("user_id", userId)
      .maybeSingle();

    let notionPageId: string | null = null;
    let notionError: string | null = null;
    if (settings?.actual_times_db_id) {
      try {
        notionPageId = await pushPassageToNotion({
          databaseId: settings.actual_times_db_id,
          workDate: data.workDate,
          routeName: data.routeName,
          stopName: data.stopName,
          scheduledTime,
          actualIso,
          diffMinutes: diff,
          status,
          paxOn,
          paxOff,
          paxOnBoard,
        });
        await supabase
          .from("actual_stop_times")
          .update({ notion_page_id: notionPageId, notion_synced_at: new Date().toISOString() })
          .eq("id", saved.id);
      } catch (e) {
        notionError = e instanceof Error ? e.message : "Notion sync failed";
      }
    }

    return { passage: saved, notionPageId, notionError, paxOnBoard };
  });

export const listStopPassages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workDate: z.string(),
        routeId: z.string().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("actual_stop_times")
      .select("*")
      .eq("user_id", userId)
      .eq("work_date", data.workDate)
      .order("stop_index", { ascending: true });
    if (data.routeId) q = q.eq("route_notion_id", data.routeId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listPassageDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("actual_stop_times")
      .select("work_date, route_notion_id, route_name")
      .eq("user_id", userId)
      .order("work_date", { ascending: false });
    if (error) throw new Error(error.message);
    // Dedup
    const map = new Map<string, { work_date: string; routes: Map<string, string> }>();
    for (const r of data ?? []) {
      const entry = map.get(r.work_date) ?? { work_date: r.work_date, routes: new Map() };
      entry.routes.set(r.route_notion_id, r.route_name);
      map.set(r.work_date, entry);
    }
    return [...map.values()].map((e) => ({
      work_date: e.work_date,
      routes: [...e.routes.entries()].map(([id, name]) => ({ id, name })),
    }));
  });

export const deleteStopPassage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("actual_stop_times")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ---- Settings ----

export const getSaeSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_notion_settings")
      .select("planning_db_id, actual_times_db_id, actual_times_parent_page_id")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      planning_db_id: data?.planning_db_id ?? null,
      actual_times_db_id: data?.actual_times_db_id ?? null,
      actual_times_parent_page_id: data?.actual_times_parent_page_id ?? null,
    };
  });

export const saveSaeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        planning_db_id: z.string().max(500).nullable().optional(),
        actual_times_db_id: z.string().max(500).nullable().optional(),
        actual_times_parent_page_id: z.string().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_notion_settings")
      .upsert(
        {
          user_id: userId,
          planning_db_id: data.planning_db_id ?? null,
          actual_times_db_id: data.actual_times_db_id ?? null,
          actual_times_parent_page_id: data.actual_times_parent_page_id ?? null,
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const createSaeNotionDatabase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await supabase
      .from("user_notion_settings")
      .select("actual_times_parent_page_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!settings?.actual_times_parent_page_id) {
      throw new Error(
        "Renseignez d'abord l'ID de la page Notion parente où créer la base 'Mes horaires réel'.",
      );
    }
    const dbId = await createActualTimesDatabase(settings.actual_times_parent_page_id);
    await supabase
      .from("user_notion_settings")
      .upsert(
        { user_id: userId, actual_times_db_id: dbId },
        { onConflict: "user_id" },
      );
    return { databaseId: dbId };
  });
