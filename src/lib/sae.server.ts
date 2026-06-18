// Server-only helpers for the SAE (Système d'Aide à l'Exploitation) feature.
// Reads today's routes from the user's Notion "Mon planning" database,
// resolves each route's stop list via the linked Service page, and pushes
// validated passing times to a Notion target database.

import { notionFetch } from "@/lib/notion-export.server";

const DEFAULT_PLANNING_DB_ID = "3836bbfa-7ec1-804e-9718-d9a7d1315870";

export type SaeStop = {
  index: number;          // 1-based
  name: string;
  scheduledTime: string | null; // "HH:MM"
};

export type SaeRoute = {
  id: string;             // Horaire QUB page id
  lineName: string;       // e.g. "P140.02"
  serviceId: string | null;
  serviceName: string | null;
  depStop: string | null;
  depTime: string | null;
  arrStop: string | null;
  arrTime: string | null;
  stops: SaeStop[];       // full ordered stop list (best-effort)
};

// ---------- helpers ----------

function plainText(rt: Array<{ plain_text?: string }> | undefined): string {
  return (rt ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

function getTitle(props: Record<string, any>): string {
  const t = Object.values(props).find((p: any) => p?.type === "title") as any;
  return plainText(t?.title);
}

// Best-effort scalar extraction for various Notion rollup / property shapes.
function extractScalar(value: any): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => extractScalar(v))
      .filter(Boolean)
      .join(", ");
    return joined || null;
  }
  switch (value.type) {
    case "title":
      return plainText(value.title) || null;
    case "rich_text":
      return plainText(value.rich_text) || null;
    case "select":
      return value.select?.name ?? null;
    case "multi_select":
      return (value.multi_select ?? []).map((s: any) => s.name).join(", ") || null;
    case "number":
      return value.number != null ? String(value.number) : null;
    case "date":
      return value.date?.start ?? null;
    case "formula":
      return extractScalar(value.formula);
    case "rollup": {
      const r = value.rollup;
      if (!r) return null;
      if (r.type === "array") return extractScalar(r.array);
      return extractScalar(r);
    }
    default:
      return null;
  }
}

// "07:50" -> "07:50". Also tolerates "7:50" / "08h02".
function normalizeHm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  if (!m) return null;
  const h = m[1].padStart(2, "0");
  return `${h}:${m[2]}`;
}

// ---------- read stops from a Horaire QUB page table block ----------

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  table?: { table_width: number; has_column_header?: boolean; has_row_header?: boolean };
  table_row?: { cells: Array<Array<{ plain_text?: string }>> };
};

async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : `?page_size=100`;
    const res = (await notionFetch(`/blocks/${blockId}/children${qs}`)) as {
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    };
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

async function fetchStopsFromPageTable(pageId: string): Promise<SaeStop[]> {
  const children = await fetchBlockChildren(pageId);
  const table = children.find((b) => b.type === "table");
  if (!table) return [];
  const rows = await fetchBlockChildren(table.id);
  const stops: SaeStop[] = [];
  const skipHeader = !!table.table?.has_column_header;
  rows.forEach((r, idx) => {
    if (r.type !== "table_row" || !r.table_row) return;
    if (skipHeader && idx === 0) return;
    const cells = r.table_row.cells;
    const name = plainText(cells[0]);
    const time = normalizeHm(plainText(cells[1]));
    if (!name) return;
    stops.push({ index: stops.length + 1, name, scheduledTime: time });
  });
  return stops;
}



export function planningDbId(custom: string | null | undefined): string {
  return (custom && custom.trim()) || DEFAULT_PLANNING_DB_ID;
}

