import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useGtfsAlerts } from "@/hooks/useGtfsAlerts";
import { cn } from "@/lib/utils";

function getAlertStyles(effect: string) {
  switch (effect) {
    case "NO_SERVICE":
      return {
        border: "border-l-destructive",
        bg: "bg-destructive/10",
        badge: "bg-destructive/15 text-destructive",
      };
    case "DETOUR":
      return {
        border: "border-l-orange-500",
        bg: "bg-orange-500/10",
        badge: "bg-orange-500/15 text-orange-600",
      };
    case "REDUCED_SERVICE":
    case "SIGNIFICANT_DELAYS":
      return {
        border: "border-l-yellow-500",
        bg: "bg-yellow-500/10",
        badge: "bg-yellow-500/15 text-yellow-700",
      };
    default:
      return {
        border: "border-l-blue-500",
        bg: "bg-blue-500/10",
        badge: "bg-blue-500/15 text-blue-700",
      };
  }
}

function effectLabel(effect: string) {
  const labels: Record<string, string> = {
    NO_SERVICE: "Interruption",
    DETOUR: "Déviation",
    REDUCED_SERVICE: "Service réduit",
    SIGNIFICANT_DELAYS: "Retards",
    OTHER: "Info",
  };
  return labels[effect] ?? "Info";
}

export function AlertsBanner() {
  const { alerts, error } = useGtfsAlerts();
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  if (dismissed) return null;

  if (error === "cors") {
    return (
      <div
        className={cn(
          "border-b bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground",
          "transition-all duration-300 ease-out",
          mounted ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        )}
      >
        Live alerts unavailable — check network status
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div
        className={cn(
          "border-b bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground",
          "transition-all duration-300 ease-out",
          mounted ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        )}
      >
        No active alerts
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-b bg-card",
        "transition-all duration-300 ease-out",
        mounted ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-2 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-4 sm:py-3">
        {/* Count badge */}
        <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <span aria-hidden>⚠</span>
          <span>
            {alerts.length} alert{alerts.length > 1 ? "s" : ""} on the QUB network
          </span>
        </div>

        {/* Alert pills */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap">
          {alerts.map((alert) => {
            const styles = getAlertStyles(alert.effect);
            const title =
              alert.title.length > 80
                ? alert.title.slice(0, 80) + "…"
                : alert.title;

            return (
              <div
                key={alert.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border py-1.5 pr-2",
                  "border-l-4 pl-3",
                  styles.border,
                  styles.bg
                )}
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    styles.badge
                  )}
                >
                  {effectLabel(alert.effect)}
                </span>

                {alert.routes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {alert.routes.map((route) => (
                      <span
                        key={route}
                        className="inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                      >
                        {route}
                      </span>
                    ))}
                  </div>
                )}

                <span
                  className="max-w-[200px] truncate text-xs text-foreground sm:max-w-[260px]"
                  title={alert.title}
                >
                  {title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Dismiss button */}
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss alerts"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
