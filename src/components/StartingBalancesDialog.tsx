import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseHoursInput } from "@/lib/declared";
import { dateKey } from "@/lib/stats";
import type { BalanceSettings } from "@/hooks/useTrackingData";

type Props = {
  userId: string;
  current: BalanceSettings | null;
  onSaved: () => void;
};

export function StartingBalancesDialog({ userId, current, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [overtimeStr, setOvertimeStr] = useState("");
  const [cpN1, setCpN1] = useState("");
  const [cpN, setCpN] = useState("");
  const [asOf, setAsOf] = useState(dateKey(new Date()));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const mins = current?.starting_overtime_minutes ?? 0;
      const sign = mins < 0 ? "-" : "";
      const a = Math.abs(mins);
      setOvertimeStr(current ? `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}` : "0:00");
      setCpN1(String(current?.starting_cp_n_minus_1 ?? 0));
      setCpN(String(current?.starting_cp_n ?? 0));
      setAsOf(current?.starting_balance_date ?? dateKey(new Date()));
    }
  }, [open, current]);

  const save = async () => {
    // Parse signed hours
    const neg = overtimeStr.trim().startsWith("-");
    const parsed = parseHoursInput(overtimeStr.replace(/^-/, ""));
    if (parsed == null) { toast.error("Invalid overtime format. Use 7:30 or 7.5 (can be negative)"); return; }
    const minutes = neg ? -parsed : parsed;
    const n1 = Number(cpN1); const n = Number(cpN);
    if (isNaN(n1) || isNaN(n) || n1 < 0 || n < 0) { toast.error("CP balances must be non-negative numbers"); return; }
    setBusy(true);
    const { error } = await supabase.from("user_balance_settings").upsert({
      user_id: userId,
      starting_overtime_minutes: minutes,
      starting_cp_n_minus_1: n1,
      starting_cp_n: n,
      starting_balance_date: asOf,
    }, { onConflict: "user_id" });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Starting balances saved"); setOpen(false); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1.5 h-4 w-4" /> Starting balances
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Starting balances</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="asOf" className="text-xs">As of date</Label>
            <Input id="asOf" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <p className="text-xs text-muted-foreground">Counters are computed from this date forward.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ot" className="text-xs">Overtime balance (e.g. 12:30 or -3:00)</Label>
            <Input id="ot" value={overtimeStr} onChange={(e) => setOvertimeStr(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cpN1" className="text-xs">CP N-1 (days)</Label>
              <Input id="cpN1" type="number" step="0.5" min="0" value={cpN1} onChange={(e) => setCpN1(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cpN" className="text-xs">CP N (days)</Label>
              <Input id="cpN" type="number" step="0.5" min="0" value={cpN} onChange={(e) => setCpN(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
