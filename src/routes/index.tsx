import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTrackingData } from "@/hooks/useTrackingData";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { ActionPanel } from "@/components/ActionPanel";
import { SessionsTable } from "@/components/SessionsTable";
import { ShiftsTable } from "@/components/ShiftsTable";
import { DailyTotalsTable } from "@/components/DailyTotalsTable";
import { KmSummaryTable } from "@/components/KmSummaryTable";
import { PublicHolidaysCard } from "@/components/PublicHolidaysCard";
import { FuelFillupsCard } from "@/components/FuelFillupsCard";
import { DeclaredHoursCard } from "@/components/DeclaredHoursCard";
import { HomeNotionControls } from "@/components/HomeNotionControls";
import { OvertimeBanner } from "@/components/OvertimeBanner";
import { StartingBalancesDialog } from "@/components/StartingBalancesDialog";
import {
  ranges, sumShiftsMs, sumDrivingMs, sumKm, dueHoursMs, DAILY_DUE_MS,
  dateKey,
} from "@/lib/stats";
import { overallConsumption, computeVehicleConsumption } from "@/lib/fuel";
import { computeLeaveBalance } from "@/lib/leave";
import { sumDeclaredMs } from "@/lib/declared";
import { Fuel, LogOut, ClipboardCheck, Train, ArrowLeftRight } from "lucide-react";
import { isWeekend, eachDayOfInterval, startOfDay, parseISO } from "date-fns";
import logoOcelorn from "@/assets/logo-lestonan.png";
import busIcon from "@/assets/bus-icon.png.asset.json";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Océlorn — Tableau de bord" },
      { name: "description", content: "Suivi du temps de service, du temps de conduite et des kilomètres pour les conducteurs Océlorn." },
    ],
  }),
});

function Index() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return <Dashboard userId={user.id} email={user.email ?? ""} />;
}

