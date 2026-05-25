import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Shift, Session } from "@/lib/stats";
import type { FuelFillup } from "@/lib/fuel";

export function useTrackingData(userId: string | null) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [fillups, setFillups] = useState<FuelFillup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const sinceYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const [{ data: sh }, { data: ds }, { data: ff }] = await Promise.all([
        supabase.from("shifts").select("*").gte("on_duty_at", sinceYear).order("on_duty_at", { ascending: false }),
        supabase.from("driving_sessions").select("*").gte("start_at", sinceYear).order("start_at", { ascending: false }),
        supabase.from("fuel_fillups").select("*").order("filled_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setShifts((sh ?? []) as Shift[]);
      setSessions((ds ?? []) as Session[]);
      setFillups((ff ?? []) as FuelFillup[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  const activeShift = shifts.find((s) => !s.off_duty_at) ?? null;
  const activeSession = sessions.find((s) => !s.end_at) ?? null;

  return { shifts, sessions, fillups, activeShift, activeSession, loading, refresh };
}
