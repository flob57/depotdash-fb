import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, CalendarHeart } from "lucide-react";
import { formatMinutes } from "@/lib/declared";
import type { LeaveBalance } from "@/lib/leave";

type Props = {
  overtimeMinutes: number;
  leave: LeaveBalance;
};

export function OvertimeBanner({ overtimeMinutes, leave }: Props) {
  const positive = overtimeMinutes >= 0;
  const totalCp = leave.nMinus1 + leave.n;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Overtime
            </span>
          </div>
          <div className={`font-mono text-2xl font-semibold ${positive ? "text-success" : "text-destructive"}`}>
            {positive ? "+" : ""}{formatMinutes(overtimeMinutes)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <CalendarHeart className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Paid leave (CP)
            </span>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold">{totalCp.toFixed(1)} d</div>
            <div className="text-xs text-muted-foreground">
              N-1: {leave.nMinus1.toFixed(1)} · N: {leave.n.toFixed(1)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
