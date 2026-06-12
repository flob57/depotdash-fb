import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ChevronLeft, RefreshCw, Settings2, CalendarDays } from "lucide-react";
import { getCorrespondences, type Interchange } from "@/lib/correspondences.functions";

export const Route = createFileRoute("/correspondances")({
  component: Page,
  head: () => ({ meta: [{ title: "Correspondances — Lestonan" }] }),
});

type Departure = {
  route: string;
  start_time: string;
  arrival_time: string | null;
  driver: string | null;
  vehicle: string | null;
  qub: string | null;
  location: string;
  weekdays: number[];
  timetable: { stop: string; time: string }[] | null;
};


function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function timeMinutes(t: string) {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}
function todayWeekday() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function Page() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Chargement…</div>
      </div>
    );
  }
  return <View userId={user.id} />;
}

function View({ userId }: { userId: string }) {
  const [interchanges, setInterchanges] = useState<Interchange[]>([]);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const fetchCorrespondences = useServerFn(getCorrespondences);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const loadData = async (refreshNotion = false) => {
    const [{ data: settings }, { data: dps }] = await Promise.all([
      supabase
        .from("user_notion_settings")
        .select("correspondences_page_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("departures")
        .select("route,start_time,arrival_time,driver,vehicle,qub,location,weekdays,timetable"),
    ]);
    setDepartures((dps ?? []) as Departure[]);
    const pid = (settings?.correspondences_page_id as string | null) ?? "";
    setPageId(pid);
    if (pid && (refreshNotion || interchanges.length === 0)) {
      setSyncing(true);
      try {
        const res = await fetchCorrespondences({ data: { pageId: pid } });
        setInterchanges(res.interchanges);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Échec du chargement Notion");
      } finally {
        setSyncing(false);
      }
    }
    setLoading(false);
  };

  useEffect(() => { loadData(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const wd = todayWeekday();
  const now = nowMinutes();

  // Lookup driver/vehicle/QUB per course from departures (richer than duties,
  // which only stores the first course of each driver).
  const infoByCourse = useMemo(() => {
    const m = new Map<string, { driver: string; vehicle: string; qub: string }>();
    for (const dep of departures) {
      if (!dep.weekdays.includes(wd)) continue;
      if (!dep.route) continue;
      const prev = m.get(dep.route);
      const candidate = {
        driver: dep.driver ?? "",
        vehicle: dep.vehicle ?? "",
        qub: dep.qub ?? "",
      };
      // Prefer the row that actually has driver/vehicle info filled in.
      if (!prev || (!prev.driver && candidate.driver)) m.set(dep.route, candidate);
    }
    return m;
  }, [departures, wd]);


  const positionByCourse = useMemo(() => {
    const m = new Map<string, { current: string | null; next: string | null }>();
    for (const dep of departures) {
      if (!dep.weekdays.includes(wd)) continue;
      if (!dep.route || !dep.timetable || dep.timetable.length === 0) continue;
      const startMin = timeMinutes(dep.start_time);
      const endMin = dep.arrival_time ? timeMinutes(dep.arrival_time) : startMin + 60;
      if (now < startMin || now > endMin) continue;
      const sorted = [...dep.timetable].sort((a, b) => timeMinutes(a.time) - timeMinutes(b.time));
      let current: string | null = null;
      let next: string | null = null;
      for (let i = 0; i < sorted.length; i++) {
        const tm = timeMinutes(sorted[i].time);
        if (tm <= now) current = sorted[i].stop;
        if (tm > now && !next) next = sorted[i].stop;
      }
      m.set(dep.route, { current, next });
    }
    return m;
  }, [departures, wd, now]);

  const saveSettings = async (newPid: string) => {
    const { error } = await supabase
      .from("user_notion_settings")
      .upsert({ user_id: userId, correspondences_page_id: newPid || null }, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return false; }
    setPageId(newPid);
    return true;
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="px-2">
              <Link to="/"><ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline ml-1">Retour</span></Link>
            </Button>
            <h1 className="truncate text-sm sm:text-base font-semibold">Correspondances</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!pageId || syncing} onClick={() => loadData(true)}>
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline ml-1">Actualiser</span>
            </Button>
            <SettingsDialog initial={pageId} onSave={async (v) => { const ok = await saveSettings(v); if (ok) await loadData(true); return ok; }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        {loading || syncing ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : !pageId ? (
          <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
            Configurez l'ID de la page Notion « Correspondances » via le bouton ⚙️ en haut à droite.
          </div>
        ) : interchanges.length === 0 ? (
          <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
            Aucun lieu d'interchange trouvé dans la page Notion.
          </div>
        ) : (
          interchanges.map((ic) => (
            <section key={ic.database_id} className="rounded-md border bg-card">
              <header className="border-b px-3 py-2 sm:px-4">
                <h2 className="font-semibold">{ic.name}</h2>
                <p className="text-xs text-muted-foreground">{ic.rows.length} ligne{ic.rows.length > 1 ? "s" : ""}</p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left">Service</th>
                      <th className="px-2 py-2 text-left">Course</th>
                      <th className="px-2 py-2 text-left">Horaire</th>
                      <th className="px-2 py-2 text-left">Conducteur</th>
                      <th className="px-2 py-2 text-left">Véhicule</th>
                      <th className="px-2 py-2 text-left">QUB</th>
                      <th className="px-2 py-2 text-left">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ic.rows.map((r, i) => {
                      const info = r.course ? infoByCourse.get(r.course) : undefined;
                      const pos = r.course ? positionByCourse.get(r.course) : undefined;
                      return (
                        <tr key={`${r.course}-${i}`} className="border-t">
                          <td className="px-2 py-2 font-medium">{r.label}</td>
                          <td className="px-2 py-2">{r.course || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
                            {r.depart_time ?? "—"}
                            {r.arrival_time && <span className="text-muted-foreground"> → {r.arrival_time}</span>}
                          </td>
                          <td className="px-2 py-2">{info?.driver || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-2 font-mono text-xs">{info?.vehicle || <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-2">{info?.qub || <span className="text-muted-foreground">—</span>}</td>

                          <td className="px-2 py-2 text-xs">
                            {pos ? (
                              <span>
                                <span className="font-medium">{pos.current ?? "—"}</span>
                                {pos.next && <span className="text-muted-foreground"> → {pos.next}</span>}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
        <span className="hidden">{tick}</span>
      </main>
    </div>
  );
}

function SettingsDialog({
  initial, onSave,
}: { initial: string; onSave: (v: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setVal(initial), [initial]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="px-2"><Settings2 className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Page Notion « Correspondances »</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>URL ou ID de la page</Label>
          <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://notion.so/…" />
          <p className="text-xs text-muted-foreground">
            Chaque base enfant de cette page est traitée comme un lieu d'interchange.
          </p>
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onSave(val.trim());
              setBusy(false);
              if (ok) { toast.success("Enregistré."); setOpen(false); }
            }}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
