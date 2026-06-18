// Server-only helpers for the SAE (Système d'Aide à l'Exploitation) feature.
// Reads today's routes from the user's Notion "Mon planning" database,
// resolves each route's stop list via the linked Service page, and pushes
// validated passing times to a Notion target database.

import { notionFetch, resolveDatabase } from "@/lib/notion-export.server";

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
  codeGirouette: string | null;
  vehicleService: string | null;
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
    case "relation": {
      // Relations are an array of page IDs; resolve via resolveRelationTitles when needed.
      return null;
    }
    case "people":
      return (value.people ?? []).map((p: any) => p.name).filter(Boolean).join(", ") || null;
    case "url":
      return value.url ?? null;
    case "email":
      return value.email ?? null;
    case "phone_number":
      return value.phone_number ?? null;
    case "checkbox":
      return value.checkbox ? "true" : null;
    case "status":
      return value.status?.name ?? null;
    default:
      return null;
  }
}

// Resolve a relation property to the title of its first linked page.
async function resolveRelationTitle(value: any): Promise<string | null> {
  if (!value || value.type !== "relation") return null;
  const rels = (value.relation ?? []) as Array<{ id: string }>;
  if (rels.length === 0) return null;
  try {
    const page = (await notionFetch(`/pages/${rels[0].id}`)) as {
      properties: Record<string, any>;
    };
    return getTitle(page.properties) || null;
  } catch {
    return null;
  }
}

// "07:50" -> "07:50". Also tolerates "7:50" / "08h02".
function normalizeHm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const source = String(raw).trim();
  const iso = source.match(/T(\d{2}):(\d{2})/);
  const m = iso ?? source.match(/(\d{1,2})\s*[:h.]\s*(\d{2})/i);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const compact = source.match(/^\d{3,4}$/)?.[0];
  if (compact) {
    const hour = Number(compact.slice(0, -2));
    const minute = Number(compact.slice(-2));
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  return null;
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function routeCodesFromText(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/\bP\s*\d+(?:\.\d+)?\b/gi)).map((m) =>
    m[0].replace(/\s+/g, "").toUpperCase(),
  );
}

