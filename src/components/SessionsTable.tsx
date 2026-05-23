import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHm, ranges, type Session, type Shift } from "@/lib/stats";
import { format } from "date-fns";

type Props = { shifts: Shift[]; sessions: Session[] };

type Period = "day" | "week" | "month" | "year";

export function SessionsTable({ sessions }: Props) {
  const [period, setPeriod] = useState<Period>("week");

  const rows = useMemo(() => {
    const r = ranges()[period];
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
  }, [sessions, period]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Driving sessions</CardTitle>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
        </Tabs>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
