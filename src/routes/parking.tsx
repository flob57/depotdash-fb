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

// Occupied = at least one vehicle assigned in "Mon Parc".
function isOccupied(spot: ParkingSpot): boolean {
  return (spot.vehicleIds?.length ?? 0) > 0 || !!spot.vehicleId;
}

function inferTypeFromName(name: string): "standard" | "surcharge" | "VL" | "Mini" {
  const n = name.toLowerCase();
  if (n.includes("surcharge")) return "surcharge";
  if (n.includes("vl")) return "VL";
  if (n.includes("mini")) return "Mini";
  return "standard";
}

const STACKED_SPOTS = new Set([
  "lestonan 1", "lestonan 2", "lestonan 3", "lestonan 4", "lestonan 5", "lestonan 11",
]);

function normName(n: string): string {
  return n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function usesStackedFormat(name: string): boolean {
  return STACKED_SPOTS.has(normName(name));
}

// Color scheme for Lestonan (specific for Mini/VL/Surcharge).
function lestonanColorClass(spot: ParkingSpot): string {
  const t = spot.type ? normalizeType(spot.type) : inferTypeFromName(spot.name);
  const occ = isOccupied(spot);
  if (t === "VL" || t === "Mini" || t === "surcharge") {
    return occ
      ? "bg-red-500 text-white border-red-600"
      : "bg-slate-300 text-slate-900 border-slate-400";
  }
  return occ
    ? "bg-red-500 text-white border-red-600"
    : "bg-green-500 text-white border-green-600";
}

// Simple green/red for Exterieur.
function simpleColorClass(occupied: boolean): string {
  return occupied
    ? "bg-red-500 text-white border-red-600"
    : "bg-green-500 text-white border-green-600";
}

// Gourvily: standard spots green/red; VL & Surcharge grey when free,
// distinct dark-red (rose) when occupied.
function gourvilyColorClass(spot: ParkingSpot): string {
  const t = spot.type ? normalizeType(spot.type) : inferTypeFromName(spot.name);
  const occ = isOccupied(spot);
  if (t === "VL" || t === "surcharge") {
    return occ
      ? "bg-rose-800 text-white border-rose-900"
      : "bg-slate-300 text-slate-900 border-slate-400";
  }
  return occ
    ? "bg-red-500 text-white border-red-600"
    : "bg-green-500 text-white border-green-600";
}

// ---------- Lestonan schematic layout ----------
type Box = { left: number; top: number; width: number; height: number; rotate?: number };

const LESTONAN_LAYOUT: Record<string, Box> = {
  "lestonan 1":           { left: 56,  top: 6,   width: 8,  height: 16 },
  "lestonan 3":           { left: 65,  top: 6,   width: 8,  height: 16 },
  "lestonan 2":           { left: 56,  top: 30,  width: 8,  height: 16 },
  "lestonan 4":           { left: 65,  top: 30,  width: 8,  height: 16 },
  "lestonan 5":           { left: 74,  top: 30,  width: 8,  height: 16 },
  // "Lestonan Mini" (Notion name without number) sits above Lestonan 11.
  "lestonan mini":        { left: 91,  top: 3,   width: 7,  height: 8 },
  "lestonan mini 1":      { left: 91,  top: 3,   width: 7,  height: 8 },
  "lestonan 11":          { left: 90,  top: 14,  width: 9,  height: 20 },
  "lestonan 10":          { left: 2,   top: 52,  width: 20, height: 7 },
  "lestonan 9":           { left: 2,   top: 61,  width: 20, height: 7 },
  "lestonan 8":           { left: 2,   top: 70,  width: 20, height: 7 },
  "lestonan 7":           { left: 2,   top: 79,  width: 20, height: 7 },
  "lestonan 6":           { left: 2,   top: 88,  width: 20, height: 7 },
  "lestonan mini 2":      { left: 26,  top: 89,  width: 11, height: 6 },
  "lestonan vl 1":        { left: 78,  top: 55,  width: 16, height: 6, rotate: -18 },
  "lestonan vl 2":        { left: 78,  top: 65,  width: 16, height: 6, rotate: -18 },
  "lestonan surcharge 2": { left: 84,  top: 82,  width: 6,  height: 15 },
  "lestonan surcharge 1": { left: 91,  top: 82,  width: 6,  height: 15 },
};

function LestonanMap({
  spots, onSelect,
}: { spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  const positioned: Array<{ spot: ParkingSpot; box: Box }> = [];
  const unpositioned: ParkingSpot[] = [];
  for (const s of spots) {
    const box = LESTONAN_LAYOUT[normName(s.name)];
    if (box) positioned.push({ spot: s, box });
    else unpositioned.push(s);
  }

  return (
    <>
      <div className="w-full overflow-x-auto rounded-lg border bg-slate-50 dark:bg-slate-900/40">
        <div className="relative" style={{ width: "100%", minWidth: 640, aspectRatio: "16 / 11" }}>
          <PlanBlock left={22} top={5} width={33} height={42} className="bg-blue-700 text-white">
            GARAGE BOURBIGOT
          </PlanBlock>
          <PlanBlock left={49} top={30} width={7} height={7} className="bg-white text-neutral-800 border">
            Salle P.S.
          </PlanBlock>
          <PlanBlock left={49} top={38} width={7} height={7} className="bg-white text-neutral-800 border">
            Bureau
          </PlanBlock>
          <PlanBlock left={74} top={6} width={7} height={9} className="bg-blue-600 text-white">
            GO
          </PlanBlock>
          <PlanBlock left={74} top={16} width={7} height={9} className="bg-sky-300 text-neutral-900">
            Ad&nbsp;Blue
          </PlanBlock>
          <PlanBlock left={82} top={6} width={6} height={22} className="bg-white text-neutral-800 border" verticalText>
            LAVAGE
          </PlanBlock>

          {positioned.map(({ spot, box }) => (
            <SpotButton
              key={spot.id}
              spot={spot}
              box={box}
              onSelect={onSelect}
              colorClass={lestonanColorClass(spot)}
              stacked={usesStackedFormat(spot.name)}
              displayName={spot.name.replace(/^LESTONAN\s+/i, "")}
            />
          ))}
        </div>
      </div>

      {unpositioned.length > 0 && (
        <UnpositionedList spots={unpositioned} onSelect={onSelect} colorFn={lestonanColorClass} />
      )}
    </>
  );
}

// ---------- Gourvily schematic layout ----------
// Diagonal parking spots (bus bays): narrow-tall rectangles rotated ~-28°
// so they lean like the depot plan.
const GOURVILY_SPOT_ANGLE = -28;
const GOURVILY_LAYOUT: Record<string, Box> = {
  "gourvily mini":        { left: 3,  top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 1":           { left: 10, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 2":           { left: 17, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 3":           { left: 24, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 4":           { left: 31, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 5":           { left: 38, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 6":           { left: 45, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 7":           { left: 52, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 8":           { left: 59, top: 12, width: 5, height: 22, rotate: GOURVILY_SPOT_ANGLE },
  "gourvily 9":           { left: 68, top: 15, width: 5, height: 20, rotate: -12 },
  "gourvily 10":          { left: 75, top: 15, width: 5, height: 20, rotate: -12 },
  "gourvily 11":          { left: 84, top: 34, width: 14, height: 9 },
  "gourvily vl":          { left: 75, top: 78, width: 6,  height: 14 },
  "gourvily surcharge 2": { left: 84, top: 68, width: 12, height: 8 },
  "gourvily surcharge 1": { left: 84, top: 80, width: 12, height: 8 },
};

function GourvilyMap({
  spots, onSelect,
}: { spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  const positioned: Array<{ spot: ParkingSpot; box: Box }> = [];
  const unpositioned: ParkingSpot[] = [];
  for (const s of spots) {
    const box = GOURVILY_LAYOUT[normName(s.name)];
    if (box) positioned.push({ spot: s, box });
    else unpositioned.push(s);
  }

  return (
    <>
      <div className="w-full overflow-x-auto rounded-lg border bg-slate-50 dark:bg-slate-900/40">
        <div className="relative" style={{ width: "100%", minWidth: 640, aspectRatio: "16 / 11" }}>
          {/* Depot buildings */}
          <PlanBlock left={2}  top={48} width={60} height={50} className="bg-blue-700 text-white">
            &nbsp;
          </PlanBlock>
          <PlanBlock left={40} top={62} width={40} height={36} className="bg-blue-700 text-white">
            &nbsp;
          </PlanBlock>
          <PlanBlock left={69} top={62} width={5}  height={12} className="bg-emerald-300 text-neutral-900" verticalText>
            ALGECO
          </PlanBlock>
          <PlanBlock left={62} top={88} width={7}  height={9}  className="bg-emerald-300 text-neutral-900">
            LOCAL
          </PlanBlock>
          {positioned.map(({ spot, box }) => (
            <SpotButton
              key={spot.id}
              spot={spot}
              box={box}
              onSelect={onSelect}
              colorClass={simpleColorClass(isOccupied(spot))}
              stacked={false}
              displayName={spot.name.replace(/^GOURVILY\s+/i, "")}
            />
          ))}
        </div>
      </div>

      {unpositioned.length > 0 && (
        <UnpositionedList
          spots={unpositioned}
          onSelect={onSelect}
          colorFn={(s) => simpleColorClass(isOccupied(s))}
        />
      )}
    </>
  );
}

// ---------- Exterieur schematic ----------
type ExtSection = {
  title: string;
  rotate?: number;
  spots: string[]; // canonical (normName) names to look for
};

const EXTERIEUR_SECTIONS: ExtSection[] = [
  {
    title: "Quimper",
    rotate: -14,
    spots: ["quimper - thepot 1", "quimper - thepot 2", "quimper - thepot 3"],
  },
  {
    title: "Briec",
    rotate: -14,
    spots: ["briec - p. stephan", "briec - penity", "briec - gougastel"],
  },
  {
    title: "Autres",
    rotate: -14,
    spots: [
      "landudal - keriou", "cast", "tregourez",
      "quemeneven", "saint-coulitz", "saint-goazec",
    ],
  },
];

const COAT_CONQ_KEY = "coat-conq - atelier";

// Match spot to canonical name (accents/dash-space insensitive).
function matchSpot(spots: ParkingSpot[], canonical: string): ParkingSpot | undefined {
  const target = canonical.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return spots.find((s) => {
    const n = normName(s.name).replace(/[–—]/g, "-").replace(/\s+/g, " ");
    return n === target;
  });
}

function ExterieurMap({
  spots, onSelect,
}: { spots: ParkingSpot[]; onSelect: (s: ParkingSpot) => void }) {
  const consumedIds = new Set<string>();

  // Build display order.
  const sections = EXTERIEUR_SECTIONS.map((sec) => ({
    ...sec,
    resolved: sec.spots.map((cand) => {
      const match = matchSpot(spots, cand);
      if (match) consumedIds.add(match.id);
      return { key: cand, label: prettyExtLabel(cand), spot: match };
    }),
  }));

  const coatConqSpot = matchSpot(spots, COAT_CONQ_KEY);
  if (coatConqSpot) consumedIds.add(coatConqSpot.id);
  const coatSlots = Array.from({ length: 5 }, (_, i) => {
    const name = coatConqSpot?.vehicleNames?.[i] ?? null;
    return { index: i + 1, vehicleName: name };
  });

  const unmatched = spots.filter((s) => !consumedIds.has(s.id));

  return (
    <div className="space-y-6">
      {sections.map((sec) => (
        <section key={sec.title}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{sec.title}</h3>
          <div className="flex flex-wrap gap-3">
            {sec.resolved.map(({ key, label, spot }) => (
              <ExtCard
                key={key}
                label={label}
                spot={spot}
                rotate={sec.rotate}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Coat-Conq - Atelier</h3>
        {!coatConqSpot ? (
          <div className="text-xs text-muted-foreground">
            Aucun emplacement "Coat-Conq - Atelier" trouvé dans Notion.
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {coatSlots.map((slot) => (
              <button
                key={slot.index}
                type="button"
                onClick={() => onSelect(coatConqSpot)}
                className={`flex h-16 w-40 flex-col items-start justify-between rounded-md border px-2 py-1.5 text-left shadow-sm transition hover:scale-[1.02] ${simpleColorClass(!!slot.vehicleName)}`}
                style={{ transform: "rotate(-14deg)" }}
                title={`Coat-Conq ${slot.index} · ${slot.vehicleName ?? "Libre"}`}
              >
                <span className="text-xs font-semibold opacity-90">{slot.index}</span>
                <span className="w-full truncate text-sm font-bold">
                  {slot.vehicleName ?? "Libre"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Autres dépôts</h3>
        {unmatched.length === 0 ? (
          <div className="text-xs text-muted-foreground">—</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {unmatched.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s)}
                className={`rounded-md border px-2 py-2 text-left text-xs shadow-sm ${simpleColorClass(isOccupied(s))}`}
              >
                <div className="truncate font-semibold">{s.name || "—"}</div>
                <div className="truncate text-sm font-bold">
                  {isOccupied(s)
                    ? (s.vehicleNames.length > 1
                        ? s.vehicleNames.join(", ")
                        : (s.vehicleName ?? "Occupé"))
                    : "Libre"}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function prettyExtLabel(canonical: string): string {
  const map: Record<string, string> = {
    "quimper - thepot 1": "Quimper – Thépôt 1",
    "quimper - thepot 2": "Quimper – Thépôt 2",
    "quimper - thepot 3": "Quimper – Thépôt 3",
    "briec - p. stephan": "Briec – P. Stéphan",
    "briec - penity": "Briec – Penity",
    "briec - gougastel": "Briec – Gougastel",
    "landudal - keriou": "Landudal – Keriou",
    "cast": "Cast",
    "tregourez": "Trégourez",
    "quemeneven": "Quéménéven",
    "saint-coulitz": "Saint-Coulitz",
    "saint-goazec": "Saint-Goazec",
  };
  return map[canonical] ?? canonical;
}

function ExtCard({
  label, spot, rotate, onSelect,
}: {
  label: string;
  spot?: ParkingSpot;
  rotate?: number;
  onSelect: (s: ParkingSpot) => void;
}) {
  const occ = spot ? isOccupied(spot) : false;
  const color = spot ? simpleColorClass(occ) : "bg-slate-200 text-slate-500 border-slate-300";
  return (
    <button
      type="button"
      onClick={() => spot && onSelect(spot)}
      disabled={!spot}
      className={`flex h-16 w-52 flex-col items-start justify-between rounded-md border px-2 py-1.5 text-left shadow-sm transition ${spot ? "hover:scale-[1.02]" : "opacity-60"} ${color}`}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      title={spot ? `${spot.name} · ${occ ? (spot.vehicleName ?? "Occupé") : "Libre"}` : label}
    >
      <span className="w-full truncate text-xs font-semibold opacity-95">{label}</span>
      <span className="w-full truncate text-sm font-bold">
        {spot ? (occ ? (spot.vehicleName ?? "Occupé") : "Libre") : "Non configuré"}
      </span>
    </button>
  );
}

// ---------- Shared: spot button, plan block, unpositioned list ----------
function formatPlate(plate: string): string[] {
  const m = plate.match(/^([A-Za-z]+)[\s-]*(\d+)[\s-]*([A-Za-z]+)$/);
  if (m) return [`${m[1]}-`, m[2], `-${m[3]}`];
  return [plate];
}

function SpotButton({
  spot, box, onSelect, colorClass, stacked, displayName,
}: {
  spot: ParkingSpot;
  box: Box;
  onSelect: (s: ParkingSpot) => void;
  colorClass: string;
  stacked: boolean;
  displayName: string;
}) {
  const occ = isOccupied(spot);
  const plateLines = occ && spot.vehicleName ? formatPlate(spot.vehicleName) : [];
  return (
    <button
      type="button"
      onClick={() => onSelect(spot)}
      className={`absolute flex flex-col items-center justify-center overflow-hidden rounded-[4px] border px-0.5 text-center font-semibold leading-tight shadow-sm transition hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-primary ${colorClass}`}
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
      <div className="w-full truncate text-[10px] sm:text-xs">{displayName || spot.name}</div>
      {occ && (
        stacked ? (
          <div className="mt-0.5 flex w-full flex-col items-center font-bold leading-[1.05] text-[9px] sm:text-[13px]">
            {plateLines.length > 0
              ? plateLines.map((l, i) => <span key={i}>{l}</span>)
              : <span>—</span>}
          </div>
        ) : (
          <div className="mt-0.5 w-full truncate font-bold leading-[1.05] text-[9px] sm:text-[13px]">
            {spot.vehicleName}
          </div>
        )
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

function UnpositionedList({
  spots, onSelect, colorFn,
}: {
  spots: ParkingSpot[];
  onSelect: (s: ParkingSpot) => void;
  colorFn: (s: ParkingSpot) => string;
}) {
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs text-muted-foreground">
        Autres emplacements (sans position dans le plan)
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {spots.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={`rounded-md border px-2 py-2 text-left text-xs shadow-sm ${colorFn(s)}`}
          >
            <div className="truncate font-semibold">{s.name || "—"}</div>
            <div className="truncate text-sm font-bold">
              {isOccupied(s) ? (s.vehicleName ?? "Occupé") : "Libre"}
            </div>
          </button>
        ))}
      </div>
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
                <Row
                  label="Véhicule"
                  value={
                    selected.vehicleNames.length > 1
                      ? selected.vehicleNames.join(", ")
                      : (selected.vehicleName ?? "—")
                  }
                />

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

      {depot === "Lestonan" && <LestonanMap spots={spots} onSelect={onSelect} />}
      {depot === "Gourvily" && <GourvilyMap spots={spots} onSelect={onSelect} />}
      {depot === "Exterieur" && <ExterieurMap spots={spots} onSelect={onSelect} />}
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
