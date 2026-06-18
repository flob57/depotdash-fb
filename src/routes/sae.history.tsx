import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronLeft, CalendarIcon, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { listStopPassages, listPassageDates, syncPassagesToNotion } from "@/lib/sae.functions";
import busIcon from "@/assets/bus-icon.png.asset.json";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/sae/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "SAE — Mes horaires réels" }] }),
});

type Passage = Awaited<ReturnType<typeof listStopPassages>>[number];

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parisHm(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function computeDiff(scheduled: string | null, actualIso: string): number | null {
  if (!scheduled) return null;
  const [h, m] = scheduled.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const [ah, am] = parisHm(actualIso).split(":").map((n) => parseInt(n, 10));
  let d = ah * 60 + am - (h * 60 + m);
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

function HistoryPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const listPassagesFn = useServerFn(listStopPassages);
  const listDatesFn = useServerFn(listPassageDates);
  const syncFn = useServerFn(syncPassagesToNotion);
  const [syncing, setSyncing] = useState(false);


  const [date, setDate] = useState<Date>(new Date());
  const [available, setAvailable] = useState<{ work_date: string; routes: { id: string; name: string }[] }[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [rows, setRows] = useState<Passage[]>([]);

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    listDatesFn().then(setAvailable).catch(() => setAvailable([]));
  }, [user, listDatesFn]);

  const dateKey = toIso(date);
  const routesForDay = useMemo(
    () => available.find((d) => d.work_date === dateKey)?.routes ?? [],
    [available, dateKey],
  );

  useEffect(() => {
    if (!user) return;
    setRows([]);
    listPassagesFn({ data: { workDate: dateKey, routeId: selectedRoute } }).then(setRows);
  }, [user, dateKey, selectedRoute, listPassagesFn]);

  useEffect(() => {
    // auto-select first route of the day
    setSelectedRoute(routesForDay[0]?.id ?? null);
  }, [routesForDay]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const recordedDates = new Set(available.map((a) => a.work_date));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-3 sm:px-4">
          <Button asChild variant="ghost" size="sm" className="px-2">
            <Link to="/sae"><ChevronLeft className="h-4 w-4" /></Link>
          </Button>
          <img src={busIcon.url} alt="" className="h-7 w-7" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">Mes horaires réels</h1>
            <p className="truncate text-[11px] text-muted-foreground">Historique des passages</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("justify-start gap-2 font-normal")}>
                <CalendarIcon className="h-4 w-4" />
                {format(date, "EEEE d MMMM yyyy", { locale: fr })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                locale={fr}
                modifiers={{ recorded: (d) => recordedDates.has(toIso(d)) }}
                modifiersClassNames={{ recorded: "font-bold text-primary underline" }}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          {routesForDay.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {routesForDay.map((r) => (
                <Button
                  key={r.id}
                  size="sm"
                  variant={selectedRoute === r.id ? "default" : "outline"}
                  onClick={() => setSelectedRoute(r.id)}
                >
                  {r.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
            Aucun passage enregistré pour ce jour.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                Total montées :{" "}
                <span className="font-semibold text-foreground">
                  {rows.reduce((acc, r) => acc + ((r as any).pax_on ?? 0), 0)}
                </span>{" "}
                · descentes :{" "}
                <span className="font-semibold text-foreground">
                  {rows.reduce((acc, r) => acc + ((r as any).pax_off ?? 0), 0)}
                </span>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  setSyncing(true);
                  try {
                    const res = await syncFn({ data: { workDate: dateKey, routeId: selectedRoute } });
                    if (res.errors.length) {
                      toast.error(`Synchronisé ${res.synced}/${res.total} — ${res.errors[0]}`);
                    } else {
                      toast.success(`Notion : ${res.synced} passage(s) synchronisé(s)`);
                    }
                    const fresh = await listPassagesFn({ data: { workDate: dateKey, routeId: selectedRoute } });
                    setRows(fresh);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Échec de la synchronisation");
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
              >
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Envoyer vers Notion
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Arrêt</th>
                    <th className="px-3 py-2 text-right">Théorique</th>
                    <th className="px-3 py-2 text-right">Réel</th>
                    <th className="px-3 py-2 text-right">Écart</th>
                    <th className="px-3 py-2 text-right">Montées</th>
                    <th className="px-3 py-2 text-right">Descentes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const diff = computeDiff(r.scheduled_time, r.actual_time);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.stop_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.route_name} · arrêt {r.stop_index}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{r.scheduled_time ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{parisHm(r.actual_time)}</td>
                        <td className="px-3 py-2 text-right">
                          {diff == null ? (
                            "—"
                          ) : (
                            <span
                              className={cn(
                                "font-mono",
                                diff <= -1 && "text-blue-600",
                                diff >= 1 && "text-red-600",
                                diff > -1 && diff < 1 && "text-green-600",
                              )}
                            >
                              {diff > 0 ? "+" : ""}{diff} min
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{(r as any).pax_on ?? 0}</td>
                        <td className="px-3 py-2 text-right font-mono">{(r as any).pax_off ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

      </main>
    </div>
  );
}
