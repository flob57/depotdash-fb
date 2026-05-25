import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import {
  ranges, sumShiftsMs, sumDrivingMs, sumKm, dueHoursMs, WEEKLY_DUE_MS, DAILY_DUE_MS,
} from "@/lib/stats";
import { overallConsumption, computeVehicleConsumption } from "@/lib/fuel";
import { Fuel, LogOut } from "lucide-react";
import logoOcelorn from "@/assets/logo-ocelorn.jpg";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Océlorn — Suivi d'activité" },
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
  const { shifts, sessions, fillups, activeShift, activeSession, loading, refresh } = useTrackingData(userId);
  const [tick, setTick] = useState(0);

  // Re-render every minute so active counters and "due" stay fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    const r = ranges();
    const now = new Date();
    const dayDue = DAILY_DUE_MS * ([0, 6].includes(now.getDay()) ? 0 : 1);
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
        due: WEEKLY_DUE_MS,
      },
      month: {
        worked: sumShiftsMs(shifts, r.month.from, r.month.to, now),
        driving: sumDrivingMs(sessions, r.month.from, r.month.to, now),
        km: sumKm(sessions, r.month.from, r.month.to),
        due: dueHoursMs(r.month.from, r.month.to),
      },
      year: {
        worked: sumShiftsMs(shifts, r.year.from, r.year.to, now),
        driving: sumDrivingMs(sessions, r.year.from, r.year.to, now),
        km: sumKm(sessions, r.year.from, r.year.to),
        due: dueHoursMs(r.year.from, r.year.to),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts, sessions, tick]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img src={logoOcelorn} alt="Océlorn" className="h-10 w-auto rounded-md bg-black p-1" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">Suivi d'activité</h1>
              <p className="text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <FuelBanner fillups={fillups} />


        <ActionPanel
          userId={userId}
          activeShift={activeShift}
          activeSession={activeSession}
          onChange={refresh}
        />

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

        <ShiftsTable shifts={shifts} sessions={sessions} onChanged={refresh} />
        <SessionsTable shifts={shifts} sessions={sessions} onChanged={refresh} />
        <DailyTotalsTable shifts={shifts} sessions={sessions} />
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
