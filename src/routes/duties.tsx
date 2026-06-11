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
import { Trash2, RefreshCw, Plus, ChevronLeft, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { syncDutiesFromNotion } from "@/lib/duties.functions";

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
  const [dbId, setDbId] = useState<string>("");
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
    const [{ data: ds }, { data: settings }] = await Promise.all([
      supabase.from("duties").select("*").order("start_time", { ascending: true }),
      supabase.from("user_notion_settings").select("services_db_id").eq("user_id", userId).maybeSingle(),
    ]);
    setDuties((ds ?? []) as Duty[]);
    setDbId((settings?.services_db_id as string) ?? "");
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [userId]);

  const wd = todayWeekday();
  const today = todayKey();
  const now = nowMinutes();

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

  const handleSync = async () => {
    if (!dbId) { toast.error("Renseignez d'abord l'ID de la base Notion."); return; }
    try {
      const res = await sync({ data: { databaseId: dbId } });
      toast.success(`${res.upserted} prises synchronisées${res.skipped ? ` (${res.skipped} ignorées)` : ""}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la synchronisation");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/"><ChevronLeft className="h-4 w-4" /> Retour</Link>
            </Button>
            <h1 className="text-base font-semibold">Prises de service</h1>
          </div>
          <div className="text-xs text-muted-foreground">
            {checkedCount}/{visible.length} prises
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <NotionSyncDialog dbId={dbId} setDbId={setDbId} onSync={handleSync} />
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
          <div className="overflow-hidden rounded-md border bg-card">
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
                        <WeekdayPicker value={d.weekdays} onToggle={(w) => toggleWeekday(d, w)} />
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
  dbId, setDbId, onSync,
}: { dbId: string; setDbId: (v: string) => void; onSync: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(dbId);
  useEffect(() => setLocal(dbId), [dbId]);

  const run = async () => {
    setBusy(true);
    setDbId(local);
    await onSync();
    setBusy(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Synchroniser depuis Notion
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importer depuis Notion</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>ID ou URL de la base "Services Lestonan période scolaire"</Label>
          <Input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="https://notion.so/…" />
          <p className="text-xs text-muted-foreground">
            Colonnes attendues : PS, QUB, Driver, Route 1, Vehicle. La base doit être partagée avec l'intégration Notion.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={run} disabled={busy || !local}>
            {busy ? "Synchronisation…" : "Lancer la synchronisation"}
          </Button>
        </DialogFooter>
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
