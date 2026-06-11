import { useState, useEffect, useCallback, useRef } from "react";

interface GtfsAlert {
  id: string;
  effect: string;
  cause: string;
  title: string;
  description: string;
  routes: string[];
  activePeriod: { start: number | null; end: number | null } | null;
}

interface UseGtfsAlertsReturn {
  alerts: GtfsAlert[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

const getText = (obj: { translation?: { language?: string; text?: string }[] } | undefined): string => {
  const t = obj?.translation ?? [];
  return (t.find((x) => x.language === "fr") ?? t[0])?.text ?? "";
};

const FEED_URL = "https://notify.ratpdev.com/api/networks/RD%20QUIMPER/alerts/gtfsrt";
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useGtfsAlerts(): UseGtfsAlertsReturn {
  const [alerts, setAlerts] = useState<GtfsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(FEED_URL, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      const parsed: GtfsAlert[] = (data?.alerts ?? []).map((alert: any) => {
        const routes: string[] = (alert?.informedEntities ?? [])
          .map((e: any) => e?.route?.routeId)
          .filter((id: string | undefined) => !!id);

        return {
          id: alert?.id ?? "",
          effect: alert?.effect ?? "",
          cause: alert?.cause ?? "",
          title: getText(alert?.headerText),
          description: getText(alert?.descriptionText),
          routes,
          activePeriod: (alert?.activePeriods?.[0] as { start: number | null; end: number | null } | undefined)
            ? {
                start: alert.activePeriods[0].start ?? null,
                end: alert.activePeriods[0].end ?? null,
              }
            : null,
        };
      });

      setAlerts(parsed);
      setLastUpdated(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;

      // Treat any fetch failure as a CORS error for this feed
      setAlerts([]);
      setError("cors");
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    fetchAlerts();

    const interval = setInterval(() => {
      fetchAlerts();
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      controllerRef.current?.abort();
    };
  }, [fetchAlerts]);

  return { alerts, loading, error, lastUpdated, refresh };
}
