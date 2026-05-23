import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { exportShiftsToNotion } from "@/lib/notion.functions";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { formatHm, ranges, type Shift, type Session } from "@/lib/stats";
import { exportToExcel } from "@/lib/excel";
import { format } from "date-fns";
import { RowActions } from "@/components/RowActions";
import { EditShiftDialog } from "@/components/EditShiftDialog";

type Props = { shifts: Shift[]; sessions: Session[]; onChanged: () => void };
type Period = "day" | "week" | "month" | "year";

const LS_KEY = "notion_shifts_database_id";

export function ShiftsTable({ shifts, sessions, onChanged }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [exportOpen, setExportOpen] = useState(false);
  const [dbId, setDbId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const exportFn = useServerFn(exportShiftsToNotion);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) setDbId(saved);
  }, []);

  const rows = useMemo(() => {
    const r = ranges()[period];
    const now = Date.now();
    return shifts
      .filter((s) => {
        const t = new Date(s.on_duty_at).getTime();
        return t >= r.from.getTime() && t <= r.to.getTime();
      })
      .map((s) => {
        const start = new Date(s.on_duty_at);
        const end = s.off_duty_at ? new Date(s.off_duty_at) : null;
        const durMs = (end ? end.getTime() : now) - start.getTime();
        return { s, start, end, durMs };
      });
  }, [shifts, period]);

  const runExport = async () => {
    const value = dbId.trim();
    if (!value || !/[0-9a-f]{32}/i.test(value.replace(/-/g, ""))) {
      toast.error("Paste a Notion database URL or its 32-char ID");
      return;
    }
    localStorage.setItem(LS_KEY, value);
    setBusy(true);
    try {
      const res = await exportFn({ data: { databaseId: value, period } });
      toast.success(`Exported ${res.exported} shift(s) to Notion${res.skipped ? ` (${res.skipped} skipped)` : ""}`);
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
        <CardTitle className="text-base">On-duty sessions</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="year">Year</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline"
            onClick={() => exportToExcel(shifts, sessions, period)}>
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
            No on-duty sessions in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>On duty</TableHead>
                <TableHead>Off duty</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ s, start, end, durMs }) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{format(start, "EEE dd MMM")}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">{format(start, "HH:mm")}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono">
                    {end ? format(end, "HH:mm") : <span className="text-primary">live</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatHm(durMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export on-duty to Notion</DialogTitle>
            <DialogDescription>
              Recognised columns (optional):{" "}
              <span className="font-mono">On duty, Off duty, Duration (min)</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="shiftsDbId">Notion database URL or ID</Label>
            <Input id="shiftsDbId" autoFocus value={dbId}
              onChange={(e) => setDbId(e.target.value)}
              placeholder="https://www.notion.so/… or 32-char ID" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={runExport} disabled={busy}>
              {busy ? "Exporting…" : `Export ${period}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
