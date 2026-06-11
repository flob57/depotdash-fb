import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Train } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/departures")({
  component: DeparturesPage,
  head: () => ({ meta: [{ title: "Prochains départs — Lestonan" }] }),
});

type Departure = {
  id: string;
  start_time: string;
  route: string;
  driver: string;
  vehicle: string;
  qub: string;
  weekdays: number[];
};

function todayWeekday() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function timeMinutes(t: string) {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}
function hm(t: string) {
  return t.slice(0, 5);
}

function DeparturesPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }
  return <DeparturesView />;
}

function DeparturesView() {
  const [rows, setRows] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("departures")
        .select("id,start_time,route,driver,vehicle,qub,weekdays")
        .order("start_time", { ascending: true });
      if (!cancelled) {
        setRows((data ?? []) as Departure[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const wd = todayWeekday();
  const now = nowMinutes();

  const upcoming = useMemo(() => {
    return rows
      .filter((r) => r.weekdays.includes(wd))
      .map((r) => ({ ...r, mins: timeMinutes(r.start_time) }))
      .filter((r) => r.mins >= now && r.mins <= now + 60)
      .sort((a, b) => a.mins - b.mins);
  }, [rows, wd, now]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/"><ChevronLeft className="h-4 w-4" /> Retour</Link>
            </Button>
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Train className="h-4 w-4" /> Prochains départs
            </h1>
          </div>
          <div className="font-mono text-sm tabular-nums text-muted-foreground">
            {String(Math.floor(now / 60)).padStart(2, "0")}:{String(now % 60).padStart(2, "0")}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <p className="text-xs text-muted-foreground">
          Départs prévus dans les 60 prochaines minutes. Mise à jour automatique.
        </p>

        {loading ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : upcoming.length === 0 ? (
          <div className="rounded-md border bg-card p-10 text-center text-sm text-muted-foreground">
            Aucun départ prévu dans l'heure qui vient.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Départ</th>
                  <th className="px-3 py-2 text-left">Dans</th>
                  <th className="px-3 py-2 text-left">Course</th>
                  <th className="px-3 py-2 text-left">Conducteur</th>
                  <th className="px-3 py-2 text-left">Véhicule</th>
                  <th className="px-3 py-2 text-left">QUB</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => {
                  const eta = r.mins - now;
                  const imminent = eta <= 10;
                  const isLigne = /^ligne/i.test(r.route?.trim() ?? "");
                  const isP = /^p/i.test(r.route?.trim() ?? "");
                  return (
                    <tr
                      key={r.id}
                      className={cn("border-t", imminent && "bg-destructive/10 font-medium")}
                    >
                      <td className="px-3 py-2 font-mono text-base font-semibold tabular-nums">
                        <div className="flex items-center gap-2">
                          <span>{hm(r.start_time)}</span>
                          {isP && <span className="text-base leading-none">🚸</span>}
                        </div>
                      </td>
                      <td className={cn("px-3 py-2 font-mono tabular-nums", imminent && "text-destructive")}>
                        {eta <= 0 ? "maintenant" : `${eta} min`}
                      </td>
                      <td className={cn("px-3 py-2", isLigne && "text-orange-500 font-medium", isP && "text-yellow-500 font-medium")}>{r.route}</td>
                      <td className="px-3 py-2">{r.driver}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.vehicle}</td>
                      <td className="px-3 py-2">{r.qub}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <span className="hidden">{tick}</span>
      </main>
    </div>
  );
}
