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
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Trash2, RefreshCw, Plus, ChevronLeft, ArrowUpDown, ArrowUp, ArrowDown, CalendarDays, Pencil } from "lucide-react";
import { syncDutiesFromNotion } from "@/lib/duties.functions";
import { pickSlot, SLOT_LABELS, type ServiceSlot, type SchoolHoliday } from "@/lib/school-context";

export const Route = createFileRoute("/duties")({
  component: DutiesPage,
  head: () => ({ meta: [{ title: "Prises de service — Lestonan" }] }),
});

type Duty = {
  id: string;
  start_time: string; // "HH:MM:SS"
  qub: string;
  driver: string;
  route: string;
  vehicle: string;
  weekdays: number[];
  last_checked_date: string | null;
  sort_order: number;
};

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayWeekday() {
  // ISO: Mon=1..Sun=7
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
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

function DutiesPage() {
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
  return <DutiesView userId={user.id} />;
}

function DutiesView({ userId }: { userId: string }) {
  const [duties, setDuties] = useState<Duty[]>([]);
  const [dbIds, setDbIds] = useState<Record<ServiceSlot, string>>({ weekday: "", wed: "", sat_hol: "" });
  const [holidays, setHolidays] = useState<SchoolHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: "ps" | "qub"; dir: "asc" | "desc" } | null>(null);
  const sync = useServerFn(syncDutiesFromNotion);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const refresh = async () => {
    setLoading(true);
    const [{ data: ds }, { data: settings }, { data: hols }] = await Promise.all([
      supabase.from("duties").select("*").order("start_time", { ascending: true }),
      supabase
        .from("user_notion_settings")
        .select("services_db_id, services_db_id_wed, services_db_id_sat_hol")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("school_holidays").select("*").order("start_date", { ascending: true }),
    ]);
    setDuties((ds ?? []) as Duty[]);
    setDbIds({
      weekday: (settings?.services_db_id as string) ?? "",
      wed: (settings?.services_db_id_wed as string) ?? "",
      sat_hol: (settings?.services_db_id_sat_hol as string) ?? "",
    });
    setHolidays((hols ?? []) as SchoolHoliday[]);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [userId]);

  const wd = todayWeekday();
  const today = todayKey();
  const now = nowMinutes();
  const activeSlot = useMemo(() => pickSlot(new Date(), holidays), [holidays, tick]);

  const visible = useMemo(() => {
    const arr = showAll ? duties : duties.filter((d) => d.weekdays.includes(wd));
    const sorted = [...arr].sort((a, b) => {
      if (!sort) return a.start_time.localeCompare(b.start_time);
      let cmp = 0;
      if (sort.key === "ps") {
        cmp = a.start_time.localeCompare(b.start_time);
      } else if (sort.key === "qub") {
        cmp = a.qub.localeCompare(b.qub);
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [duties, wd, showAll, sort]);

  const checkedCount = visible.filter((d) => d.last_checked_date === today).length;

  const toggleCheck = async (d: Duty) => {
    const isChecked = d.last_checked_date === today;
    const next = isChecked ? null : today;
    setDuties((prev) => prev.map((x) => x.id === d.id ? { ...x, last_checked_date: next } : x));
    const { error } = await supabase
      .from("duties")
      .update({ last_checked_date: next })
      .eq("id", d.id);
    if (error) { toast.error(error.message); refresh(); }
  };

  const removeDuty = async (id: string) => {
    if (!confirm("Supprimer cette prise de service ?")) return;
    const { error } = await supabase.from("duties").delete().eq("id", id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const toggleWeekday = async (d: Duty, wd: number) => {
    const set = new Set(d.weekdays);
    if (set.has(wd)) set.delete(wd); else set.add(wd);
    const next = Array.from(set).sort();
    const { error } = await supabase.from("duties").update({ weekdays: next }).eq("id", d.id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const saveDbIds = async (next: Record<ServiceSlot, string>) => {
    const { error } = await supabase
      .from("user_notion_settings")
      .upsert(
        {
          user_id: userId,
          services_db_id: next.weekday || null,
          services_db_id_wed: next.wed || null,
          services_db_id_sat_hol: next.sat_hol || null,
        },
        { onConflict: "user_id" },
      );
    if (error) { toast.error(error.message); return false; }
    setDbIds(next);
    return true;
  };

  const handleSync = async () => {
    const slot = pickSlot(new Date(), holidays);
    const targetDb = dbIds[slot];
    if (!targetDb) {
      toast.error(`Aucune base Notion configurée pour aujourd'hui (${SLOT_LABELS[slot]}).`);
      return;
    }
    try {
      const res = await sync({ data: { databaseId: targetDb } });
      toast.success(`${res.upserted} prises synchronisées depuis « ${SLOT_LABELS[slot]} »${res.skipped ? ` (${res.skipped} ignorées)` : ""}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la synchronisation");
    }
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
            <h1 className="truncate text-sm sm:text-base font-semibold">Prises de service</h1>
          </div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {checkedCount}/{visible.length}
          </div>
        </div>
      </header>


      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <NotionSyncDialog dbIds={dbIds} onSave={saveDbIds} onSync={handleSync} activeSlot={activeSlot} />
          <SchoolHolidaysDialog holidays={holidays} onChange={refresh} />
          <span className="text-xs text-muted-foreground">
            Aujourd'hui : <strong>{SLOT_LABELS[activeSlot]}</strong>
          </span>
          <AddDutyDialog userId={userId} onAdded={refresh} />
          <label className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={showAll} onCheckedChange={(v) => setShowAll(Boolean(v))} />
            Afficher tous les jours
          </label>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
            Aucune prise de service prévue aujourd'hui. Synchronisez depuis Notion ou ajoutez-en manuellement.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-2">
              {visible.map((d) => {
                const checked = d.last_checked_date === today;
                const overdue = !checked && timeMinutes(d.start_time) <= now && d.weekdays.includes(wd);
                return (
                  <div
                    key={d.id}
                    className={cn(
                      "rounded-md border bg-card p-3",
                      checked && "bg-green-500/10 border-green-500/30",
                      overdue && "bg-destructive/15 border-destructive/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox checked={checked} onCheckedChange={() => toggleCheck(d)} className="mt-1 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-lg font-semibold tabular-nums">{hm(d.start_time)}</span>
                          <span className="text-xs text-muted-foreground">QUB {d.qub}</span>
                        </div>
                        <div className="mt-0.5 text-sm font-medium truncate">{d.driver}</div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                          <span>{d.route}</span>
                          <span className="font-mono">{d.vehicle}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <EditDutyDialog duty={d} onSaved={refresh} />
                        <Button variant="ghost" size="icon" onClick={() => removeDuty(d.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
                    <th className="w-12 px-2 py-2 text-center">OK</th>
                    <th
                      className="cursor-pointer px-2 py-2 text-left select-none"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === "ps" ? { key: "ps", dir: s.dir === "asc" ? "desc" : "asc" } : { key: "ps", dir: "asc" }
                        )
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        PS
                        {sort?.key === "ps" ? (
                          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </span>
                    </th>
                    <th
                      className="cursor-pointer px-2 py-2 text-left select-none"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === "qub" ? { key: "qub", dir: s.dir === "asc" ? "desc" : "asc" } : { key: "qub", dir: "asc" }
                        )
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        QUB
                        {sort?.key === "qub" ? (
                          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </span>
                    </th>
                    <th className="px-2 py-2 text-left">Conducteur</th>
                    <th className="px-2 py-2 text-left">Service</th>
                    <th className="px-2 py-2 text-left">Véhicule</th>
                    <th className="px-2 py-2 text-left">Jours</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => {
                    const checked = d.last_checked_date === today;
                    const overdue = !checked && timeMinutes(d.start_time) <= now && d.weekdays.includes(wd);
                    return (
                      <tr
                        key={d.id}
                        className={cn(
                          "border-t",
                          checked && "bg-green-500/10",
                          overdue && "bg-destructive/15 text-destructive-foreground",
                        )}
                      >
                        <td className="px-2 py-2 text-center">
                          <Checkbox checked={checked} onCheckedChange={() => toggleCheck(d)} />
                        </td>
                        <td className="px-2 py-2 font-mono font-semibold">{hm(d.start_time)}</td>
                        <td className="px-2 py-2">{d.qub}</td>
                        <td className="px-2 py-2">{d.driver}</td>
                        <td className="px-2 py-2">{d.route}</td>
                        <td className="px-2 py-2 font-mono text-xs">{d.vehicle}</td>
                        <td className="px-2 py-2">
                          <EditDutyDialog duty={d} onSaved={refresh} />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="icon" onClick={() => removeDuty(d.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Les coches se réinitialisent automatiquement chaque jour à minuit.
        </p>
        <span className="hidden">{tick}</span>
      </main>
    </div>
  );
}

const WD_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
function WeekdayPicker({ value, onToggle }: { value: number[]; onToggle: (w: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {WD_LABELS.map((lbl, i) => {
        const w = i + 1;
        const active = value.includes(w);
        return (
          <button
            key={w}
            type="button"
            onClick={() => onToggle(w)}
            className={cn(
              "h-6 w-6 rounded text-[10px] font-semibold",
              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

function NotionSyncDialog({
  dbIds, onSave, onSync, activeSlot,
}: {
  dbIds: Record<ServiceSlot, string>;
  onSave: (next: Record<ServiceSlot, string>) => Promise<boolean>;
  onSync: () => Promise<void>;
  activeSlot: ServiceSlot;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(dbIds);
  useEffect(() => setLocal(dbIds), [dbIds]);

  const run = async () => {
    setBusy(true);
    const ok = await onSave(local);
    if (ok) await onSync();
    setBusy(false);
    setOpen(false);
  };

  const saveOnly = async () => {
    setBusy(true);
    const ok = await onSave(local);
    setBusy(false);
    if (ok) {
      toast.success("Bases Notion enregistrées.");
      setOpen(false);
    }
  };

  const field = (slot: ServiceSlot, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label className="flex items-center gap-2">
        {label}
        {activeSlot === slot && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            ACTIVE AUJOURD'HUI
          </span>
        )}
      </Label>
      <Input
        value={local[slot]}
        onChange={(e) => setLocal({ ...local, [slot]: e.target.value })}
        placeholder="https://notion.so/…"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Synchroniser depuis Notion
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bases Notion par jour</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {field("weekday", "Services Lestonan période scolaire", "Utilisée le lundi, mardi, jeudi et vendredi en période scolaire.")}
          {field("wed", "Services Mer PS", "Utilisée le mercredi en période scolaire.")}
          {field("sat_hol", "Services Sam + PV", "Utilisée le samedi en période scolaire et du lundi au samedi pendant les vacances.")}
          <p className="text-xs text-muted-foreground">
            Colonnes attendues : PS, QUB, Driver, Route 1, Vehicle. Chaque base doit être partagée avec l'intégration Notion.
            La synchronisation remplace les prises actuelles par celles de la base active aujourd'hui.
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={saveOnly} disabled={busy}>Enregistrer seulement</Button>
          <Button onClick={run} disabled={busy}>
            {busy ? "Synchronisation…" : `Synchroniser (${SLOT_LABELS[activeSlot]})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SchoolHolidaysDialog({ holidays, onChange }: { holidays: SchoolHoliday[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!label.trim() || !start || !end) {
      toast.error("Renseignez le libellé et les deux dates.");
      return;
    }
    if (end < start) {
      toast.error("La date de fin doit être après la date de début.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("school_holidays").insert({
      label: label.trim(),
      start_date: start,
      end_date: end,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setLabel(""); setStart(""); setEnd("");
      onChange();
      toast.success("Période ajoutée");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette période ?")) return;
    const { error } = await supabase.from("school_holidays").delete().eq("id", id);
    if (error) toast.error(error.message);
    else onChange();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarDays className="mr-1.5 h-4 w-4" /> Vacances scolaires
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calendrier des vacances scolaires (partagé)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div className="sm:col-span-2 space-y-1">
              <Label>Libellé</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vacances de Noël" />
            </div>
            <div className="space-y-1">
              <Label>Début</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fin</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <Button size="sm" onClick={add} disabled={busy}>
            <Plus className="mr-1.5 h-4 w-4" /> Ajouter une période
          </Button>

          <div className="rounded-md border">
            {holidays.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">Aucune période enregistrée.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Libellé</th>
                    <th className="px-2 py-2 text-left">Du</th>
                    <th className="px-2 py-2 text-left">Au</th>
                    <th className="w-10 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="px-2 py-2">{h.label}</td>
                      <td className="px-2 py-2 font-mono text-xs">{h.start_date}</td>
                      <td className="px-2 py-2 font-mono text-xs">{h.end_date}</td>
                      <td className="px-2 py-2 text-right">
                        <Button variant="ghost" size="icon" onClick={() => remove(h.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddDutyDialog({ userId, onAdded }: { userId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("06:15");
  const [qub, setQub] = useState("");
  const [driver, setDriver] = useState("");
  const [route, setRoute] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.from("duties").insert({
      user_id: userId,
      start_time: `${start}:00`,
      qub, driver, route, vehicle,
      weekdays: start === "06:15" ? [1] : [1, 2, 3, 4, 5],
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Prise ajoutée");
      setOpen(false);
      setQub(""); setDriver(""); setRoute(""); setVehicle("");
      onAdded();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1.5 h-4 w-4" /> Ajouter</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle prise de service</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>PS</Label>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>QUB</Label>
            <Input value={qub} onChange={(e) => setQub(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Conducteur</Label>
            <Input value={driver} onChange={(e) => setDriver(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Service</Label>
            <Input value={route} onChange={(e) => setRoute(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Véhicule (immatriculation)</Label>
            <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>{busy ? "Ajout…" : "Ajouter"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDutyDialog({ duty, onSaved }: { duty: Duty; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number[]>(duty.weekdays);
  const [busy, setBusy] = useState(false);

  const toggle = (w: number) => {
    setDays((prev) => {
      const set = new Set(prev);
      if (set.has(w)) set.delete(w); else set.add(w);
      return Array.from(set).sort((a, b) => a - b);
    });
  };

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("duties").update({ weekdays: days }).eq("id", duty.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Jours de fonctionnement mis à jour");
      setOpen(false);
      onSaved();
    }
  };

  useEffect(() => { setDays(duty.weekdays); }, [duty.weekdays, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Modifier les jours</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {hm(duty.start_time)} — QUB {duty.qub} — {duty.driver}
          </div>
          <WeekdayPicker value={days} onToggle={toggle} />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
