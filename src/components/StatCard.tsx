import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatHm, formatHmSigned } from "@/lib/stats";

type Props = {
  label: string;
  workedMs: number;
  dueMs: number;
  drivingMs: number;
  km: number;
};

export function StatCard({ label, workedMs, dueMs, drivingMs, km }: Props) {
  const pct = dueMs > 0 ? Math.min(100, (workedMs / dueMs) * 100) : 0;
  const diff = workedMs - dueMs;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-3xl font-bold tracking-tight">{formatHm(workedMs)}</div>
          <div className="text-xs text-muted-foreground">/ {formatHm(dueMs)} due</div>
        </div>
        <Progress value={pct} />
        <div className="flex items-center justify-between text-xs">
          <span className={diff >= 0 ? "text-success" : "text-destructive"}>
            {formatHmSigned(diff)} vs due
          </span>
          <span className="text-muted-foreground">{Math.round(pct)}%</span>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
          <div>
            <div className="text-muted-foreground">Driving</div>
            <div className="font-semibold">{formatHm(drivingMs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Kilometers</div>
            <div className="font-semibold">{km.toLocaleString()} km</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
