import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ChevronLeft, RefreshCw, Settings2, CalendarRange, ChevronRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  getTodayRoutes, getSaeSettings, saveSaeSettings, createSaeNotionDatabase,
} from "@/lib/sae.functions";
import busIcon from "@/assets/bus-icon.png.asset.json";

export const Route = createFileRoute("/sae/")({
  component: SaePage,
  head: () => ({ meta: [{ title: "SAE — Mes tournées du jour" }] }),
});

type Route = Awaited<ReturnType<typeof getTodayRoutes>>["routes"][number];

function SaePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const fetchRoutes = useServerFn(getTodayRoutes);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [date, setDate] = useState<string>("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [loading, user, navigate]);

  const load = async () => {
    setBusy(true);
    try {
      const res = await fetchRoutes({ data: {} });
      setRoutes(res.routes);
      setDate(res.date);
      setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster />
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="px-2">
              <Link to="/"><ChevronLeft className="h-4 w-4" /></Link>
            </Button>
            <img src={busIcon.url} alt="" className="h-7 w-7" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">SAE — Mes tournées</h1>
              <p className="truncate text-[11px] text-muted-foreground">{date || "Aujourd'hui"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="px-2" title="Historique">
              <Link to="/sae/history"><CalendarRange className="h-4 w-4" /></Link>
            </Button>
            <Button variant="ghost" size="sm" className="px-2" onClick={load} title="Rafraîchir">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            </Button>
            <SettingsDialog onSaved={load} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 py-4 sm:px-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {busy && routes.length === 0 && (
          <div className="text-sm text-muted-foreground">Chargement des tournées…</div>
        )}
        {!busy && routes.length === 0 && !error && (
          <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
            Aucune tournée trouvée pour aujourd'hui dans la base "Mon planning".
            Vérifiez la propriété <code className="rounded bg-muted px-1">Date</code>.
          </div>
        )}
        {routes.map((r) => (
          <Link
            key={r.id}
            to="/sae/$routeId"
            params={{ routeId: r.id }}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-semibold">{r.lineName}</span>
                {r.serviceName && (
                  <span className="truncate text-xs text-muted-foreground">{r.serviceName}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{r.depTime ?? "—"}</span>{" "}
                <span className="truncate">{r.depStop ?? ""}</span>
                <span className="mx-1.5">→</span>
                <span className="font-mono">{r.arrTime ?? "—"}</span>{" "}
                <span className="truncate">{r.arrStop ?? ""}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {r.stops.length} arrêt{r.stops.length > 1 ? "s" : ""}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </main>
    </div>
  );
}

function SettingsDialog({ onSaved }: { onSaved: () => void }) {
  const get = useServerFn(getSaeSettings);
  const save = useServerFn(saveSaeSettings);
  const create = useServerFn(createSaeNotionDatabase);
  const [open, setOpen] = useState(false);
  const [planning, setPlanning] = useState("");
  const [actualDb, setActualDb] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    get().then((s) => {
      setPlanning(s.planning_db_id ?? "");
      setActualDb(s.actual_times_db_id ?? "");
      setParent(s.actual_times_parent_page_id ?? "");
    });
  }, [open, get]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          planning_db_id: planning.trim() || null,
          actual_times_db_id: actualDb.trim() || null,
          actual_times_parent_page_id: parent.trim() || null,
        },
      });
      toast.success("Paramètres SAE enregistrés");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const r = await create();
      setActualDb(r.databaseId);
      toast.success("Base 'Mes horaires réel' créée dans Notion");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="px-2" title="Paramètres SAE">
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres SAE</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="planning">Base "Mon planning" (URL ou ID)</Label>
            <Input id="planning" value={planning} onChange={(e) => setPlanning(e.target.value)} placeholder="Optionnel — valeur par défaut utilisée si vide" />
          </div>
          <div>
            <Label htmlFor="actual">Base "Mes horaires réel" (URL ou ID)</Label>
            <Input id="actual" value={actualDb} onChange={(e) => setActualDb(e.target.value)} placeholder="Laissez vide si vous voulez la créer ci-dessous" />
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <Label htmlFor="parent">Page parente Notion (pour création auto)</Label>
            <Input id="parent" value={parent} onChange={(e) => setParent(e.target.value)} placeholder="URL ou ID d'une page Notion" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={busy || !parent.trim()}
              onClick={handleCreate}
            >
              Créer la base "Mes horaires réel" dans Notion
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={busy}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
