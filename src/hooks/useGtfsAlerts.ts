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

const PROXY_URL =
  "https://api.allorigins.win/get?url=https%3A%2F%2Fnotify.ratpdev.com%2Fapi%2Fnetworks%2FRD%2520QUIMPER%2Falerts%2Fgtfsrt";
const REFRESH_INTERVAL = 5 * 60 * 1000;

export function useGtfsAlerts(): UseGtfsAlertsReturn {
  const [alerts, setAlerts] = useState<GtfsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchAlerts = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(PROXY_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const wrapper = await res.json();
      const data = JSON.parse(wrapper.contents);

      const entities: any[] = data?.entity ?? data?.alerts ?? [];
      const parsed: GtfsAlert[] = entities.map((entity: any) => {
        const alert = entity?.alert ?? entity;
        const informed = alert?.informedEntity ?? alert?.informedEntities ?? [];
        const routes: string[] = informed
          .map((e: any) => e?.routeId ?? e?.route?.routeId ?? e?.route_id)
          .filter((id: string | undefined) => !!id);
        const periods = alert?.activePeriod ?? alert?.activePeriods ?? [];
        const period = periods[0];

        return {
          id: entity?.id ?? alert?.id ?? "",
          effect: alert?.effect ?? "",
          cause: alert?.cause ?? "",
          title: getText(alert?.headerText ?? alert?.header_text),
          description: getText(alert?.descriptionText ?? alert?.description_text),
          routes,
          activePeriod: period
            ? { start: period.start ?? null, end: period.end ?? null }
            : null,
        };
      });

      setAlerts(parsed);
      setLastUpdated(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.warn("[useGtfsAlerts] Proxy fetch failed", err);
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
    const interval = setInterval(fetchAlerts, REFRESH_INTERVAL);
    return () => {
      clearInterval(interval);
      controllerRef.current?.abort();
    };
  }, [fetchAlerts]);

  return { alerts, loading, error, lastUpdated, refresh };
}
