import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronLeft, Pencil, Train } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/departures")({
  component: DeparturesPage,
  head: () => ({ meta: [{ title: "Prochains départs — Lestonan" }] }),
});

type TimetableStop = { stop: string; time: string };

type Departure = {
  id: string;
  notion_page_id: string | null;
  slot_index: number;
  start_time: string;
  route: string;
  driver: string;
  vehicle: string;
  qub: string;
  location: string;
  arrival_time: string | null;
  weekdays: number[];
  timetable: TimetableStop[] | null;
  route_icon: string | null;
};

const WEEKDAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: "L" },
  { value: 2, label: "M" },
  { value: 3, label: "M" },
  { value: 4, label: "J" },
  { value: 5, label: "V" },
  { value: 6, label: "S" },
  { value: 7, label: "D" },
];


function todayWeekday() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
function routeLabel(route: string) {
  return route.split(".")[0] ?? route;
}

function RouteIcon({ icon }: { icon: string | null }) {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) {
    return <img src={icon} alt="" className="inline-block h-5 w-5 rounded-sm object-contain align-middle" />;
  }
  return <span className="inline-block align-middle text-base leading-none">{icon}</span>;
}

function RouteProgressBar({ timetable, now }: { timetable: TimetableStop[] | null; now: number }) {
  if (!timetable || timetable.length < 2) {
    return (
      <div className="px-4 py-3 text-[11px] text-muted-foreground">
        Horaire détaillé indisponible.
      </div>
    );
  }
  const stops = timetable
    .map((s) => ({ ...s, mins: timeMinutes(s.time) }))
    .sort((a, b) => a.mins - b.mins);
  const first = stops[0].mins;
  const last = stops[stops.length - 1].mins;
  let pct = 0;
  if (now <= first) pct = 0;
  else if (now >= last) pct = 100;
  else {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i].mins;
      const b = stops[i + 1].mins;
      if (now >= a && now <= b) {
        const frac = b === a ? 0 : (now - a) / (b - a);
        pct = ((i + frac) / (stops.length - 1)) * 100;
        break;
      }
    }
  }
  const nextIdx = stops.findIndex((s) => s.mins > now);
  return (
    <>
      {/* Desktop: horizontal bar with rotated labels */}
      <div className="hidden sm:block px-4 pt-4 pb-20">
        <div className="relative mx-3 h-2 rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
          {stops.map((s, i) => {
            const left = (i / (stops.length - 1)) * 100;
            const passed = now >= s.mins;
            const isNext = i === nextIdx;
            return (
              <div
                key={i}
                className="absolute top-1/2"
                style={{ left: `${left}%`, transform: "translate(-50%, -50%)" }}
              >
                <div
                  className={cn(
                    "h-3 w-3 rounded-full border-2 border-background",
                    passed ? "bg-primary" : "bg-muted-foreground/40",
                    isNext && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                />
                <div className="absolute left-1/2 top-4 text-[10px] leading-tight text-muted-foreground whitespace-nowrap" style={{ transform: "translateX(-50%) rotate(-45deg)", transformOrigin: "top center" }}>
                  <div className="font-mono tabular-nums">{s.time}</div>
                  <div>{s.stop}</div>
                </div>
              </div>
            );
          })}
          <div
            className="absolute -top-4 text-base"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
            aria-label="Position théorique"
          >
            🚌
          </div>
        </div>
      </div>

      {/* Mobile: vertical timeline */}
      <div className="sm:hidden px-4 py-3">
        <ol className="relative ml-2 border-l-2 border-muted">
          {stops.map((s, i) => {
            const passed = now >= s.mins;
            const isNext = i === nextIdx;
            return (
              <li key={i} className="relative pl-4 py-1">
                <span
                  className={cn(
                    "absolute -left-[7px] top-2 h-3 w-3 rounded-full border-2 border-background",
                    passed ? "bg-primary" : "bg-muted-foreground/40",
                    isNext && "ring-2 ring-primary",
                  )}
                />
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={cn("truncate", passed && !isNext && "text-muted-foreground line-through")}>
                    {isNext && "🚌 "}{s.stop}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground shrink-0">{s.time}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
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

  const [checkedPages, setCheckedPages] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: depData }, { data: dutyData }] = await Promise.all([
        supabase
          .from("departures")
          .select("id,notion_page_id,slot_index,start_time,route,driver,vehicle,qub,location,arrival_time,weekdays,timetable,route_icon")
          .order("start_time", { ascending: true }),
        supabase
          .from("duties")
          .select("notion_page_id,last_checked_date")
          .eq("last_checked_date", today),
      ]);
      if (!cancelled) {
        setRows((depData ?? []) as Departure[]);
        setCheckedPages(new Set((dutyData ?? []).map((d) => d.notion_page_id as string)));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [today]);


  const wd = todayWeekday();
  const now = nowMinutes();

  const running = useMemo(() => {
    return rows
      .filter((r) => r.weekdays.includes(wd) && r.arrival_time)
      .map((r) => ({ ...r, mins: timeMinutes(r.start_time), aMins: timeMinutes(r.arrival_time as string) }))
      .filter((r) => now >= r.mins && now <= r.aMins)
      .sort((a, b) => a.mins - b.mins);
  }, [rows, wd, now]);

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
          <div className="flex items-center gap-3">
            <Button variant={showAll ? "default" : "outline"} size="sm" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Prochains départs" : "Tous les services"}
            </Button>
            <div className="font-mono text-sm tabular-nums text-muted-foreground">
              {String(Math.floor(now / 60)).padStart(2, "0")}:{String(now % 60).padStart(2, "0")}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <p className="text-xs text-muted-foreground">
          {showAll
            ? "Tous les services. Modifiez les jours de circulation puis enregistrez."
            : "Départs prévus dans les 60 prochaines minutes. Mise à jour automatique."}
        </p>

        {loading ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : showAll ? (
          <AllRoutesTable rows={rows} setRows={setRows} />
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">En circulation</h2>
              {running.length === 0 ? (
                <div className="rounded-md border bg-card p-6 text-center text-xs text-muted-foreground">
                  Aucune course en circulation.
                </div>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2">
                    {running.map((r) => {
                      const isLigne = /^ligne/i.test(r.route?.trim() ?? "");
                      const isP = /^p/i.test(r.route?.trim() ?? "");
                      return (
                        <div key={r.id} className="rounded-md border bg-primary/5 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className={cn("flex items-center gap-1.5 font-medium", isLigne && "text-orange-500", isP && "text-yellow-500")}>
                              <RouteIcon icon={r.route_icon} />
                              <span>{routeLabel(r.route)}</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-foreground">{r.location || "—"}</span>
                            </div>
                            <div className="font-mono text-xs tabular-nums text-muted-foreground shrink-0">
                              {hm(r.start_time)} → {hm(r.arrival_time as string)}
                            </div>
                          </div>
                          <div className="px-3 pb-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>{r.driver}</span>
                            <span className="font-mono">{r.vehicle}</span>
                            {r.qub && <span>QUB {r.qub}</span>}
                          </div>
                          <div className="border-t border-border/50">
                            <RouteProgressBar timetable={r.timetable} now={now} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-hidden rounded-md border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Départ</th>
                          <th className="px-3 py-2 text-left">Course</th>
                          <th className="px-3 py-2 text-left">Lieu</th>
                          <th className="px-3 py-2 text-left">Conducteur</th>
                          <th className="px-3 py-2 text-left">Véhicule</th>
                          <th className="px-3 py-2 text-left">QUB</th>
                          <th className="px-3 py-2 text-left">Arrivée</th>
                        </tr>
                      </thead>
                      <tbody>
                        {running.map((r) => {
                          const isLigne = /^ligne/i.test(r.route?.trim() ?? "");
                          const isP = /^p/i.test(r.route?.trim() ?? "");
                          return (
                            <Fragment key={r.id}>
                              <tr className="border-t bg-primary/5">
                                <td className="px-3 py-2 font-mono tabular-nums">{hm(r.start_time)}</td>
                                <td className={cn("px-3 py-2", isLigne && "text-orange-500 font-medium", isP && "text-yellow-500 font-medium")}>
                                  <span className="inline-flex items-center gap-1.5">
                                    <RouteIcon icon={r.route_icon} />
                                    {routeLabel(r.route)}
                                  </span>
                                </td>
                                <td className="px-3 py-2">{r.location || "—"}</td>
                                <td className="px-3 py-2">{r.driver}</td>
                                <td className="px-3 py-2 font-mono text-xs">{r.vehicle}</td>
                                <td className="px-3 py-2">{r.qub}</td>
                                <td className="px-3 py-2 font-mono tabular-nums">{hm(r.arrival_time as string)}</td>
                              </tr>
                              <tr className="bg-primary/5">
                                <td colSpan={7} className="p-0">
                                  <RouteProgressBar timetable={r.timetable} now={now} />
                                </td>
                              </tr>
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

            </section>

            <h2 className="text-sm font-semibold pt-2">Prochains départs</h2>
            {upcoming.length === 0 ? (
              <div className="rounded-md border bg-card p-10 text-center text-sm text-muted-foreground">
                Aucun départ prévu dans l'heure qui vient.
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="sm:hidden space-y-2">
                  {upcoming.map((r) => {
                    const eta = r.mins - now;
                    const imminent = eta <= 10;
                    const isLigne = /^ligne/i.test(r.route?.trim() ?? "");
                    const isP = /^p/i.test(r.route?.trim() ?? "");
                    const checked = r.notion_page_id && checkedPages.has(r.notion_page_id);
                    return (
                      <div
                        key={r.id}
                        className={cn(
                          "rounded-md border bg-card p-3",
                          imminent && "bg-destructive/10 border-destructive/40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-lg font-semibold tabular-nums">{hm(r.start_time)}</span>
                              <span className={cn("font-mono text-xs tabular-nums", imminent ? "text-destructive font-semibold" : "text-muted-foreground")}>
                                {eta <= 0 ? "maintenant" : `dans ${eta} min`}
                              </span>
                              {isP && <span className="text-base leading-none">🚸</span>}
                              {checked && <span className="text-sm">✅</span>}
                            </div>
                            <div className={cn("mt-1 flex items-center gap-1.5 text-sm font-medium", isLigne && "text-orange-500", isP && "text-yellow-500")}>
                              <RouteIcon icon={r.route_icon} />
                              <span>{routeLabel(r.route)}</span>
                              <span className="text-muted-foreground font-normal">· {r.location || "—"}</span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>{r.driver}</span>
                              <span className="font-mono">{r.vehicle}</span>
                              {r.qub && <span>QUB {r.qub}</span>}
                            </div>
                          </div>
                          <WeekdaysEditor
                            departure={r}
                            onSaved={(weekdays) =>
                              setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, weekdays } : x)))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-hidden rounded-md border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Départ</th>
                        <th className="px-3 py-2 text-left">Dans</th>
                        <th className="px-3 py-2 text-left">Course</th>
                        <th className="px-3 py-2 text-left">Lieu</th>
                        <th className="px-3 py-2 text-left">Conducteur</th>
                        <th className="px-3 py-2 text-left">Véhicule</th>
                        <th className="px-3 py-2 text-left">QUB</th>
                        <th className="px-3 py-2 text-left">Jours</th>
                        <th className="px-3 py-2 text-center">Vérifié</th>
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
                            <td className={cn("px-3 py-2", isLigne && "text-orange-500 font-medium", isP && "text-yellow-500 font-medium")}>
                              <span className="inline-flex items-center gap-1.5">
                                <RouteIcon icon={r.route_icon} />
                                {routeLabel(r.route)}
                              </span>
                            </td>
                            <td className="px-3 py-2">{r.location || "—"}</td>
                            <td className="px-3 py-2">{r.driver}</td>
                            <td className="px-3 py-2 font-mono text-xs">{r.vehicle}</td>
                            <td className="px-3 py-2">{r.qub}</td>
                            <td className="px-3 py-2">
                              <WeekdaysEditor
                                departure={r}
                                onSaved={(weekdays) =>
                                  setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, weekdays } : x)))
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.notion_page_id && checkedPages.has(r.notion_page_id) ? "✅" : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

          </>
        )}
        <span className="hidden">{tick}</span>
      </main>
    </div>
  );
}

function WeekdaysEditor({
  departure,
  onSaved,
}: {
  departure: Departure;
  onSaved: (weekdays: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(departure.weekdays);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(departure.weekdays);
  }, [open, departure.weekdays]);

  const summary = WEEKDAY_LABELS
    .filter((d) => departure.weekdays.includes(d.value))
    .map((d) => d.label)
    .join("");

  async function save() {
    if (!departure.notion_page_id) {
      toast.error("Impossible de sauvegarder (page Notion inconnue).");
      return;
    }
    const weekdays = [...draft].sort((a, b) => a - b);
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) {
      setSaving(false);
      toast.error("Session expirée.");
      return;
    }
    const { error: ovErr } = await supabase
      .from("departure_overrides")
      .upsert(
        {
          user_id: userId,
          notion_page_id: departure.notion_page_id,
          slot_index: departure.slot_index,
          weekdays,
        },
        { onConflict: "user_id,notion_page_id,slot_index" },
      );
    if (ovErr) {
      setSaving(false);
      toast.error(ovErr.message);
      return;
    }
    const { error: dErr } = await supabase
      .from("departures")
      .update({ weekdays })
      .eq("id", departure.id);
    setSaving(false);
    if (dErr) {
      toast.error(dErr.message);
      return;
    }
    onSaved(weekdays);
    setOpen(false);
    toast.success("Jours mis à jour");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 font-mono text-xs">
          <span className="tabular-nums">{summary || "—"}</span>
          <Pencil className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Jours de circulation</div>
        <ToggleGroup
          type="multiple"
          value={draft.map(String)}
          onValueChange={(vals) => setDraft(vals.map(Number))}
          className="justify-start"
        >
          {WEEKDAY_LABELS.map((d) => (
            <ToggleGroupItem key={d.value} value={String(d.value)} className="h-8 w-8 text-xs">
              {d.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "…" : "Enregistrer"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AllRoutesTable({
  rows,
  setRows,
}: {
  rows: Departure[];
  setRows: React.Dispatch<React.SetStateAction<Departure[]>>;
}) {
  const [query, setQuery] = useState("");
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.route.toLowerCase().includes(q) || r.driver?.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.route.localeCompare(b.route) || a.start_time.localeCompare(b.start_time));
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher une course ou un conducteur…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full min-w-[640px] text-sm">

          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Départ</th>
              <th className="px-3 py-2 text-left">Course</th>
              <th className="px-3 py-2 text-left">Lieu</th>
              <th className="px-3 py-2 text-left">Conducteur</th>
              <th className="px-3 py-2 text-left">Véhicule</th>
              <th className="px-3 py-2 text-left">Jours</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isLigne = /^ligne/i.test(r.route?.trim() ?? "");
              const isP = /^p/i.test(r.route?.trim() ?? "");
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-mono tabular-nums">{hm(r.start_time)}</td>
                  <td className={cn("px-3 py-2", isLigne && "text-orange-500 font-medium", isP && "text-yellow-500 font-medium")}>
                    <span className="inline-flex items-center gap-1.5">
                      <RouteIcon icon={r.route_icon} />
                      {routeLabel(r.route)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.location || "—"}</td>
                  <td className="px-3 py-2">{r.driver}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.vehicle}</td>
                  <td className="px-3 py-2">
                    <WeekdaysEditor
                      departure={r}
                      onSaved={(weekdays) =>
                        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, weekdays } : x)))
                      }
                    />
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Aucun service.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


