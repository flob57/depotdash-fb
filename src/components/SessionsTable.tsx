import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { exportSessionsToNotion } from "@/lib/notion.functions";
import { toast } from "sonner";
import { Upload, Download } from "lucide-react";
import { formatHm, isoWeekKey, isoWeekRange, formatIsoWeek, type Session, type Shift } from "@/lib/stats";
import { exportToExcel } from "@/lib/excel";
import { format } from "date-fns";
import { RowActions } from "@/components/RowActions";
import { EditSessionDialog } from "@/components/EditSessionDialog";

type Props = { shifts: Shift[]; sessions: Session[]; onChanged: () => void };
export function SessionsTable({ shifts, sessions, onChanged }: Props) {
  const [selectedWeek, setSelectedWeek] = useState(() => isoWeekKey(new Date()));
  const [exportOpen, setExportOpen] = useState(false);
  const [dbId, setDbId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Session | null>(null);
  const exportFn = useServerFn(exportSessionsToNotion);

  useEffect(() => {
    const saved = localStorage.getItem("notion_database_id");
    if (saved) setDbId(saved);
  }, []);

  const weekOptions = useMemo(() => {
    const keys = new Set<string>([isoWeekKey(new Date())]);
    sessions.forEach((s) => keys.add(isoWeekKey(new Date(s.start_at))));
    return Array.from(keys).sort().reverse();
  }, [sessions]);

  const rows = useMemo(() => {
    const r = isoWeekRange(selectedWeek);
    const now = Date.now();
    return sessions
      .filter((s) => {
        const t = new Date(s.start_at).getTime();
        return t >= r.from.getTime() && t <= r.to.getTime();
      })
      .map((s) => {
        const start = new Date(s.start_at);
        const end = s.end_at ? new Date(s.end_at) : null;
        const durMs = (end ? end.getTime() : now) - start.getTime();
        const km = s.km_start != null && s.km_end != null
          ? Math.max(0, s.km_end - s.km_start) : null;
        return { s, start, end, durMs, km };
      });
  }, [sessions, selectedWeek]);

  const runExport = async () => {
    const value = dbId.trim();
    if (!value || !/[0-9a-f]{32}/i.test(value.replace(/-/g, ""))) {
      toast.error("Paste a Notion database URL or its 32-char ID");
      return;
    }
    localStorage.setItem("notion_database_id", value);
    setBusy(true);
    try {
      const res = await exportFn({ data: { databaseId: value, period: "week" } });
      toast.success(`Exported ${res.exported} session(s) to Notion${res.skipped ? ` (${res.skipped} skipped)` : ""}`);
      setExportOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Driving sessions</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger className="h-9 w-auto min-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((w) => (
                <SelectItem key={w} value={w}>{formatIsoWeek(w)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline"
            onClick={() => exportToExcel(shifts, sessions, "week")}>
            <Download className="mr-1.5 h-4 w-4" /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" /> Notion
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No driving sessions in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Bus</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Stop</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">km start</TableHead>
                <TableHead className="text-right">km stop</TableHead>
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ s, start, end, durMs, km }) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{format(start, "EEE dd MMM")}</TableCell>
                  <TableCell className="font-mono">{s.bus_reference ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{format(start, "HH:mm")}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">
                    {end ? format(end, "HH:mm") : <span className="text-primary">live</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatHm(durMs)}</TableCell>
                  <TableCell className="text-right font-mono">{s.km_start ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{s.km_end ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{km != null ? `${km} km` : "—"}</TableCell>
                  <TableCell>
                    <RowActions table="driving_sessions" id={s.id} label="Driving session"
                      onEdit={() => setEditing(s)} onDeleted={onChanged} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing && (
        <EditSessionDialog session={editing} open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)} onSaved={onChanged} />
      )}

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export to Notion</DialogTitle>
            <DialogDescription>
              Share a Notion database with your integration, then paste its URL or ID below.
              The {period} sessions will be added as new pages. Recognised columns
              (optional): <span className="font-mono">Bus, Start, Stop, Duration (min), Distance (km), km start, km end</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dbId">Notion database URL or ID</Label>
            <Input id="dbId" autoFocus value={dbId}
              onChange={(e) => setDbId(e.target.value)}
              placeholder="https://www.notion.so/… or 32-char ID" />
            <p className="text-xs text-muted-foreground">
              Open the database in Notion · ••• menu · Copy link · paste the whole link here.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={runExport} disabled={busy}>
              {busy ? "Exporting…" : "Export week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