export async function fetchTodayRouteIds(dbId: string, isoDate: string): Promise<string[]> {
  // 1) Query the planning DB filtered by Date = today.
  const res = (await notionFetch(`/databases/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: "Date", date: { equals: isoDate } },
      page_size: 50,
    }),
  })) as { results: Array<{ id: string; properties: Record<string, any> }> };

  const courseIds = new Set<string>();
  for (const row of res.results) {
    for (const [name, prop] of Object.entries(row.properties)) {
      if (!/^Course\s*\d+/i.test(name)) continue;
      const rels = (prop as any).relation as Array<{ id: string }> | undefined;
      (rels ?? []).forEach((r) => courseIds.add(r.id));
    }
  }
  return [...courseIds];
}

// Fetch a Horaire QUB row + resolve its service / stops.
export async function fetchRouteDetails(routeId: string): Promise<SaeRoute> {
  const page = (await notionFetch(`/pages/${routeId}`)) as {
    id: string;
    properties: Record<string, any>;
  };
  const props = page.properties;
  const lineName = getTitle(props);
  const depStop = extractScalar(props["Arret depart"]);
  const arrStop = extractScalar(props["Arret arrivee"]);
  const depTime = normalizeHm(extractScalar(props["Horaire depart"]));
  const arrTime = normalizeHm(extractScalar(props["Horaire arrivee"]));

  // Find first non-empty service relation.
  let serviceId: string | null = null;
  for (const [k, v] of Object.entries(props)) {
    if (!/Services Lestonan/i.test(k)) continue;
    const rels = (v as any).relation as Array<{ id: string }> | undefined;
    if (rels && rels.length > 0) {
      serviceId = rels[0].id;
      break;
    }
  }

  let serviceName: string | null = null;
  let stops: SaeStop[] = [];

  // Preferred source: a table block inside the Horaire QUB page itself
  // (2 columns: stop name | scheduled time).
  try {
    stops = await fetchStopsFromPageTable(page.id);
  } catch (e) {
    console.error("fetchStopsFromPageTable failed", page.id, e);
  }

  if (serviceId) {
    try {
      const service = (await notionFetch(`/pages/${serviceId}`)) as {
        properties: Record<string, any>;
      };
      serviceName = getTitle(service.properties);
    } catch {
      /* ignore */
    }
  }

  // Fallback: build a 2-stop "route" from dep/arr if we couldn't resolve a service.
  if (stops.length === 0) {
    if (depStop) stops.push({ index: 1, name: depStop, scheduledTime: depTime });
    if (arrStop) stops.push({ index: stops.length + 1, name: arrStop, scheduledTime: arrTime });
  }

  return {
    id: page.id,
    lineName: lineName || "Course",
    serviceId,
    serviceName,
    depStop,
    depTime,
    arrStop,
    arrTime,
    stops,
  };
}

// ---------- push a passage to Notion ----------

export async function pushPassageToNotion(params: {
  databaseId: string;
  workDate: string;         // "YYYY-MM-DD"
  routeName: string;
  stopName: string;
  scheduledTime: string | null;
  actualIso: string;        // ISO timestamp
  diffMinutes: number | null;
  status: string | null;
  paxOn?: number | null;
  paxOff?: number | null;
  paxOnBoard?: number | null;
}): Promise<string> {
  // Discover the DB schema so we map to properties that exist (or fall back).
  const db = (await notionFetch(`/databases/${params.databaseId}`)) as {
    properties: Record<string, { type: string; name: string }>;
  };

  // Find a title property
  const titleKey =
    Object.keys(db.properties).find((k) => db.properties[k].type === "title") ?? "Name";

  const properties: Record<string, any> = {
    [titleKey]: {
      title: [{ text: { content: `${params.routeName} — ${params.stopName}` } }],
    },
  };

  const setIfExists = (preferred: string[], type: string, value: any) => {
    for (const key of preferred) {
      const real = Object.keys(db.properties).find(
        (k) => k.toLowerCase() === key.toLowerCase() && db.properties[k].type === type,
      );
      if (real) {
        properties[real] = value;
        return;
      }
    }
  };

  setIfExists(["Date", "Jour"], "date", { date: { start: params.workDate } });
  setIfExists(["Course", "Route", "Ligne"], "rich_text", {
    rich_text: [{ text: { content: params.routeName } }],
  });
  setIfExists(["Arrêt", "Arret", "Stop"], "rich_text", {
    rich_text: [{ text: { content: params.stopName } }],
  });
  if (params.scheduledTime) {
    setIfExists(["Horaire théorique", "Horaire theorique", "Scheduled"], "rich_text", {
      rich_text: [{ text: { content: params.scheduledTime } }],
    });
  }
  setIfExists(["Horaire réel", "Horaire reel", "Actual"], "rich_text", {
    rich_text: [
      { text: { content: new Date(params.actualIso).toISOString().slice(11, 16) } },
    ],
  });
  if (params.diffMinutes != null) {
    setIfExists(["Écart (min)", "Ecart (min)", "Écart", "Ecart", "Diff"], "number", {
      number: params.diffMinutes,
    });
  }
  if (params.status) {
    setIfExists(["Statut", "Status"], "select", { select: { name: params.status } });
  }
  if (params.paxOn != null) {
    setIfExists(["Montées", "Montees", "Pax On", "Boarding"], "number", { number: params.paxOn });
  }
  if (params.paxOff != null) {
    setIfExists(["Descentes", "Pax Off", "Alighting"], "number", { number: params.paxOff });
  }
  if (params.paxOnBoard != null) {
    setIfExists(["À bord", "A bord", "On Board", "Pax"], "number", { number: params.paxOnBoard });
  }

  const created = (await notionFetch(`/pages`, {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: params.databaseId },
      properties,
    }),
  })) as { id: string };

  return created.id;
}

// Create the "Mes horaires réel" DB inside a given parent page.
export async function createActualTimesDatabase(parentPageId: string): Promise<string> {
  const created = (await notionFetch(`/databases`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "Mes horaires réel" } }],
      properties: {
        Nom: { title: {} },
        Date: { date: {} },
        Course: { rich_text: {} },
        Arret: { rich_text: {} },
        "Horaire theorique": { rich_text: {} },
        "Horaire reel": { rich_text: {} },
        "Ecart (min)": { number: {} },
        Montées: { number: {} },
        Descentes: { number: {} },
        "À bord": { number: {} },
        Statut: {
          select: {
            options: [
              { name: "en avance", color: "blue" },
              { name: "à l'heure", color: "green" },
              { name: "en retard", color: "red" },
            ],
          },
        },
      },
    }),
  })) as { id: string };
  return created.id;
}

