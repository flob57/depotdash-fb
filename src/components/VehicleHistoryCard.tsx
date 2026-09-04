import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, Fuel, Route as RouteIcon } from "lucide-react";
import { format } from "date-fns";
import { formatHm, type Session } from "@/lib/stats";
import type { FuelFillup } from "@/lib/fuel";

type Props = {
  sessions: Session[];
  fillups: FuelFillup[];
};

export function VehicleHistoryCard({ sessions, fillups }: Props) {
  const vehicles = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach((s) => s.bus_reference?.trim() && names.add(s.bus_reference.trim()));
    fillups.forEach((f) => f.bus_reference?.trim() && names.add(f.bus_reference.trim()));
    return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [sessions, fillups]);

  const [vehicle, setVehicle] = useState("");

  const selected = vehicle || vehicles[0] || "";

  const activities = useMemo(() => {
    if (!selected) return [];
    const driveRows = sessions
      .filter((s) => s.bus_reference?.trim() === selected)
      .map((s) => {
        const start = new Date(s.start_at);
        const end = s.end_at ? new Date(s.end_at) : null;
        const duration = (end ?? new Date()).getTime() - start.getTime();
        const distance = s.km_start != null && s.km_end != null
          ? Math.max(0, s.km_end - s.km_start)
          : null;
        return {
          key: `drive-${s.id}`,
          at: start,
          type: "drive" as const,
          title: "Session de conduite",
          detail: end ? `${format(start, "HH:mm")} → ${format(end, "HH:mm")}` : "En cours",
          duration,
          distance,
          kmStart: s.km_start,
          kmEnd: s.km_end,
          liters: null as number | null,
        };
      });

    const fuelRows = fillups
      .filter((f) => f.bus_reference?.trim() === selected)
      .map((f) => ({
        key: `fuel-${f.id}`,
        at: new Date(f.filled_at),
        type: "fuel" as const,
        title: "Plein de carburant",
        detail: format(new Date(f.filled_at), "HH:mm"),
        duration: null as number | null,
        distance: null as number | null,
        kmStart: f.km_at_fillup,
        kmEnd: null as number | null,
        liters: Number(f.liters) || 0,
      }));

    return [...driveRows, ...fuelRows].sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [selected, sessions, fillups]);

  const lastKm = useMemo(() => {
    if (!selected) return null;
    const readings = [
      ...sessions.filter((s) => s.bus_reference?.trim() === selected).flatMap((s) => [
        s.km_end != null ? { at: s.end_at ?? s.start_at, km: s.km_end } : null,
        s.km_start != null ? { at: s.start_at, km: s.km_start } : null,
      ]),
      ...fillups.filter((f) => f.bus_reference?.trim() === selected).map((f) => ({
        at: f.filled_at,
        km: f.km_at_fillup,
      })),
    ].filter(Boolean) as { at: string; km: number }[];
    readings.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return readings[0]?.km ?? null;
  }, [selected, sessions, fillups]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Historique par véhicule
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Retrouvez toutes les activités enregistrées avec le véhicule sélectionné.</p>
        </div>
        <Select value={selected} onValueChange={setVehicle}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Choisir un véhicule" />
          </SelectTrigger>
          <SelectContent>
            {vehicles.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {!selected ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune activité véhicule enregistrée.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border bg-secondary/30 p-3">
                <div className="text-xs text-muted-foreground">Véhicule</div>
                <div className="mt-1 font-mono font-semibold">{selected}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-3">
                <div className="text-xs text-muted-foreground">Dernier km connu</div>
                <div className="mt-1 font-mono font-semibold">{lastKm != null ? `${lastKm} km` : "—"}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-3">
                <div className="text-xs text-muted-foreground">Conduites</div>
                <div className="mt-1 font-mono font-semibold">{sessions.filter((s) => s.bus_reference?.trim() === selected).length}</div>
              </div>
              <div className="rounded-lg border bg-secondary/30 p-3">
                <div className="text-xs text-muted-foreground">Plein(s)</div>
                <div className="mt-1 font-mono font-semibold">{fillups.filter((f) => f.bus_reference?.trim() === selected).length}</div>
              </div>
            </div>

            {activities.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucune activité pour ce véhicule.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {activities.map((a) => (
                  <div key={a.key} className="grid gap-2 px-3 py-3 sm:grid-cols-[120px_1fr_auto] sm:items-center">
                    <div>
                      <div className="font-mono text-sm">{format(a.at, "dd/MM/yyyy")}</div>
                      <div className="text-xs text-muted-foreground">{format(a.at, "HH:mm")}</div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {a.type === "drive" ? <RouteIcon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Fuel className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.detail}</div>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      {a.type === "drive" ? (
                        <>
                          <div className="font-mono text-sm">{formatHm(a.duration ?? 0)}</div>
                          <div className="text-xs text-muted-foreground">
                            {a.distance != null ? `${a.distance} km` : "km incomplets"}
                            {a.kmStart != null ? ` · départ ${a.kmStart}` : ""}
                            {a.kmEnd != null ? ` · arrivée ${a.kmEnd}` : ""}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-mono text-sm">{a.liters.toFixed(2)} L</div>
                          <div className="text-xs text-muted-foreground">compteur {a.kmStart ?? "—"} km</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
