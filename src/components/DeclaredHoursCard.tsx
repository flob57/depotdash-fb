import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClipboardList, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { dateKey } from "@/lib/stats";
import { parseHoursInput, formatMinutes, type DeclaredHour } from "@/lib/declared";

type Props = {
  userId: string;
  declared: DeclaredHour[];
  onChanged: () => void;
};

export function DeclaredHoursCard({ userId, declared, onChanged }: Props) {
  const [date, setDate] = useState(dateKey(new Date()));
  const [hours, setHours] = useState("7:30");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const minutes = parseHoursInput(hours);
    if (minutes == null) { toast.error("Invalid hours format. Use 7.5 or 7:30"); return; }
    if (!date) { toast.error("Pick a date"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("declared_hours")
      .upsert({ user_id: userId, work_date: date, minutes, note: note.trim() || null }, { onConflict: "user_id,work_date" });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Hours declared");
      setNote("");
      onChanged();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("declared_hours").delete().eq("id", id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Removed"); onChanged(); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-4 w-4" /> Declared hours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
          <div className="space-y-1">
            <Label htmlFor="dhDate" className="text-xs">Date</Label>
            <Input id="dhDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dhHours" className="text-xs">Hours (e.g. 7:30 or 7.5)</Label>
            <Input id="dhHours" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="7:30" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dhNote" className="text-xs">Note (optional)</Label>
            <Input id="dhNote" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={save} disabled={busy} className="w-full sm:w-auto">
              <Plus className="mr-1.5 h-4 w-4" /> Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Saving the same date overwrites the previous declaration.
        </p>

        {declared.length > 0 && (
          <ul className="divide-y rounded-md border">
            {declared.slice(0, 20).map((d) => (
              <li key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{format(parseISO(d.work_date), "EEE dd MMM yyyy")}</span>
                  <span className="ml-2 font-mono">{formatMinutes(d.minutes)}</span>
                  {d.note && <span className="ml-2 text-muted-foreground">· {d.note}</span>}
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(d.id)}>
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
