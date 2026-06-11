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

const FALLBACK_ALERTS: GtfsAlert[] = [
  {
    id: "demo_1",
    effect: "DETOUR",
    cause: "CONSTRUCTION",
    title: "Diversion lines 1 & 2 — Kerfeunteun works",
    description: "Lines 1 and 2 are diverted due to roadworks on rue de Kerfeunteun.",
    routes: ["1", "2"],
    activePeriod: null,
  },
  {
    id: "demo_2",
    effect: "SIGNIFICANT_DELAYS",
    cause: "ACCIDENT",
    title: "Major delays — Line 4 towards Ergué-Armel",
    description: "Line 4 running 15-20 min late due to an accident on avenue de la France Libre.",
    routes: ["4"],
    activePeriod: null,
  },
  {
    id: "demo_3",
    effect: "NO_SERVICE",
    cause: "TECHNICAL_PROBLEM",
    title: "Service suspended — Line 3",
    description: "Line 3 temporarily suspended. Replacement buses running between Gare SNCF and Quimper Centre.",
    routes: ["3"],
    activePeriod: null,
  },
];

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
      console.log("RAW wrapper:", wrapper);
      const data = JSON.parse(wrapper.contents);
      console.log("RAW data:", data);
      console.log("Entities:", data?.entity);

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

      if (parsed.length === 0) {
        console.log("[useGtfsAlerts] No live alerts — using FALLBACK_ALERTS");
        setAlerts(FALLBACK_ALERTS);
      } else {
        setAlerts(parsed);
      }
      setLastUpdated(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.warn("[useGtfsAlerts] Proxy fetch failed — using FALLBACK_ALERTS", err);
      setAlerts(FALLBACK_ALERTS);
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
