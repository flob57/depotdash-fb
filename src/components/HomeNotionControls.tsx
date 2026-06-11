import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { RefreshCw, CalendarDays, Plus, Trash2 } from "lucide-react";
import { syncDutiesFromNotion } from "@/lib/duties.functions";
import { pickSlot, isHoliday, SLOT_LABELS, type ServiceSlot, type SchoolHoliday } from "@/lib/school-context";

type Props = {
  userId: string;
  schoolHolidays: SchoolHoliday[];
  onHolidaysChanged: () => void;
};

export function HomeNotionControls({ userId, schoolHolidays, onHolidaysChanged }: Props) {
  const [dbIds, setDbIds] = useState<Record<ServiceSlot, string>>({ weekday: "", wed: "", sat_hol: "" });
  const [busy, setBusy] = useState(false);
  const sync = useServerFn(syncDutiesFromNotion);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("user_notion_settings")
        .select("services_db_id, services_db_id_wed, services_db_id_sat_hol")
        .eq("user_id", userId)
        .maybeSingle();
      setDbIds({
        weekday: (data?.services_db_id as string) ?? "",
        wed: (data?.services_db_id_wed as string) ?? "",
        sat_hol: (data?.services_db_id_sat_hol as string) ?? "",
      });
    })();
  }, [userId]);

  const activeSlot = useMemo(() => pickSlot(new Date(), schoolHolidays), [schoolHolidays]);
  const inHoliday = useMemo(() => isHoliday(new Date(), schoolHolidays), [schoolHolidays]);

  const handleSync = async () => {
    const target = dbIds[activeSlot];
    if (!target) {
      toast.error(`Aucune base Notion configurée pour aujourd'hui (${SLOT_LABELS[activeSlot]}).`);
      return;
    }
    setBusy(true);
    try {
      const res = await sync({ data: { databaseId: target } });
      toast.success(`${res.upserted} prises synchronisées depuis « ${SLOT_LABELS[activeSlot]} ».`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la synchronisation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleSync} disabled={busy}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> {busy ? "Synchronisation…" : "Synchroniser depuis Notion"}
        </Button>
        <SchoolHolidaysDialog holidays={schoolHolidays} onChange={onHolidaysChanged} />
        <span
          className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${
            inHoliday ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary/15 text-primary"
          }`}
        >
          {inHoliday ? "Vacances scolaires" : "Période scolaire"} · {SLOT_LABELS[activeSlot]}
        </span>
      </div>
    </section>
  );
}

function SchoolHolidaysDialog({ holidays, onChange }: { holidays: SchoolHoliday[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!label.trim() || !start || !end) { toast.error("Renseignez le libellé et les deux dates."); return; }
    if (end < start) { toast.error("La date de fin doit être après la date de début."); return; }
    setBusy(true);
    const { error } = await supabase.from("school_holidays").insert({
      label: label.trim(), start_date: start, end_date: end,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { setLabel(""); setStart(""); setEnd(""); onChange(); toast.success("Période ajoutée"); }
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
