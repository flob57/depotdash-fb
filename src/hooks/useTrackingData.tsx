import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Shift, Session } from "@/lib/stats";
import type { FuelFillup } from "@/lib/fuel";
import type { DeclaredHour } from "@/lib/declared";
import type { SchoolHoliday } from "@/lib/school-context";

export type PublicHoliday = {
  id: string;
  holiday_date: string;
  label: string | null;
  kind: "holiday" | "paid_leave";
};

export type BalanceSettings = {
  starting_overtime_minutes: number;
  starting_cp_n_minus_1: number;
  starting_cp_n: number;
  starting_balance_date: string;
};

export function useTrackingData(userId: string | null) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [fillups, setFillups] = useState<FuelFillup[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [declared, setDeclared] = useState<DeclaredHour[]>([]);
  const [balanceSettings, setBalanceSettings] = useState<BalanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const sinceYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const [{ data: sh }, { data: ds }, { data: ff }, { data: ph }, { data: dh }, { data: bs }] = await Promise.all([
        supabase.from("shifts").select("*").gte("on_duty_at", sinceYear).order("on_duty_at", { ascending: false }),
        supabase.from("driving_sessions").select("*").gte("start_at", sinceYear).order("start_at", { ascending: false }),
        supabase.from("fuel_fillups").select("*").order("filled_at", { ascending: false }),
        supabase.from("public_holidays").select("*").order("holiday_date", { ascending: false }),
        supabase.from("declared_hours").select("*").order("work_date", { ascending: false }),
        supabase.from("user_balance_settings").select("*").eq("user_id", userId).maybeSingle(),
      ]);
      if (cancelled) return;
      setShifts((sh ?? []) as Shift[]);
      setSessions((ds ?? []) as Session[]);
      setFillups((ff ?? []) as FuelFillup[]);
      setHolidays((ph ?? []) as PublicHoliday[]);
      setDeclared((dh ?? []) as DeclaredHour[]);
      setBalanceSettings(bs ? {
        starting_overtime_minutes: bs.starting_overtime_minutes,
        starting_cp_n_minus_1: Number(bs.starting_cp_n_minus_1),
        starting_cp_n: Number(bs.starting_cp_n),
        starting_balance_date: bs.starting_balance_date,
      } : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  const activeShift = shifts.find((s) => !s.off_duty_at) ?? null;
  const activeSession = sessions.find((s) => !s.end_at) ?? null;

  return { shifts, sessions, fillups, holidays, declared, balanceSettings, activeShift, activeSession, loading, refresh };
}
