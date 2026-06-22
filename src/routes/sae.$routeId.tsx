import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  ChevronLeft, Check, Undo2, MapPin, Plus, Minus, Users, Satellite, SatelliteDish, Settings2, AlertTriangle,
} from "lucide-react";
import {
  getRouteDetails, recordStopPassage, listStopPassages, deleteStopPassage,
} from "@/lib/sae.functions";
import {
  matchStop, pickClosestPoint, haversineMeters, type StopMatch,
} from "@/lib/stops-matcher";
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

// ---- GPS settings (localStorage) ----
const LS_KEY = "sae.gps.settings.v1";
type GpsSettings = {
  enabled: boolean;
  autoValidate: boolean;
  nearMeters: number;
  farMeters: number;
};
const DEFAULT_GPS: GpsSettings = {
  enabled: true,
  autoValidate: true,
  nearMeters: 200,
  farMeters: 300,
};

function loadGps(): GpsSettings {
  if (typeof window === "undefined") return DEFAULT_GPS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_GPS;
    return { ...DEFAULT_GPS, ...(JSON.parse(raw) as Partial<GpsSettings>) };
  } catch {
    return DEFAULT_GPS;
  }
}
function saveGps(s: GpsSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

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

  // GPS state
  const [gps, setGps] = useState<GpsSettings>(() => loadGps());
  const [pos, setPos] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const nearStopsRef = useRef<Set<number>>(new Set());

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

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Watch geolocation
  useEffect(() => {
    if (!gps.enabled) { setPos(null); setGpsError(null); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Géolocalisation non supportée");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
        setGpsError(null);
      },
      (err) => {
        setGpsError(err.message || "Erreur GPS");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [gps.enabled]);

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

  // Match each stop name to a GTFS entry (memoized per route)
  const matches = useMemo(() => {
    const m = new Map<number, StopMatch>();
    if (!details) return m;
    for (const s of details.stops) m.set(s.index, matchStop(s.name));
    return m;
  }, [details]);

  // Current stop resolved coordinates (pick closest direction if multiple)
  const currentStopCoord = useMemo(() => {
    if (!currentStop) return null;
    const m = matches.get(currentStop.index);
    if (!m) return null;
    if (pos) return pickClosestPoint(m.matched, pos.lat, pos.lon);
    const p = m.matched.points[0];
    return p ? { point: p, distance: Infinity } : null;
  }, [matches, currentStop, pos]);

  const distanceToCurrent = useMemo(() => {
    if (!pos || !currentStopCoord) return null;
    return haversineMeters(pos.lat, pos.lon, currentStopCoord.point.lat, currentStopCoord.point.lon);
  }, [pos, currentStopCoord]);

  const isNear = distanceToCurrent != null && distanceToCurrent <= gps.nearMeters;

  const handleValidate = useCallback(async (auto = false) => {
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
      const prefix = auto ? "📍 " : "";
      toast.success(
        diff == null
          ? `${prefix}${currentStop.name} ✓`
          : `${prefix}${currentStop.name}: ${status} (${diff > 0 ? "+" : ""}${diff} min)`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, currentStop, paxOn, paxOff, workDate]);

  // Auto-validate: once we've been near the stop and we're now past it, validate.
  useEffect(() => {
    if (!gps.enabled || !gps.autoValidate) return;
    if (!currentStop || distanceToCurrent == null || submitting) return;
    const idx = currentStop.index;
    if (distanceToCurrent <= gps.nearMeters) {
      nearStopsRef.current.add(idx);
    } else if (
      nearStopsRef.current.has(idx) &&
      distanceToCurrent > gps.farMeters
    ) {
      nearStopsRef.current.delete(idx);
      void handleValidate(true);
    }
  }, [distanceToCurrent, currentStop, gps, submitting, handleValidate]);

  const deviationSeconds = useMemo(() => {
    if (!currentStop?.scheduledTime) return null;
    const [h, m] = currentStop.scheduledTime.split(":").map(Number);
    const sched = new Date();
    sched.setHours(h, m, 0, 0);
    return Math.round((Date.now() - sched.getTime()) / 1000);
  }, [currentStop, tick]);

  if (loading || !user || busy || !details) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const allDone = currentStop == null;
  const currentMatch: StopMatch = currentStop ? matches.get(currentStop.index) ?? null : null;

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
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {details.serviceName && <span className="truncate">{details.serviceName}</span>}
                {details.codeGirouette && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                    Girouette: {details.codeGirouette}
                  </span>
                )}
                {details.vehicleService && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    Service: {details.vehicleService}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <GpsBadge enabled={gps.enabled} pos={pos} error={gpsError} />
            <GpsSettingsButton gps={gps} setGps={(s) => { setGps(s); saveGps(s); }} />
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              <Users className="h-4 w-4" />
              {paxOnBoard}
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
              {passages.length} arrêts enregistrés · {paxOnBoard} à bord
            </p>
          </div>
        ) : (
          <>
            <section
              className={`rounded-xl border-2 bg-card p-4 shadow-sm transition-colors ${
                isNear ? "border-green-500/70 bg-green-500/5" : "border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={`text-[11px] font-semibold uppercase tracking-wide ${isNear ? "text-green-700" : "text-primary"}`}>
                  {isNear ? "Vous êtes à l'arrêt" : "Arrêt actuel"}
                </div>
                {gps.enabled && (
                  <GpsStopBadge match={currentMatch} distance={distanceToCurrent} />
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <MapPin className={`h-5 w-5 shrink-0 ${isNear ? "text-green-600" : "text-primary"}`} />
                <div className="min-w-0">
                  <div className="text-2xl font-semibold leading-tight">{currentStop.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Théorique :{" "}
                    <span className="font-mono">{currentStop.scheduledTime ?? "—"}</span>
                  </div>
                </div>
              </div>
              {deviationSeconds != null && (
                <DeviationCounter seconds={deviationSeconds} />
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <PaxCounter label="Montées" value={paxOn} onChange={setPaxOn} tone="up" />
                <PaxCounter label="Descentes" value={paxOff} onChange={setPaxOff} tone="down" />
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
              onClick={() => handleValidate(false)}
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

function GpsBadge({
  enabled, pos, error,
}: { enabled: boolean; pos: { acc: number } | null; error: string | null }) {
  if (!enabled) return (
    <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
      GPS off
    </span>
  );
  if (error) return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-red-600" title={error}>
      <AlertTriangle className="h-3 w-3" /> GPS
    </span>
  );
  if (!pos) return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-amber-700">
      <SatelliteDish className="h-3 w-3 animate-pulse" /> …
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-semibold uppercase text-green-700" title={`±${Math.round(pos.acc)} m`}>
      <Satellite className="h-3 w-3" /> {Math.round(pos.acc)}m
    </span>
  );
}

function GpsStopBadge({
  match, distance,
}: { match: StopMatch; distance: number | null }) {
  if (!match) return (
    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700" title="Aucune coordonnée trouvée — validation manuelle">
      Non géolocalisé
    </span>
  );
  if (distance == null) return null;
  const color =
    distance <= 200 ? "bg-green-500/15 text-green-700"
    : distance <= 500 ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground";
  const conf = match.confidence === "low" ? " ?" : "";
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${color}`}>
      {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}{conf}
    </span>
  );
}

function GpsSettingsButton({
  gps, setGps,
}: { gps: GpsSettings; setGps: (s: GpsSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(gps);
  useEffect(() => { if (open) setDraft(gps); }, [open, gps]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="px-2" title="Réglages GPS">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Détection GPS</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="gps-enabled">Activer la géolocalisation</Label>
            <Switch
              id="gps-enabled"
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="gps-auto">Validation auto au passage</Label>
            <Switch
              id="gps-auto"
              checked={draft.autoValidate}
              onCheckedChange={(v) => setDraft({ ...draft, autoValidate: v })}
              disabled={!draft.enabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="near">Proche (m)</Label>
              <Input
                id="near"
                type="number"
                min={20}
                max={1000}
                value={draft.nearMeters}
                onChange={(e) => setDraft({ ...draft, nearMeters: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="far">Dépassé (m)</Label>
              <Input
                id="far"
                type="number"
                min={20}
                max={2000}
                value={draft.farMeters}
                onChange={(e) => setDraft({ ...draft, farMeters: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            L'arrêt actuel est mis en surbrillance à moins de <b>{draft.nearMeters} m</b>.
            Une fois passé au-delà de <b>{draft.farMeters} m</b>, il est validé automatiquement.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={() => { setGps(draft); setOpen(false); }}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function DeviationCounter({ seconds }: { seconds: number }) {
  const minutes = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.abs(seconds) % 60;
  const isEarly = seconds < 0;

  const { bgColor, textColor, label } = isEarly
    ? {
        bgColor: "oklch(0.6 0.22 25 / 8%)",
        textColor: "oklch(0.55 0.2 25)",
        label: "en avance",
      }
    : seconds <= 300
    ? {
        bgColor: "oklch(0.72 0.18 140 / 8%)",
        textColor: "oklch(0.55 0.16 140)",
        label: "à l'heure",
      }
    : {
        bgColor: "oklch(0.78 0.16 80 / 8%)",
        textColor: "oklch(0.65 0.14 80)",
        label: "en retard",
      };

  const display = isEarly
    ? `-${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `+${minutes}`;

  return (
    <div className="mt-3 flex items-center gap-2">
      <span
        className="rounded-md px-2.5 py-1 font-mono text-lg font-bold"
        style={{ background: bgColor, color: textColor }}
      >
        {display}
      </span>
      <span
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: textColor }}
      >
        {label}
      </span>
    </div>
  );
}
