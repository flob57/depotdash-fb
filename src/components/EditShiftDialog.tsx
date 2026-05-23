import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Shift } from "@/lib/stats";

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
  shift: Shift;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
};

export function EditShiftDialog({ shift, open, onOpenChange, onSaved }: Props) {
  const [onDuty, setOnDuty] = useState(toLocalInput(shift.on_duty_at));
  const [offDuty, setOffDuty] = useState(toLocalInput(shift.off_duty_at));
  const [note, setNote] = useState(shift.note ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!onDuty) {
      toast.error("On-duty time is required");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("shifts")
      .update({
        on_duty_at: fromLocalInput(onDuty),
        off_duty_at: fromLocalInput(offDuty),
        note: note.trim() || null,
      })
      .eq("id", shift.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("On-duty session updated");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit on-duty session</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="on-duty">On duty</Label>
            <Input id="on-duty" type="datetime-local" value={onDuty}
              onChange={(e) => setOnDuty(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="off-duty">Off duty</Label>
            <Input id="off-duty" type="datetime-local" value={offDuty}
              onChange={(e) => setOffDuty(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave empty if still on duty.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
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
