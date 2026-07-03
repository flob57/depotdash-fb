import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { getNotionSettings, saveNotionSettings, runAutoExportNow } from "@/lib/notion.functions";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
};

export function NotionSettingsDialog({ open, onOpenChange }: Props) {
  const fetchSettings = useServerFn(getNotionSettings);
  const saveSettings = useServerFn(saveNotionSettings);
  const runNow = useServerFn(runAutoExportNow);

  const [shifts, setShifts] = useState("");
  const [sessions, setSessions] = useState("");
  const [totals, setTotals] = useState("");
  const [distance, setDistance] = useState("");
  const [fuel, setFuel] = useState("");
  const [weeklyTasks, setWeeklyTasks] = useState("");
  const [parking, setParking] = useState("");

  const [timezone, setTimezone] = useState("Europe/Brussels");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSettings()
      .then((s) => {
        setShifts(s.shifts_db_id ?? "");
        setSessions(s.sessions_db_id ?? "");
        setTotals(s.daily_totals_db_id ?? "");
        setDistance(s.distance_summary_db_id ?? "");
        setFuel(s.fuel_fillups_db_id ?? "");
        setWeeklyTasks((s as { weekly_tasks_db_id?: string | null }).weekly_tasks_db_id ?? "");
        setParking((s as { parking_db_id?: string | null }).parking_db_id ?? "");
        setTimezone(s.timezone ?? "Europe/Brussels");

      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [open, fetchSettings]);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({
        data: {
          shifts_db_id: shifts.trim() || null,
          sessions_db_id: sessions.trim() || null,
          daily_totals_db_id: totals.trim() || null,
          distance_summary_db_id: distance.trim() || null,
          fuel_fillups_db_id: fuel.trim() || null,
          weekly_tasks_db_id: weeklyTasks.trim() || null,
          parking_db_id: parking.trim() || null,
          timezone: timezone.trim() || "Europe/Brussels",

        },
      });
      toast.success("Auto-export settings saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Automatic Notion export</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Paste the Notion database link or ID for each target. Every night at 23:59 in your
            timezone, today's records are exported automatically. Make sure each database is shared
            with the Lovable Notion integration.
          </p>

          <div className="space-y-2">
            <Label htmlFor="shiftsDb">On-duty sessions database</Label>
            <Input
              id="shiftsDb"
              value={shifts}
              onChange={(e) => setShifts(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sessionsDb">Driving sessions database</Label>
            <Input
              id="sessionsDb"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="totalsDb">Daily totals database</Label>
            <Input
              id="totalsDb"
              value={totals}
              onChange={(e) => setTotals(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="distanceDb">Distance summary database</Label>
            <Input
              id="distanceDb"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Receives one row each Sunday (This week), each last day of the month (This month),
              and each Dec 31 (This year). Expected columns: a title, "Period" (text), "Total km"
              (number), optional "Date" (date).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fuelDb">Fuel fill-ups database</Label>
            <Input
              id="fuelDb"
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Expected columns: a title, "Vehicle" (text), "Date" (date), "km" (number),
              "Liters" (number), optional "Consumption (L/100km)" (number).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="weeklyTasksDb">Weekly recurring tasks database</Label>
            <Input
              id="weeklyTasksDb"
              value={weeklyTasks}
              onChange={(e) => setWeeklyTasks(e.target.value)}
              placeholder="https://www.notion.so/…"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Expected columns: a title (task name), a "Jour"/"Day" property (select, multi-select
              or status) with weekday names, and a Date property (e.g. "Last completed") that gets
              stamped with today's date when you check a task.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tz">Timezone</Label>
            <Input
              id="tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Europe/Brussels"
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              IANA timezone — controls when 23:59 (your local time) triggers the export.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Duration columns: rename your old "Duration (min)" property to <strong>Duration</strong>
            {" "}and change its type to <strong>Text</strong> to get values like <code>7h30</code>.
            If left as a number, minutes are still written for backwards compatibility.
          </p>
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={async () => {
              setTesting(true);
              try {
                const r = await runNow();
                const parts: string[] = [];
                for (const [k, v] of Object.entries(r)) {
                  if (!v) continue;
                  parts.push(`${k}: ${v.exported}/${v.total}${v.errors.length ? ` (${v.errors[0]})` : ""}`);
                }
                toast.success(`Test export done — ${parts.join(" · ") || "nothing to export"}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Test export failed");
              } finally {
                setTesting(false);
              }
            }}
            disabled={testing || saving || loading}
          >
            {testing ? "Testing…" : "Test now"}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
