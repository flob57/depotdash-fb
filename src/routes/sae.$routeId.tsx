import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ChevronLeft, Check, Undo2, MapPin, Plus, Minus, Users } from "lucide-react";
import {
  getRouteDetails, recordStopPassage, listStopPassages, deleteStopPassage,
} from "@/lib/sae.functions";
import busIcon from "@/assets/bus-icon.png.asset.json";

export const Route = createFileRoute("/sae/$routeId")({
  component: RoutePage,
  head: () => ({ meta: [{ title: "SAE — Suivi de tournée" }] }),
});

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type RouteDetails = Awaited<ReturnType<typeof getRouteDetails>>;
type Passage = Awaited<ReturnType<typeof listStopPassages>>[number];

function RoutePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { routeId } = Route.useParams();
  const fetchDetails = useServerFn(getRouteDetails);
  const recordFn = useServerFn(recordStopPassage);
  const listFn = useServerFn(listStopPassages);
  const deleteFn = useServerFn(deleteStopPassage);

  const [details, setDetails] = useState<RouteDetails | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [paxOn, setPaxOn] = useState(0);
  const [paxOff, setPaxOff] = useState(0);
  const workDate = todayIso();

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [loading, user, navigate]);

  const load = async () => {
    setBusy(true);
    try {
      const [d, p] = await Promise.all([
        fetchDetails({ data: { routeId } }),
        listFn({ data: { workDate, routeId } }),
      ]);
      setDetails(d);
      setPassages(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, routeId]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const validated = useMemo(() => {
    const map = new Map<number, Passage>();
    for (const p of passages) map.set(p.stop_index, p);
    return map;
  }, [passages]);

  const currentStop = useMemo(() => {
    if (!details) return null;
    return details.stops.find((s) => !validated.has(s.index)) ?? null;
  }, [details, validated]);

  const nextStop = useMemo(() => {
    if (!details || !currentStop) return null;
    return details.stops.find((s) => s.index > currentStop.index) ?? null;
  }, [details, currentStop]);

  const paxOnBoard = useMemo(
    () => passages.reduce((acc, p: any) => acc + (p.pax_on ?? 0) - (p.pax_off ?? 0), 0),
    [passages],
  );

  const deviation = useMemo(() => {
    if (!currentStop?.scheduledTime) return null;
    const [h, m] = currentStop.scheduledTime.split(":").map(Number);
    const sched = new Date();
    sched.setHours(h, m, 0, 0);
    return Math.round((Date.now() - sched.getTime()) / 60000);
  }, [currentStop]);

  const handleValidate = async () => {
    if (!details || !currentStop) return;
    setSubmitting(true);
    try {
      const r = await recordFn({
        data: {
          workDate,
          routeId: details.id,
          routeName: details.lineName,
          stopIndex: currentStop.index,
          stopName: currentStop.name,
          scheduledTime: currentStop.scheduledTime,
          paxOn,
          paxOff,
        },
      });
      const diff = r.passage.diff_minutes;
      const status = r.passage.status;
      toast.success(
        diff == null
          ? `${currentStop.name} ✓`
          : `${currentStop.name}: ${status} (${diff > 0 ? "+" : ""}${diff} min)`,
      );
      if (r.notionError) toast.warning(`Notion: ${r.notionError}`);
      setPaxOn(0);
      setPaxOff(0);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user || busy || !details) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const allDone = currentStop == null;

  return (
    <div className="min-h-screen bg-background pb-40">
      <Toaster />
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="px-2">
              <Link to="/sae"><ChevronLeft className="h-4 w-4" /></Link>
            </Button>
            <img src={busIcon.url} alt="" className="h-7 w-7" />
            <div className="min-w-0">
              <h1 className="truncate font-mono text-lg font-semibold">{details.lineName}</h1>
              {details.serviceName && (
                <p className="truncate text-[11px] text-muted-foreground">{details.serviceName}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
            <Users className="h-4 w-4" />
            {paxOnBoard}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-4">
        {allDone ? (
          <div className="rounded-lg border-2 border-green-500/40 bg-green-500/5 p-6 text-center">
            <Check className="mx-auto mb-2 h-10 w-10 text-green-600" />
            <p className="text-lg font-semibold">Tournée terminée</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {passages.length} arrêts enregistrés · {paxOnBoard} à bord
            </p>
          </div>
        ) : (
          <>
            <section className="rounded-xl border-2 border-primary/50 bg-card p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                Arrêt actuel
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <MapPin className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="text-2xl font-semibold leading-tight">{currentStop.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Théorique :{" "}
                    <span className="font-mono">{currentStop.scheduledTime ?? "—"}</span>
                  </div>
                </div>
              </div>
              {deviation != null && (
                <DeviationCounter minutes={deviation} />
              )}

              {/* Passenger counters */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <PaxCounter
                  label="Montées"
                  value={paxOn}
                  onChange={setPaxOn}
                  tone="up"
                />
                <PaxCounter
                  label="Descentes"
                  value={paxOff}
                  onChange={setPaxOff}
                  tone="down"
                />
              </div>
            </section>

            {nextStop ? (
              <section className="rounded-lg border bg-card p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Prochain arrêt
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <div className="truncate font-medium">{nextStop.name}</div>
                  <div className="shrink-0 font-mono text-sm text-muted-foreground">
                    {nextStop.scheduledTime ?? "—"}
                  </div>
                </div>
              </section>
            ) : (
              <section className="rounded-lg border bg-card p-3 text-center text-sm text-muted-foreground">
                Dernier arrêt de la tournée
              </section>
            )}
          </>
        )}
      </main>

      {!allDone && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 px-3 py-3 backdrop-blur sm:px-4">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            {passages.length > 0 && (
              <Button
                variant="outline"
                size="lg"
                onClick={async () => {
                  const last = passages[passages.length - 1];
                  if (!last) return;
                  try {
                    await deleteFn({ data: { id: last.id } });
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Erreur");
                  }
                  await load();
                }}
                title="Annuler le dernier arrêt"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="lg"
              className="h-14 flex-1 text-base"
              disabled={submitting}
              onClick={handleValidate}
            >
              <Check className="mr-2 h-5 w-5" />
              Valider ({paxOn}↑ / {paxOff}↓)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaxCounter({
  label, value, onChange, tone,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  tone: "up" | "down";
}) {
  const accent = tone === "up" ? "text-green-600" : "text-red-600";
  return (
    <div className="rounded-lg border bg-background p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={`font-mono text-lg font-bold ${accent}`}>{value}</span>
      </div>
      <div className="flex items-stretch gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 flex-1"
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 flex-1"
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
