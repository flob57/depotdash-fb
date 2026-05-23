import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Session } from "@/lib/stats";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

type Props = {
  session: Session;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
};

export function EditSessionDialog({ session, open, onOpenChange, onSaved }: Props) {
  const [bus, setBus] = useState(session.bus_reference ?? "");
  const [startAt, setStartAt] = useState(toLocalInput(session.start_at));
  const [endAt, setEndAt] = useState(toLocalInput(session.end_at));
  const [kmStart, setKmStart] = useState(session.km_start?.toString() ?? "");
  const [kmEnd, setKmEnd] = useState(session.km_end?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!startAt) {
      toast.error("Start time is required");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("driving_sessions")
      .update({
        bus_reference: bus.trim() || null,
        start_at: fromLocalInput(startAt),
        end_at: fromLocalInput(endAt),
        km_start: kmStart ? Number(kmStart) : null,
        km_end: kmEnd ? Number(kmEnd) : null,
      })
      .eq("id", session.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Driving session updated");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit driving session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bus">Vehicle</Label>
            <Input id="bus" value={bus} onChange={(e) => setBus(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Start</Label>
              <Input id="start" type="datetime-local" value={startAt}
                onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Stop</Label>
              <Input id="end" type="datetime-local" value={endAt}
                onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="km-start">km start</Label>
              <Input id="km-start" type="number" inputMode="numeric" value={kmStart}
                onChange={(e) => setKmStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="km-end">km stop</Label>
              <Input id="km-end" type="number" inputMode="numeric" value={kmEnd}
                onChange={(e) => setKmEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
