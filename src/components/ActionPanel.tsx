import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LogIn, LogOut, Play, Square, Gauge, Clock } from "lucide-react";
import type { Shift, Session } from "@/lib/stats";
import { formatHm } from "@/lib/stats";

type Props = {
  userId: string;
  activeShift: Shift | null;
  activeSession: Session | null;
  onChange: () => void;
};

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ActionPanel({ userId, activeShift, activeSession, onChange }: Props) {
  const [kmDialog, setKmDialog] = useState<"start" | "stop" | null>(null);
  const [km, setKm] = useState("");
  const [busRef, setBusRef] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const goOnDuty = async () => {
    setBusy(true);
    const { error } = await supabase.from("shifts").insert({ user_id: userId });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("On duty"); onChange(); }
  };

  const goOffDuty = async () => {
    if (!activeShift) return;
    if (activeSession) {
      toast.error("Stop driving before going off duty");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("shifts")
      .update({ off_duty_at: new Date().toISOString() })
      .eq("id", activeShift.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Off duty"); onChange(); }
  };

  const openStart = () => { setKm(""); setBusRef(""); setKmDialog("start"); };
  const openStop = () => { setKm(""); setKmDialog("stop"); };

  const confirmStart = async () => {
    if (!activeShift) { toast.error("Go on duty first"); return; }
    const value = km === "" ? null : Number(km);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Enter a valid kilometer reading");
      return;
    }
    const ref = busRef.trim();
    setBusy(true);
    const { error } = await supabase.from("driving_sessions").insert({
      user_id: userId,
      shift_id: activeShift.id,
      km_start: value,
      bus_reference: ref === "" ? null : ref,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Driving started"); setKmDialog(null); onChange(); }
  };

  const confirmStop = async () => {
    if (!activeSession) return;
    const value = km === "" ? null : Number(km);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Enter a valid kilometer reading");
      return;
    }
    if (value != null && activeSession.km_start != null && value < activeSession.km_start) {
      toast.error("End km must be ≥ start km");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("driving_sessions")
      .update({ end_at: new Date().toISOString(), km_end: value })
      .eq("id", activeSession.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Driving stopped"); setKmDialog(null); onChange(); }
  };

  const shiftMs = activeShift ? now - new Date(activeShift.on_duty_at).getTime() : 0;
  const driveMs = activeSession ? now - new Date(activeSession.start_at).getTime() : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Today's activity</span>
          {activeShift && (
            <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              On duty
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeShift && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-secondary/40 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> On duty
              </div>
              <div className="mt-1 font-mono text-xl font-semibold">{formatHm(shiftMs)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${activeSession ? "bg-primary/10 border-primary/30" : "bg-secondary/40"}`}>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" /> Driving
              </div>
              <div className="mt-1 font-mono text-xl font-semibold">
                {activeSession ? formatHm(driveMs) : "—"}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!activeShift ? (
            <Button onClick={goOnDuty} disabled={busy} size="lg" className="col-span-2">
              <LogIn className="mr-2 h-4 w-4" /> Go on duty
            </Button>
          ) : (
            <>
              {!activeSession ? (
                <Button onClick={openStart} disabled={busy} size="lg" className="col-span-2">
                  <Play className="mr-2 h-4 w-4" /> Start driving
                </Button>
              ) : (
                <Button onClick={openStop} disabled={busy} size="lg" variant="default" className="col-span-2">
                  <Square className="mr-2 h-4 w-4" /> Stop driving
                </Button>
              )}
              <Button onClick={goOffDuty} disabled={busy || !!activeSession} size="lg"
                variant="outline" className="col-span-2">
                <LogOut className="mr-2 h-4 w-4" /> Go off duty
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={kmDialog !== null} onOpenChange={(o) => !o && setKmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {kmDialog === "start" ? "Vehicle kilometers at start" : "Vehicle kilometers at stop"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="km">Odometer reading (km)</Label>
            <Input id="km" type="number" min={0} inputMode="numeric"
              autoFocus value={km} onChange={(e) => setKm(e.target.value)}
              placeholder={kmDialog === "stop" && activeSession?.km_start != null
                ? `≥ ${activeSession.km_start}` : "e.g. 123456"} />
            <p className="text-xs text-muted-foreground">Leave empty to skip.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKmDialog(null)}>Cancel</Button>
            <Button onClick={kmDialog === "start" ? confirmStart : confirmStop} disabled={busy}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
