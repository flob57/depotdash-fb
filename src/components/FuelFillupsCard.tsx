import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Fuel } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import type { FuelFillup } from "@/lib/fuel";

type Props = { fillups: FuelFillup[]; onChanged: () => void };

export function FuelFillupsCard({ fillups, onChanged }: Props) {
  const [editing, setEditing] = useState<FuelFillup | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bus, setBus] = useState("");
  const [km, setKm] = useState("");
  const [liters, setLiters] = useState("");
  const [filledAt, setFilledAt] = useState("");
  const [busy, setBusy] = useState(false);

  const openEdit = (f: FuelFillup) => {
    setEditing(f);
    setBus(f.bus_reference);
    setKm(String(f.km_at_fillup));
    setLiters(String(f.liters));
    setFilledAt(format(new Date(f.filled_at), "yyyy-MM-dd'T'HH:mm"));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const kmVal = Number(km);
    const litersVal = Number(liters);
    if (!bus.trim() || !Number.isFinite(kmVal) || !Number.isFinite(litersVal)) {
      toast.error("Invalid values");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("fuel_fillups").update({
      bus_reference: bus.trim(),
      km_at_fillup: Math.round(kmVal),
      liters: litersVal,
      filled_at: new Date(filledAt).toISOString(),
    }).eq("id", editing.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Fill-up updated");
    setEditing(null);
    onChanged();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setBusy(true);
    const { error } = await supabase.from("fuel_fillups").delete().eq("id", deleteId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Fill-up deleted");
    setDeleteId(null);
    onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fuel className="h-4 w-4" /> Fuel fill-ups
        </CardTitle>
      </CardHeader>
      <CardContent>
        {fillups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fill-ups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Bus</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Litres</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fillups.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">
                      {format(new Date(f.filled_at), "dd/MM/yy HH:mm")}
                    </TableCell>
                    <TableCell>{f.bus_reference}</TableCell>
                    <TableCell className="text-right font-mono">{f.km_at_fillup}</TableCell>
                    <TableCell className="text-right font-mono">{Number(f.liters).toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8"
                          onClick={() => openEdit(f)} aria-label="Edit fill-up">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(f.id)} aria-label="Delete fill-up">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit fuel fill-up</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ef-date">Date & time</Label>
              <Input id="ef-date" type="datetime-local" value={filledAt}
                onChange={(e) => setFilledAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ef-bus">Bus reference</Label>
              <Input id="ef-bus" value={bus} onChange={(e) => setBus(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ef-km">Odometer (km)</Label>
                <Input id="ef-km" type="number" inputMode="numeric" value={km}
                  onChange={(e) => setKm(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ef-l">Litres</Label>
                <Input id="ef-l" type="number" inputMode="decimal" step="0.01"
                  value={liters} onChange={(e) => setLiters(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this fill-up?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
