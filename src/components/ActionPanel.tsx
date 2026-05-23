import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { listVehiclesFromNotion } from "@/lib/notion.functions";
import { NotionSettingsDialog } from "@/components/NotionSettingsDialog";
import { toast } from "sonner";
import { LogIn, LogOut, Play, Square, Gauge, Clock, Settings, RefreshCw, Cloud } from "lucide-react";
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

const VEHICLES_DB_KEY = "notion.vehiclesDbId";
const MANUAL = "__manual__";

export function ActionPanel({ userId, activeShift, activeSession, onChange }: Props) {
  const [kmDialog, setKmDialog] = useState<"start" | "stop" | null>(null);
  const [km, setKm] = useState("");
  const [busRef, setBusRef] = useState("");
  const [busy, setBusy] = useState(false);
  const now = useNow();

  // Vehicles
  const fetchVehicles = useServerFn(listVehiclesFromNotion);
  const [vehiclesDbId, setVehiclesDbId] = useState<string>("");
  const [vehicles, setVehicles] = useState<{ id: string; name: string }[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInput, setSettingsInput] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(VEHICLES_DB_KEY) ?? "";
    setVehiclesDbId(saved);
    setSettingsInput(saved);
  }, []);

  const loadVehicles = async (dbId: string) => {
    if (!dbId) {
      setVehicles([]);
      return;
    }
    setVehiclesLoading(true);
    try {
      const res = await fetchVehicles({ data: { databaseId: dbId } });
      if ("error" in res && res.error) {
        toast.error(res.error);
        setVehicles([]);
        return;
      }
      setVehicles(res.vehicles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load vehicles");
      setVehicles([]);
    } finally {
      setVehiclesLoading(false);
    }
  };

  // Load when dialog opens or DB id changes
  useEffect(() => {
    if (kmDialog === "start" && vehiclesDbId && vehicles.length === 0 && !vehiclesLoading) {
      void loadVehicles(vehiclesDbId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmDialog, vehiclesDbId]);

  const saveSettings = async () => {
    const trimmed = settingsInput.trim();
    localStorage.setItem(VEHICLES_DB_KEY, trimmed);
    setVehiclesDbId(trimmed);
    setVehicles([]);
    setSettingsOpen(false);
    if (trimmed) {
      await loadVehicles(trimmed);
      toast.success("Vehicles list connected");
    }
  };

  const goOnDuty = async () => {
    setBusy(true);
    const { error } = await supabase.from("shifts").insert({ user_id: userId });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("On duty");
      onChange();
    }
  };

  const goOffDuty = async () => {
    if (!activeShift) return;
    if (activeSession) {
      toast.error("Stop driving before going off duty");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("shifts")
      .update({ off_duty_at: new Date().toISOString() })
      .eq("id", activeShift.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Off duty");
      onChange();
    }
  };

  const openStart = () => {
    setKm("");
    setBusRef("");
    setKmDialog("start");
  };
  const openStop = () => {
    setKm("");
    setKmDialog("stop");
  };

  const confirmStart = async () => {
    if (!activeShift) {
      toast.error("Go on duty first");
      return;
    }
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
    else {
      toast.success("Driving started");
      setKmDialog(null);
      onChange();
    }
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
    const { error } = await supabase
      .from("driving_sessions")
      .update({ end_at: new Date().toISOString(), km_end: value })
      .eq("id", activeSession.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Driving stopped");
      setKmDialog(null);
      onChange();
    }
  };

  const shiftMs = activeShift ? now - new Date(activeShift.on_duty_at).getTime() : 0;
  const driveMs = activeSession ? now - new Date(activeSession.start_at).getTime() : 0;

  const hasVehiclesDb = !!vehiclesDbId;
  const usingManual = !hasVehiclesDb || busRef === MANUAL;

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
            <div
              className={`rounded-lg border p-3 ${activeSession ? "bg-primary/10 border-primary/30" : "bg-secondary/40"}`}
            >
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
                <Button
                  onClick={openStop}
                  disabled={busy}
                  size="lg"
                  variant="default"
                  className="col-span-2"
                >
                  <Square className="mr-2 h-4 w-4" /> Stop driving
                </Button>
              )}
              <Button
                onClick={goOffDuty}
                disabled={busy || !!activeSession}
                size="lg"
                variant="outline"
                className="col-span-2"
              >
                <LogOut className="mr-2 h-4 w-4" /> Go off duty
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={kmDialog !== null} onOpenChange={(o) => !o && setKmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{kmDialog === "start" ? "Start driving" : "Stop driving"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {kmDialog === "start" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="busRef">Vehicle</Label>
                  <div className="flex items-center gap-1">
                    {hasVehiclesDb && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => loadVehicles(vehiclesDbId)}
                        disabled={vehiclesLoading}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${vehiclesLoading ? "animate-spin" : ""}`}
                        />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {hasVehiclesDb && (
                  <Select
                    value={vehicles.some((v) => v.name === busRef) ? busRef : busRef ? MANUAL : ""}
                    onValueChange={(v) => {
                      if (v === MANUAL) setBusRef("");
                      else setBusRef(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={vehiclesLoading ? "Loading vehicles…" : "Select a vehicle"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.name}>
                          {v.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={MANUAL}>Type manually…</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {usingManual && (
                  <Input
                    id="busRef"
                    autoFocus={!hasVehiclesDb}
                    value={busRef === MANUAL ? "" : busRef}
                    onChange={(e) => setBusRef(e.target.value)}
                    placeholder="e.g. 1234 or AB-12-CD"
                  />
                )}

                {!hasVehiclesDb && (
                  <p className="text-xs text-muted-foreground">
                    Tip: click the gear to link your Notion vehicles database and pick from a list.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="km">Odometer reading (km)</Label>
              <Input
                id="km"
                type="number"
                min={0}
                inputMode="numeric"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                placeholder={
                  kmDialog === "stop" && activeSession?.km_start != null
                    ? `≥ ${activeSession.km_start}`
                    : "e.g. 123456"
                }
              />
              <p className="text-xs text-muted-foreground">Leave empty to skip.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKmDialog(null)}>
              Cancel
            </Button>
            <Button onClick={kmDialog === "start" ? confirmStart : confirmStop} disabled={busy}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vehicles list from Notion</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="vehiclesDb">Notion database link or ID</Label>
              <Input
                id="vehiclesDb"
                value={settingsInput}
                onChange={(e) => setSettingsInput(e.target.value)}
                placeholder="https://www.notion.so/…"
              />
              <p className="text-xs text-muted-foreground">
                Each page in the database becomes a selectable vehicle (its title is used as the
                reference). Make sure the database is shared with the Lovable Notion integration.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
