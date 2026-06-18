import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ChevronLeft, Check, Undo2, MapPin } from "lucide-react";
import {
  getRouteDetails, recordStopPassage, listStopPassages,
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

function fmtHmFromIso(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function RoutePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { routeId } = Route.useParams();
  const fetchDetails = useServerFn(getRouteDetails);
  const recordFn = useServerFn(recordStopPassage);
  const listFn = useServerFn(listStopPassages);

  const [details, setDetails] = useState<RouteDetails | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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

  // 1-minute tick for delay display
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

  // Current expected deviation: if there's a scheduled time for current stop,
  // show now() - scheduled
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
        },
      });
      const diff = r.passage.diff_minutes;
      const status = r.passage.status;
      toast.success(
        diff == null
          ? `Arrêt ${currentStop.name} enregistré`
          : `${currentStop.name}: ${status} (${diff > 0 ? "+" : ""}${diff} min)`,
      );
      if (r.notionError) toast.warning(`Notion: ${r.notionError}`);
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
    <div className="min-h-screen bg-background pb-32">
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
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-4">
        {allDone ? (
          <div className="rounded-lg border-2 border-green-500/40 bg-green-500/5 p-6 text-center">
            <Check className="mx-auto mb-2 h-10 w-10 text-green-600" />
            <p className="text-lg font-semibold">Tournée terminée</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tous les arrêts ont été validés.
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
                  <div className="text-xl font-semibold leading-tight">{currentStop.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Théorique :{" "}
                    <span className="font-mono">{currentStop.scheduledTime ?? "—"}</span>
                  </div>
                </div>
              </div>
              {deviation != null && (
                <div className="mt-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    background:
                      deviation <= -1 ? "rgb(59 130 246 / 0.12)" :
                      deviation >= 1 ? "rgb(239 68 68 / 0.12)" :
                      "rgb(34 197 94 / 0.12)",
                    color:
                      deviation <= -1 ? "rgb(37 99 235)" :
                      deviation >= 1 ? "rgb(220 38 38)" :
                      "rgb(22 163 74)",
                  }}>
                  {deviation === 0
                    ? "à l'heure"
                    : deviation > 0
                    ? `+${deviation} min — en retard`
                    : `${deviation} min — en avance`}
                </div>
              )}
            </section>

            {nextStop && (
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
            )}
          </>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Itinéraire ({details.stops.length})
          </h2>
          <ol className="space-y-1.5">
            {details.stops.map((s) => {
              const p = validated.get(s.index);
              const isCurrent = currentStop?.index === s.index;
              return (
                <li
                  key={s.index}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                    p ? "bg-muted/40" : isCurrent ? "border-primary bg-primary/5" : "bg-card"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(s.index).padStart(2, "0")}
                    </span>
                    <span className={`truncate ${p ? "line-through opacity-70" : ""}`}>
                      {s.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
                    <span className="text-muted-foreground">{s.scheduledTime ?? "—"}</span>
                    {p && (
                      <span className="text-foreground">→ {fmtHmFromIso(p.actual_time)}</span>
                    )}
                    {p?.diff_minutes != null && (
                      <span
                        className={
                          p.diff_minutes <= -1
                            ? "text-blue-600"
                            : p.diff_minutes >= 1
                            ? "text-red-600"
                            : "text-green-600"
                        }
                      >
                        ({p.diff_minutes > 0 ? "+" : ""}{p.diff_minutes})
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
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
                  // simple undo: delete the last passage row
                  try {
                    const { deleteStopPassage } = await import("@/lib/sae.functions");
                    await useServerFn(deleteStopPassage)({ data: { id: last.id } });
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
              Je suis à cet arrêt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