function routeMatchKey(value: string): string {
  return stripRouteSuffix(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function textContainsRoute(value: string | null | undefined, candidates: string[]): boolean {
  if (!value) return false;
  const haystack = routeMatchKey(value);
  return candidates.some((candidate) => {
    const needle = routeMatchKey(candidate);
    if (!needle) return false;
    if (haystack === needle) return true;
    return new RegExp(`(^|[^A-Z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`).test(haystack);
  });
}

async function extractRouteCandidates(props: Record<string, any>, fallbackTitle: string): Promise<string[]> {
  const values: string[] = [fallbackTitle];
  for (const [key, prop] of Object.entries(props)) {
    const scalar = extractScalar(prop);
    if (scalar) {
      values.push(...routeCodesFromText(scalar));
      if (/(course|route|ligne|line)/i.test(key)) values.push(scalar);
    }
    if ((prop as any)?.type === "relation") {
      const related = await resolveRelationTitle(prop);
      if (related) {
        values.push(...routeCodesFromText(related));
        if (/(course|route|ligne|line)/i.test(key)) values.push(related);
      }
    }
  }
  return uniqueNonEmpty([...values.flatMap(routeCodesFromText), ...values]);
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
  return normalizeNotionId((custom && custom.trim()) || DEFAULT_PLANNING_DB_ID) ?? DEFAULT_PLANNING_DB_ID;
}

// Accepts a raw UUID, dashed UUID, or full Notion URL and returns a dashed UUID.
export function normalizeNotionId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/([0-9a-fA-F]{32})|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (!m) return null;
  const hex = (m[0] || "").replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) return null;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
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
export async function fetchRouteDetails(
  routeId: string,
  opts?: { vehicleDbId?: string | null },
): Promise<SaeRoute> {
  const page = (await notionFetch(`/pages/${routeId}`)) as {
    id: string;
    properties: Record<string, any>;
  };
  const props = page.properties;
  const lineName = getTitle(props);
  const vehicleRouteCandidates = await extractRouteCandidates(props, lineName);
  const depStop = extractScalar(props["Arret depart"]);
  const arrStop = extractScalar(props["Arret arrivee"]);
  const depTime = normalizeHm(extractScalar(props["Horaire depart"]));
  const arrTime = normalizeHm(extractScalar(props["Horaire arrivee"]));

  // "Codes girouette" / "Code girouette" (tolerant key match)
  let codeGirouette: string | null = null;
  for (const [k, v] of Object.entries(props)) {
    if (!/codes?\s*girouette/i.test(k)) continue;
    codeGirouette = extractScalar(v) || (await resolveRelationTitle(v));
    if (codeGirouette) break;
  }


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

  if (stops.length === 0) {
    if (depStop) stops.push({ index: 1, name: depStop, scheduledTime: depTime });
    if (arrStop) stops.push({ index: stops.length + 1, name: arrStop, scheduledTime: arrTime });
  }

  // Look up vehicle / service number from the SAE assignments DB (LMJV or Mercredi).
  let vehicleService: string | null = null;
  if (opts?.vehicleDbId && lineName && depTime) {
    try {
      vehicleService = await fetchVehicleServiceNumber(
        opts.vehicleDbId,
        vehicleRouteCandidates.length ? vehicleRouteCandidates : [lineName],
        depTime,
      );
    } catch (e) {
      console.error("fetchVehicleServiceNumber failed", e);
    }
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
    codeGirouette,
    vehicleService,
    stops,
  };
}

// Strip the suffix from a route name: "P63.01" -> "P63"
export function stripRouteSuffix(name: string): string {
  return (name || "").split(".")[0].trim();
}

// Look up the vehicle/service number for a given route + departure time
// in the user's SAE assignments database (LMJV or Mercredi).
export async function fetchVehicleServiceNumber(
  dbId: string,
  fullRouteName: string,
  depTime: string,
): Promise<string | null> {
  const normalizedDbId = normalizeNotionId(dbId);
  if (!normalizedDbId) {
    console.warn("[SAE] Invalid vehicle DB id", { dbId });
    return null;
  }
  const base = stripRouteSuffix(fullRouteName);
  if (!base) return null;
  const normalizedDep = normalizeHm(depTime);
  const baseLc = base.toLowerCase();

  // Page through the DB. The route name may be in the title OR in any
  // text/select property; same for departure time and the service number.
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = (await notionFetch(`/databases/${normalizedDbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as {
      results: Array<{ id: string; properties: Record<string, any> }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const row of res.results) {
      scanned++;
      const props = row.properties;
      const title = getTitle(props);

      // Does this row reference our route name (in title or any prop)?
      const routeMatches =
        stripRouteSuffix(title).toLowerCase() === baseLc ||
        Object.values(props).some((v) => {
          const s = extractScalar(v);
          return !!s && stripRouteSuffix(s).toLowerCase() === baseLc;
        });
      if (!routeMatches) continue;

      // Departure time match — scan every property for a HH:MM-shaped value.
      let depOk = false;
      for (const v of Object.values(props)) {
        const s = extractScalar(v);
        const n = normalizeHm(s);
        if (n && n === normalizedDep) { depOk = true; break; }
      }
      if (!depOk) continue;

      // Service number: prefer a "service/vehicule/numero/bus" property; else
      // fall back to the page title (often the row IS the service number).
      for (const [k, v] of Object.entries(props)) {
        if (!/(service|v[ée]hicule|vehicule|num[ée]ro|numero|bus)/i.test(k)) continue;
        const s = extractScalar(v);
        if (s) return s;
      }
      if (title) return title;
    }

    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor && scanned < 1000);

  console.warn("[SAE] No vehicle service match", { base, normalizedDep, scanned });
  return null;
}


// Compute the Paris weekday index: 0 = Sunday ... 6 = Saturday.
export function parisWeekday(d: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd as "Sun"] ?? 0;
}

// "HH:MM" in Europe/Paris for a given timestamp.
export function parisHm(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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
      { text: { content: parisHm(params.actualIso) } },
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
  // Accept either a raw UUID or a Notion page URL — extract & dash the ID.
  const raw = parentPageId.trim();
  let idSource = raw;
  try {
    idSource = new URL(raw).pathname;
  } catch {
    /* plain id */
  }
  const cleaned = idSource.replace(/-/g, "");
  const matches = cleaned.match(/[0-9a-f]{32}/gi);
  if (!matches || matches.length === 0) {
    throw new Error("Invalid Notion parent page ID/URL — could not find a 32-char ID.");
  }
  const c = matches[matches.length - 1].toLowerCase();
  const pageId = `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;

  const created = (await notionFetch(`/databases`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: pageId },
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

