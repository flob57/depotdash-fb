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

// Occupied = vehicle assigned in "Mon Parc". No more Statut column.
function isOccupied(spot: ParkingSpot): boolean {
  return !!spot.vehicleId;
}

function inferTypeFromName(name: string): "standard" | "surcharge" | "VL" | "Mini" {
  const n = name.toLowerCase();
  if (n.includes("surcharge")) return "surcharge";
  if (n.includes("vl")) return "VL";
  if (n.includes("mini")) return "Mini";
  return "standard";
}

function spotColorClass(spot: ParkingSpot): string {
  const t = spot.type ? normalizeType(spot.type) : inferTypeFromName(spot.name);
  const occ = isOccupied(spot);
  // Mini, VL and Surcharge: grey when free, red when occupied.
  if (t === "VL" || t === "Mini" || t === "surcharge") {
    return occ
      ? "bg-red-500 text-white border-red-600"
      : "bg-slate-300 text-slate-900 border-slate-400";
  }
  // Standard spots (Lestonan 1..11): green free / red occupied.
  return occ
    ? "bg-red-500 text-white border-red-600"
    : "bg-green-500 text-white border-green-600";
}

// ---------- Lestonan schematic layout (matches the depot plan) ----------
// Coordinates are percentages inside a 100x100 container.
type Box = { left: number; top: number; width: number; height: number; rotate?: number };
function normName(n: string): string {
  return n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const LESTONAN_LAYOUT: Record<string, Box> = {
  "lestonan 1":         { left: 56,  top: 6,   width: 8,  height: 16 },
  "lestonan 3":         { left: 65,  top: 6,   width: 8,  height: 16 },
  "lestonan 2":         { left: 56,  top: 30,  width: 8,  height: 16 },
  "lestonan 4":         { left: 65,  top: 30,  width: 8,  height: 16 },
  "lestonan 5":         { left: 74,  top: 30,  width: 8,  height: 16 },
  "lestonan mini 1":    { left: 89,  top: 1,   width: 10, height: 11 },
  "lestonan 11":        { left: 89,  top: 14,  width: 9,  height: 17 },
  "lestonan 10":        { left: 2,   top: 52,  width: 20, height: 7 },
  "lestonan 9":         { left: 2,   top: 61,  width: 20, height: 7 },
  "lestonan 8":         { left: 2,   top: 70,  width: 20, height: 7 },
  "lestonan 7":         { left: 2,   top: 79,  width: 20, height: 7 },
  "lestonan 6":         { left: 2,   top: 88,  width: 20, height: 7 },
  "lestonan mini 2":    { left: 26,  top: 88,  width: 14, height: 7 },
  "lestonan vl 1":      { left: 78,  top: 55,  width: 16, height: 6, rotate: -18 },
  "lestonan vl 2":      { left: 78,  top: 65,  width: 16, height: 6, rotate: -18 },
  "lestonan surcharge 2": { left: 84, top: 82, width: 6, height: 15 },
  "lestonan surcharge 1": { left: 91, top: 82, width: 6, height: 15 },
};

function LestonanMap({
  spots,
  onSelect,
}: {
  spots: ParkingSpot[];
  onSelect: (s: ParkingSpot) => void;
}) {
  const byName = useMemo(() => {
    const m = new Map<string, ParkingSpot>();
    for (const s of spots) m.set(normName(s.name), s);
    return m;
  }, [spots]);

  const positioned: Array<{ spot: ParkingSpot; box: Box }> = [];
  const unpositioned: ParkingSpot[] = [];
  for (const s of spots) {
    const box = LESTONAN_LAYOUT[normName(s.name)];
    if (box) positioned.push({ spot: s, box });
    else unpositioned.push(s);
  }
  // Names present in layout but missing from DB — surface nothing, we just skip.
  void byName;

  return (
    <>
      {/* Horizontally scrollable on small screens so labels stay readable. */}
      <div className="w-full overflow-x-auto rounded-lg border bg-slate-50 dark:bg-slate-900/40">
        <div
          className="relative"
          style={{ width: "100%", minWidth: 640, aspectRatio: "16 / 11" }}
        >
          {/* Static plan elements (non-clickable) */}
          <PlanBlock left={22} top={5} width={33} height={42} className="bg-blue-700 text-white">
            GARAGE BOURBIGOT
          </PlanBlock>
          <PlanBlock left={49} top={30} width={7} height={7} className="bg-white text-neutral-800 border">
            Salle P.S.
          </PlanBlock>
          <PlanBlock left={49} top={38} width={7} height={7} className="bg-white text-neutral-800 border">
            Bureau
          </PlanBlock>
          <PlanBlock left={74} top={6} width={7} height={9} className="bg-green-700 text-white">
            GO
          </PlanBlock>
          <PlanBlock left={74} top={16} width={7} height={9} className="bg-sky-300 text-neutral-900">
            Ad&nbsp;Blue
          </PlanBlock>
          <PlanBlock left={82} top={6} width={6} height={22} className="bg-white text-neutral-800 border" verticalText>
            LAVAGE
          </PlanBlock>

          {/* Spots */}
          {positioned.map(({ spot, box }) => (
            <SpotButton key={spot.id} spot={spot} box={box} onSelect={onSelect} />
          ))}
        </div>
      </div>

      {unpositioned.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-xs text-muted-foreground">
            Autres emplacements (sans position dans le plan)
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {unpositioned.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className={`rounded-md border px-2 py-2 text-left text-xs shadow-sm ${spotColorClass(s)}`}
              >
                <div className="truncate font-semibold">{s.name || "—"}</div>
                <div className="truncate opacity-90">
                  {isOccupied(s) ? (s.vehicleName ?? "Occupé") : "Libre"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SpotButton({
  spot, box, onSelect,
}: { spot: ParkingSpot; box: Box; onSelect: (s: ParkingSpot) => void }) {
  const color = spotColorClass(spot);
  const occ = isOccupied(spot);
  const shortLabel = spot.name.replace(/^LESTONAN\s+/i, "");
  return (
    <button
      type="button"
      onClick={() => onSelect(spot)}
      className={`absolute flex flex-col items-center justify-center overflow-hidden rounded-[4px] border px-1 text-center text-[10px] font-semibold leading-tight shadow-sm transition hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-primary ${color}`}
      style={{
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
        transform: box.rotate ? `rotate(${box.rotate}deg)` : undefined,
        transformOrigin: "center",
      }}
      title={`${spot.name} · ${occ ? (spot.vehicleName ?? "Occupé") : "Libre"}`}
    >
      <div className="w-full truncate">{shortLabel || spot.name}</div>
      {occ && (
        <div className="w-full truncate text-[9px] font-bold opacity-95">
          {spot.vehicleName ?? "—"}
        </div>
      )}
    </button>
  );
}

function PlanBlock({
  left, top, width, height, className, children, verticalText,
}: {
  left: number; top: number; width: number; height: number;
  className?: string; children: React.ReactNode; verticalText?: boolean;
}) {
  return (
    <div
      className={`absolute flex items-center justify-center rounded-sm text-center text-[10px] font-semibold leading-tight ${className ?? ""}`}
      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
    >
      <span
        className="px-1"
        style={verticalText ? { writingMode: "vertical-rl", transform: "rotate(180deg)" } : undefined}
      >
        {children}
      </span>
    </div>
  );
}

// ---------- Generic depot layout (fallback for Gourvily / Exterieur) ----------
function GenericDepotMap({
  spots, onSelect,
}: { spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-900/40"
      style={{ aspectRatio: "16 / 10", minHeight: 360 }}
    >
      {spots.map((s) => {
        const x = Math.max(0, Math.min(100, s.x ?? 50));
        const y = Math.max(0, Math.min(100, s.y ?? 50));
        const color = spotColorClass(s);
        const occ = isOccupied(s);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary ${color}`}
            style={{ left: `${x}%`, top: `${y}%`, minWidth: 68, maxWidth: 120 }}
            title={`${s.name} · ${occ ? (s.vehicleName ?? "Occupé") : "Libre"}`}
          >
            <div className="truncate font-semibold">{s.name || "—"}</div>
            <div className="truncate opacity-90">
              {occ ? (s.vehicleName ?? "Occupé") : "Libre"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Page ----------
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

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
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
                <DepotSection depot={d} spots={byDepot[d]} onSelect={openSpot} />
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
                  {DEPOT_LABELS[(normalizeDepot(selected.depot) ?? "Lestonan") as Depot]}
                  {selected.type ? ` · Type : ${selected.type}` : ""}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-3 text-sm">
                <Row label="Statut" value={isOccupied(selected) ? "Occupé" : "Libre"} />
                <Row label="Véhicule" value={selected.vehicleName ?? "—"} />

                <div className="pt-2">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {isOccupied(selected) ? "Changer de véhicule" : "Affecter un véhicule"}
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
                {isOccupied(selected) && (
                  <Button variant="secondary" onClick={doFree} disabled={saving}>
                    Libérer
                  </Button>
                )}
                <Button
                  onClick={doAssign}
                  disabled={saving || !chosenVehicle || chosenVehicle === selected.vehicleId}
                >
                  {saving ? "Enregistrement…" : isOccupied(selected) ? "Mettre à jour" : "Affecter"}
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
  depot, spots, onSelect,
}: { depot: Depot; spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  const stats = useMemo(() => {
    let total = 0, occ = 0, free = 0, surcharge = 0;
    for (const s of spots) {
      total++;
      if (isOccupied(s)) occ++; else free++;
      const t = s.type ? normalizeType(s.type) : inferTypeFromName(s.name);
      if (t === "surcharge") surcharge++;
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

      {depot === "Lestonan"
        ? <LestonanMap spots={spots} onSelect={onSelect} />
        : <GenericDepotMap spots={spots} onSelect={onSelect} />
      }
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
