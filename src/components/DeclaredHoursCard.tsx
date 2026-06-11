import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClipboardList, Trash2, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parseISO, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear, addWeeks } from "date-fns";
import { dateKey } from "@/lib/stats";
import { formatMinutes, type DeclaredHour } from "@/lib/declared";
import { isHoliday, type SchoolHoliday } from "@/lib/school-context";

type Props = {
  userId: string;
  declared: DeclaredHour[];
  schoolHolidays?: SchoolHoliday[];
  onChanged: () => void;
};

type Defaults = { mStart: string; mEnd: string; eStart: string; eEnd: string };

// School term (default):
//   Mon(1), Tue(2), Thu(4), Fri(5): 06:15–10:30 + 15:00–18:15
//   Wed(3): 06:15–13:45 (no evening)
//   Weekend: empty
// School holidays:
//   Mon–Fri: 06:30–10:30 + 14:30–18:00
//   Weekend: empty
function defaultsForDate(d: Date, holidays: SchoolHoliday[] = []): Defaults {
  const dow = d.getDay();
  const holiday = isHoliday(d, holidays);
  if (holiday) {
    if (dow >= 1 && dow <= 5) return { mStart: "06:30", mEnd: "10:30", eStart: "14:30", eEnd: "18:00" };
    return { mStart: "", mEnd: "", eStart: "", eEnd: "" };
  }
  if (dow === 3) return { mStart: "06:15", mEnd: "13:45", eStart: "", eEnd: "" };
  if (dow === 1 || dow === 2 || dow === 4 || dow === 5) {
    return { mStart: "06:15", mEnd: "10:30", eStart: "15:00", eEnd: "18:15" };
  }
  return { mStart: "", mEnd: "", eStart: "", eEnd: "" };
}

function toMin(t: string): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function rangeMinutes(start: string, end: string): { ok: boolean; minutes: number; empty: boolean } {
  if (!start && !end) return { ok: true, minutes: 0, empty: true };
  const a = toMin(start), b = toMin(end);
  if (a == null || b == null) return { ok: false, minutes: 0, empty: false };
  if (b < a) return { ok: false, minutes: 0, empty: false };
  return { ok: true, minutes: b - a, empty: false };
}

export function DeclaredHoursCard({ userId, declared, onChanged }: Props) {
  const [date, setDate] = useState(dateKey(new Date()));
  const initial = useMemo(() => defaultsForDate(parseISO(date)), [date]);
  const [mStart, setMStart] = useState(initial.mStart);
  const [mEnd, setMEnd] = useState(initial.mEnd);
  const [eStart, setEStart] = useState(initial.eStart);
  const [eEnd, setEEnd] = useState(initial.eEnd);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [weekKey, setWeekKey] = useState(() => {
    const t = new Date();
    return `${getISOWeekYear(t)}-W${String(getISOWeek(t)).padStart(2, "0")}`;
  });

  const onDateChange = (v: string) => {
    setDate(v);
    if (v) {
      const d = defaultsForDate(parseISO(v));
      setMStart(d.mStart); setMEnd(d.mEnd); setEStart(d.eStart); setEEnd(d.eEnd);
    }
  };

  const morning = rangeMinutes(mStart, mEnd);
  const evening = rangeMinutes(eStart, eEnd);
  const totalMin = morning.minutes + evening.minutes;
  const valid = morning.ok && evening.ok && totalMin > 0;

  const save = async () => {
    if (!date) { toast.error("Pick a date"); return; }
    if (!morning.ok) { toast.error("Invalid morning range"); return; }
    if (!evening.ok) { toast.error("Invalid evening range"); return; }
    if (totalMin <= 0) { toast.error("Enter at least one time range"); return; }

    const parts = [
      morning.empty ? null : `AM ${mStart}–${mEnd}`,
      evening.empty ? null : `PM ${eStart}–${eEnd}`,
    ].filter(Boolean).join(" · ");
    const fullNote = [parts, note.trim()].filter(Boolean).join(" — ");

    setBusy(true);
    const { error } = await supabase
      .from("declared_hours")
      .upsert({ user_id: userId, work_date: date, minutes: totalMin, note: fullNote || null }, { onConflict: "user_id,work_date" });
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
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="dhDate" className="text-xs">Date</Label>
            <Input id="dhDate" type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Morning</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="mStart" className="text-xs">Start</Label>
                <Input id="mStart" type="time" value={mStart} onChange={(e) => setMStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mEnd" className="text-xs">End</Label>
                <Input id="mEnd" type="time" value={mEnd} onChange={(e) => setMEnd(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Afternoon / Evening</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="eStart" className="text-xs">Start</Label>
                <Input id="eStart" type="time" value={eStart} onChange={(e) => setEStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="eEnd" className="text-xs">End</Label>
                <Input id="eEnd" type="time" value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="dhNote" className="text-xs">Note (optional)</Label>
            <Input id="dhNote" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              Total: <span className="font-mono font-medium">{formatMinutes(totalMin)}</span>
            </div>
            <Button onClick={save} disabled={busy || !valid}>
              <Plus className="mr-1.5 h-4 w-4" /> Save
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Saving the same date overwrites the previous declaration. Leave a range empty to skip it.
        </p>

        {(() => {
          const today = new Date();
          const currentKey = `${getISOWeekYear(today)}-W${String(getISOWeek(today)).padStart(2, "0")}`;
          const [selectedWeek, setSelectedWeek] = [weekKey, setWeekKey];
          const weeks = Array.from(new Set([currentKey, ...declared.map((d) => {
            const dt = parseISO(d.work_date);
            return `${getISOWeekYear(dt)}-W${String(getISOWeek(dt)).padStart(2, "0")}`;
          })])).sort().reverse();
          const [yStr, wStr] = selectedWeek.split("-W");
          // Compute week start/end from ISO week using jan 4 trick
          const jan4 = new Date(parseInt(yStr, 10), 0, 4);
          const weekStart = startOfISOWeek(addWeeks(jan4, parseInt(wStr, 10) - 1));
          const weekEnd = endOfISOWeek(weekStart);
          const filtered = declared.filter((d) => {
            const dt = parseISO(d.work_date);
            return dt >= weekStart && dt <= weekEnd;
          });
          const weekTotal = filtered.reduce((a, d) => a + d.minutes, 0);
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Week</Label>
                <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                  <SelectTrigger className="h-8 w-auto min-w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weeks.map((w) => {
                      const [wy, ww] = w.split("-W");
                      const ws = startOfISOWeek(addWeeks(new Date(parseInt(wy, 10), 0, 4), parseInt(ww, 10) - 1));
                      const we = endOfISOWeek(ws);
                      const isCur = w === currentKey;
                      return (
                        <SelectItem key={w} value={w}>
                          Week {ww} · {format(ws, "dd MMM")} – {format(we, "dd MMM yyyy")}{isCur ? " (current)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {filtered.length > 0 ? (
                <>
                  <ul className="divide-y rounded-md border">
                    {filtered.map((d) => (
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
                  <div className="text-right text-xs text-muted-foreground">
                    Week total: <span className="font-mono">{formatMinutes(weekTotal)}</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No declared hours for this week.</p>
              )}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
