import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import {
  getParkingSpots,
  listParkingVehicles,
  assignVehicleToSpot,
  freeSpot,
  type ParkingSpot,
  type VehicleOption,
} from "@/lib/parking.functions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/parking")({
  component: ParkingPage,
  head: () => ({
    meta: [
      { title: "Océlorn — Parking" },
      { name: "description", content: "Vue synoptique des emplacements de stationnement." },
    ],
  }),
});

const DEPOTS = ["Lestonan", "Gourvily", "Exterieur"] as const;
type Depot = (typeof DEPOTS)[number];

const DEPOT_LABELS: Record<Depot, string> = {
  Lestonan: "Lestonan",
  Gourvily: "Gourvily",
  Exterieur: "Extérieur",
};

function normalizeDepot(raw: string): Depot | null {
  const n = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (n.startsWith("lest")) return "Lestonan";
  if (n.startsWith("gour")) return "Gourvily";
  if (n.startsWith("ext")) return "Exterieur";
  return null;
}

function normalizeType(raw: string): "standard" | "surcharge" | "VL" | "Mini" {
  const n = raw.toLowerCase().trim();
  if (n.includes("surcharge") || n.includes("overflow")) return "surcharge";
  if (n === "vl" || n.includes("véhicule léger") || n.includes("vehicule leger") || n === "voiture") return "VL";
  if (n.includes("mini")) return "Mini";
  return "standard";
}

function isOccupied(statut: string): boolean {
  const n = statut.toLowerCase();
  return n.startsWith("occup") || n === "taken" || n === "busy";
}

function spotColorClass(spot: ParkingSpot): string {
  const t = normalizeType(spot.type);
  if (t === "VL" || t === "Mini") {
    return "bg-neutral-300 text-neutral-900 border-neutral-400";
  }
  const occ = isOccupied(spot.statut);
  if (t === "surcharge") {
    return occ
      ? "bg-red-900 text-white border-red-950"
      : "bg-orange-400 text-neutral-950 border-orange-500";
  }
  return occ
    ? "bg-red-500 text-white border-red-600"
    : "bg-green-500 text-white border-green-600";
}

function ParkingPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  const fetchSpots = useServerFn(getParkingSpots);
  const fetchVehicles = useServerFn(listParkingVehicles);
  const assignFn = useServerFn(assignVehicleToSpot);
  const freeFn = useServerFn(freeSpot);

  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDepot, setActiveDepot] = useState<Depot>("Lestonan");
  const [selected, setSelected] = useState<ParkingSpot | null>(null);
  const [chosenVehicle, setChosenVehicle] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, v] = await Promise.all([fetchSpots(), fetchVehicles()]);
      setSpots(s.spots);
      setVehicles(v.vehicles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load parking data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const byDepot = useMemo(() => {
    const groups: Record<Depot, ParkingSpot[]> = {
      Lestonan: [], Gourvily: [], Exterieur: [],
    };
    for (const s of spots) {
      const d = normalizeDepot(s.depot);
      if (d) groups[d].push(s);
    }
    return groups;
  }, [spots]);

  const openSpot = (s: ParkingSpot) => {
    setSelected(s);
    setChosenVehicle(s.vehicleId ?? "");
  };

  const doAssign = async () => {
    if (!selected || !chosenVehicle) return;
    setSaving(true);
    try {
      await assignFn({ data: { pageId: selected.id, vehicleId: chosenVehicle } });
      toast.success("Véhicule affecté");
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'affectation");
    } finally {
      setSaving(false);
    }
  };

  const doFree = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await freeFn({ data: { pageId: selected.id } });
      toast.success("Emplacement libéré");
      setSelected(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de libération");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/"><ArrowLeft className="mr-1.5 h-4 w-4" />Tableau de bord</Link>
            </Button>
            <h1 className="text-base font-semibold sm:text-lg">Parking View</h1>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading && spots.length === 0 ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : (
          <Tabs value={activeDepot} onValueChange={(v) => setActiveDepot(v as Depot)}>
            <TabsList className="mb-4">
              {DEPOTS.map((d) => (
                <TabsTrigger key={d} value={d}>{DEPOT_LABELS[d]}</TabsTrigger>
              ))}
            </TabsList>
            {DEPOTS.map((d) => (
              <TabsContent key={d} value={d} className="space-y-3">
                <DepotSection spots={byDepot[d]} onSelect={openSpot} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </main>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name || "Emplacement"}</SheetTitle>
                <SheetDescription>
                  {DEPOT_LABELS[(normalizeDepot(selected.depot) ?? "Lestonan") as Depot]} · Type : {selected.type || "—"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-3 text-sm">
                <Row label="Statut" value={selected.statut || "—"} />
                <Row label="X" value={selected.x != null ? String(selected.x) : "—"} />
                <Row label="Y" value={selected.y != null ? String(selected.y) : "—"} />
                <Row label="Véhicule" value={selected.vehicleName ?? "—"} />

                <div className="pt-2">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {isOccupied(selected.statut) ? "Changer de véhicule" : "Affecter un véhicule"}
                  </label>
                  <Select value={chosenVehicle} onValueChange={setChosenVehicle}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un véhicule…" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                          Aucun véhicule trouvé.
                        </div>
                      )}
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <SheetFooter className="mt-6 flex-col gap-2 sm:flex-row">
                {isOccupied(selected.statut) && (
                  <Button variant="secondary" onClick={doFree} disabled={saving}>
                    Libérer
                  </Button>
                )}
                <Button
                  onClick={doAssign}
                  disabled={saving || !chosenVehicle || chosenVehicle === selected.vehicleId}
                >
                  {saving ? "Enregistrement…" : isOccupied(selected.statut) ? "Mettre à jour" : "Affecter"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function DepotSection({
  spots, onSelect,
}: { spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  const stats = useMemo(() => {
    let total = 0, occ = 0, free = 0, surcharge = 0;
    for (const s of spots) {
      total++;
      if (isOccupied(s.statut)) occ++; else free++;
      if (normalizeType(s.type) === "surcharge") surcharge++;
    }
    return { total, occ, free, surcharge };
  }, [spots]);

  if (spots.length === 0) {
    return <div className="text-sm text-muted-foreground">Aucun emplacement configuré pour ce dépôt.</div>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Total" value={stats.total} />
        <StatBox label="Occupés" value={stats.occ} tone="red" />
        <StatBox label="Libres" value={stats.free} tone="green" />
        <StatBox label="Surcharge" value={stats.surcharge} tone="orange" />
      </div>

      <div
        className="relative w-full overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-900/40"
        style={{ aspectRatio: "16 / 10", minHeight: 360 }}
      >
        {spots.map((s) => {
          const x = Math.max(0, Math.min(100, s.x ?? 0));
          const y = Math.max(0, Math.min(100, s.y ?? 0));
          const color = spotColorClass(s);
          const label = isOccupied(s.statut)
            ? (s.vehicleName ?? "Occupé")
            : "Available";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary ${color}`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                minWidth: 68,
                maxWidth: 110,
              }}
              title={`${s.name} · ${s.statut}`}
            >
              <div className="truncate font-semibold">{s.name || "—"}</div>
              <div className="truncate opacity-90">{label}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function StatBox({
  label, value, tone,
}: { label: string; value: number; tone?: "red" | "green" | "orange" }) {
  const toneCls =
    tone === "red" ? "text-red-600"
      : tone === "green" ? "text-green-600"
      : tone === "orange" ? "text-orange-600"
      : "text-foreground";
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}
