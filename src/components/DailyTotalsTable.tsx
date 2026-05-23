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
import { exportDailyTotalsToNotion } from "@/lib/notion.functions";
import { computeDailyTotals } from "@/lib/daily-totals";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { formatHm, ranges, type Shift, type Session } from "@/lib/stats";
import { format, parseISO } from "date-fns";

type Props = { shifts: Shift[]; sessions: Session[] };
type Period = "day" | "week" | "month" | "year";

const LS_KEY = "notion_daily_totals_database_id";

export function DailyTotalsTable({ shifts, sessions }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [exportOpen, setExportOpen] = useState(false);
  const [dbId, setDbId] = useState("");
  const [busy, setBusy] = useState(false);
  const exportFn = useServerFn(exportDailyTotalsToNotion);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) setDbId(saved);
  }, []);

  const rows = useMemo(() => {
    const r = ranges()[period];
    const inRange = <T extends { start: string }>(arr: T[]) =>
      arr.filter((x) => {
        const t = new Date(x.start).getTime();
        return t >= r.from.getTime() && t <= r.to.getTime();
      });
    const sh = inRange(shifts.map((s) => ({ start: s.on_duty_at, _s: s }))).map((x) => x._s);
    const se = inRange(sessions.map((s) => ({ start: s.start_at, _s: s }))).map((x) => x._s);
    return computeDailyTotals(sh, se);
  }, [shifts, sessions, period]);

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
      toast.success(`Exported ${res.exported} day(s) to Notion`);
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
        <CardTitle className="text-base">Daily totals (completed days)</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="year">Year</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" /> Notion
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No completed day in this period yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">On duty</TableHead>
                <TableHead className="text-right">Driving</TableHead>
                <TableHead className="text-right">Driving %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.date}>
                  <TableCell className="whitespace-nowrap">
                    {format(parseISO(r.date), "EEE dd MMM")}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatHm(r.onDutyMs)}</TableCell>
                  <TableCell className="text-right font-mono">{formatHm(r.drivingMs)}</TableCell>
                  <TableCell className="text-right font-mono">{r.percent.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export daily totals to Notion</DialogTitle>
            <DialogDescription>
              Recognised columns (optional):{" "}
              <span className="font-mono">Date, On duty (min), Driving (min), Driving %</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dailyDbId">Notion database URL or ID</Label>
            <Input id="dailyDbId" autoFocus value={dbId}
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
