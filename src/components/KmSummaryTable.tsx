import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { sumKm, ranges, type Session } from "@/lib/stats";

type Props = { sessions: Session[] };

export function KmSummaryTable({ sessions }: Props) {
  const rows = useMemo(() => {
    const r = ranges();
    return [
      { label: "Today", km: sumKm(sessions, r.day.from, r.day.to) },
      { label: "This week", km: sumKm(sessions, r.week.from, r.week.to) },
      { label: "This month", km: sumKm(sessions, r.month.from, r.month.to) },
      { label: "This year", km: sumKm(sessions, r.year.from, r.year.to) },
      { label: "All time", km: sumKm(sessions, new Date(0), new Date(8640000000000000)) },
    ];
  }, [sessions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Distance summary (km)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Total km</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="whitespace-nowrap">{row.label}</TableCell>
                <TableCell className="text-right font-mono">{row.km.toLocaleString()} km</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
