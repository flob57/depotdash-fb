import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { formatHm, ranges, type Shift, type Session } from "@/lib/stats";
import { exportToExcel } from "@/lib/excel";
import { format } from "date-fns";

type Props = { shifts: Shift[]; sessions: Session[] };
type Period = "day" | "week" | "month" | "year";

export function ShiftsTable({ shifts, sessions }: Props) {
  const [period, setPeriod] = useState<Period>("week");

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
    </Card>
  );
}