function Dashboard({ userId, email }: { userId: string; email: string }) {
  const { shifts, sessions, fillups, holidays, declared, balanceSettings, schoolHolidays, activeShift, activeSession, loading, refresh } = useTrackingData(userId);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Union of holidays + paid leave — both exempt days from "due hours".
  const offDaySet = useMemo(
    () => new Set(holidays.map((h) => h.holiday_date)),
    [holidays],
  );

  // CP days only — for leave balance deductions.
  const cpDays = useMemo(
    () => holidays.filter((h) => h.kind === "paid_leave").map((h) => h.holiday_date),
    [holidays],
  );

  const stats = useMemo(() => {
    const r = ranges();
    const now = new Date();
    const isWknd = [0, 6].includes(now.getDay());
    const isTodayOff = offDaySet.has(dateKey(now));
    const dayDue = isWknd || isTodayOff ? 0 : DAILY_DUE_MS;
    return {
      day: {
        worked: sumShiftsMs(shifts, r.day.from, r.day.to, now),
        driving: sumDrivingMs(sessions, r.day.from, r.day.to, now),
        km: sumKm(sessions, r.day.from, r.day.to),
        due: dayDue,
      },
      week: {
        worked: sumShiftsMs(shifts, r.week.from, r.week.to, now),
        driving: sumDrivingMs(sessions, r.week.from, r.week.to, now),
        km: sumKm(sessions, r.week.from, r.week.to),
        due: dueHoursMs(r.week.from, r.week.to, offDaySet),
      },
      month: {
        worked: sumShiftsMs(shifts, r.month.from, r.month.to, now),
        driving: sumDrivingMs(sessions, r.month.from, r.month.to, now),
        km: sumKm(sessions, r.month.from, r.month.to),
        due: dueHoursMs(r.month.from, r.month.to, offDaySet),
      },
      year: {
        worked: sumShiftsMs(shifts, r.year.from, r.year.to, now),
        driving: sumDrivingMs(sessions, r.year.from, r.year.to, now),
        km: sumKm(sessions, r.year.from, r.year.to),
        due: dueHoursMs(r.year.from, r.year.to, offDaySet),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, sessions, offDaySet, tick]);

  // Overtime: starting + Σ declared − Σ due over the same span of declared dates.
  // Span = from starting_balance_date (exclusive) to max(today, last declared date).
  const overtimeMinutes = useMemo(() => {
    const startMins = balanceSettings?.starting_overtime_minutes ?? 0;
    const startDateStr = balanceSettings?.starting_balance_date;
    if (!startDateStr) {
      // No starting balance set: still compute net from declared vs due over declared dates only.
      const decMins = declared.reduce((a, d) => a + d.minutes, 0);
      const dueMins = declared.reduce((a, d) => {
        const day = parseISO(d.work_date);
        if (isWeekend(day) || offDaySet.has(d.work_date)) return a;
        return a + (DAILY_DUE_MS / 60000);
      }, 0);
      return decMins - dueMins;
    }
    const startDate = parseISO(startDateStr);
    const today = startOfDay(new Date());
    // declared total (from any date)
    const declaredMap = new Map(declared.map((d) => [d.work_date, d.minutes]));
    // Walk every day from (start+1) to today.
    const days = eachDayOfInterval({ start: startOfDay(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1)), end: today });
    let declaredMins = 0;
    let dueMins = 0;
    for (const d of days) {
      const k = dateKey(d);
      const dec = declaredMap.get(k);
      if (dec != null) declaredMins += dec;
      if (!isWeekend(d) && !offDaySet.has(k)) {
        // Only count due on past days OR today if user has declared
        if (d < today || dec != null) dueMins += DAILY_DUE_MS / 60000;
      }
    }
    return startMins + declaredMins - dueMins;
  }, [balanceSettings, declared, offDaySet]);

  const leaveBalance = useMemo(() => {
    const start = balanceSettings
      ? { date: balanceSettings.starting_balance_date, nMinus1: balanceSettings.starting_cp_n_minus_1, n: balanceSettings.starting_cp_n }
      : { date: dateKey(new Date()), nMinus1: 0, n: 0 };
    return computeLeaveBalance(start, cpDays, startOfDay(new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanceSettings, cpDays, tick]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <img src={logoOcelorn} alt="Lestonan" className="h-9 w-auto shrink-0 rounded-md bg-white p-1 sm:h-10" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight sm:text-lg">Tableau de bord</h1>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3" title="SAE — Suivi de tournée">
              <Link to="/sae"><img src={busIcon.url} alt="" className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">SAE</span></Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3" title="Prochains départs">
              <Link to="/departures"><Train className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Prochains départs</span></Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3" title="Correspondances">
              <Link to="/correspondances"><ArrowLeftRight className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Correspondances</span></Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3" title="Prises de service">
              <Link to="/duties"><ClipboardCheck className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Prises de service</span></Link>
            </Button>

            <Button variant="ghost" size="sm" className="px-2 sm:px-3" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>


      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <HomeNotionControls userId={userId} schoolHolidays={schoolHolidays} onHolidaysChanged={refresh} />

        <OvertimeBanner overtimeMinutes={overtimeMinutes} leave={leaveBalance} />
        <div className="flex justify-end">
          <StartingBalancesDialog userId={userId} current={balanceSettings} onSaved={refresh} />
        </div>

        <ActionPanel
          userId={userId}
          activeShift={activeShift}
          activeSession={activeSession}
          onChange={refresh}
        />

        <FuelBanner fillups={fillups} />

        <DeclaredHoursCard userId={userId} declared={declared} schoolHolidays={schoolHolidays} onChanged={refresh} />

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Statistics
          </h2>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading statistics…</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Today" workedMs={stats.day.worked} dueMs={stats.day.due}
                drivingMs={stats.day.driving} km={stats.day.km} />
              <StatCard label="This week" workedMs={stats.week.worked} dueMs={stats.week.due}
                drivingMs={stats.week.driving} km={stats.week.km} />
              <StatCard label="This month" workedMs={stats.month.worked} dueMs={stats.month.due}
                drivingMs={stats.month.driving} km={stats.month.km} />
              <StatCard label="This year" workedMs={stats.year.worked} dueMs={stats.year.due}
                drivingMs={stats.year.driving} km={stats.year.km} />
            </div>
          )}
        </section>

        <PublicHolidaysCard userId={userId} holidays={holidays} onChanged={refresh} />
        <FuelFillupsCard fillups={fillups} onChanged={refresh} />
        <DailyTotalsTable shifts={shifts} sessions={sessions} />
        <ShiftsTable shifts={shifts} sessions={sessions} onChanged={refresh} />
        <SessionsTable shifts={shifts} sessions={sessions} onChanged={refresh} />
        <KmSummaryTable sessions={sessions} />

        <p className="text-center text-xs text-muted-foreground">
          Contracted hours: 7h30 per weekday · 37h30 per week
        </p>
      </main>
    </div>
  );
}

function FuelBanner({ fillups }: { fillups: Parameters<typeof overallConsumption>[0] }) {
  const overall = overallConsumption(fillups);
  const perVehicle = computeVehicleConsumption(fillups).filter((v) => v.litersPer100km != null);
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Fuel className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Average fuel consumption
          </span>
        </div>
        <div className="font-mono text-2xl font-semibold">
          {overall.litersPer100km != null ? `${overall.litersPer100km.toFixed(2)} L/100km` : "—"}
        </div>
      </div>
      {perVehicle.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {perVehicle.map((v) => (
            <span
              key={v.bus_reference}
              className="rounded-full bg-secondary px-2.5 py-1 text-xs"
            >
              <span className="font-medium">{v.bus_reference}</span>
              <span className="ml-1.5 font-mono text-muted-foreground">
                {v.litersPer100km!.toFixed(2)} L/100km
              </span>
            </span>
          ))}
        </div>
      )}
      {overall.litersPer100km == null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Record at least two fill-ups for the same vehicle to see consumption.
        </p>
      )}
    </section>
  );
}
