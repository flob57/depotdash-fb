import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CalendarDays, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { dateKey } from "@/lib/stats";
import type { PublicHoliday as PH } from "@/hooks/useTrackingData";

type Props = {
  userId: string;
  holidays: PH[];
  onChanged: () => void;
};

export function PublicHolidaysCard({ userId, holidays, onChanged }: Props) {
  const todayKey = dateKey(new Date());
  const todayHoliday = useMemo(
    () => holidays.find((h) => h.holiday_date === todayKey) ?? null,
    [holidays, todayKey],
  );
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const toggleToday = async (on: boolean) => {
    setBusy(true);
    if (on) {
      const { error } = await supabase
        .from("public_holidays")
        .insert({ user_id: userId, holiday_date: todayKey, label: "Today" });
      if (error) toast.error(error.message);
      else toast.success("Today marked as public holiday");
    } else if (todayHoliday) {
      const { error } = await supabase
        .from("public_holidays")
        .delete()
        .eq("id", todayHoliday.id);
      if (error) toast.error(error.message);
      else toast.success("Holiday removed");
    }
    setBusy(false);
    onChanged();
  };

  const addHoliday = async () => {
    if (!newDate) {
      toast.error("Pick a date");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("public_holidays")
      .insert({ user_id: userId, holiday_date: newDate, label: newLabel.trim() || null });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Public holiday added");
      setNewDate("");
      setNewLabel("");
      onChanged();
    }
  };

  const removeHoliday = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("public_holidays").delete().eq("id", id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Holiday removed");
      onChanged();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4" /> Public holidays
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-secondary/40 p-3">
          <div>
            <div className="text-sm font-medium">Today is a public holiday</div>
            <div className="text-xs text-muted-foreground">
              No expected hours, no deficit counted.
            </div>
          </div>
          <Switch
            checked={!!todayHoliday}
            disabled={busy}
            onCheckedChange={toggleToday}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="phDate" className="text-xs">Date</Label>
            <Input id="phDate" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phLabel" className="text-xs">Label (optional)</Label>
            <Input id="phLabel" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Easter Monday" />
          </div>
          <div className="flex items-end">
            <Button onClick={addHoliday} disabled={busy} className="w-full sm:w-auto">
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {holidays.length > 0 && (
          <ul className="divide-y rounded-md border">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{format(parseISO(h.holiday_date), "EEE dd MMM yyyy")}</span>
                  {h.label && <span className="ml-2 text-muted-foreground">· {h.label}</span>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => removeHoliday(h.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
