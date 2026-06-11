import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notionFetch, resolveDatabase } from "@/lib/notion-export.server";

type AnyProp = { type: string; [k: string]: unknown };

function plain(prop: AnyProp | undefined): string {
  if (!prop) return "";
  const t = prop.type;
  const v = (prop as Record<string, unknown>)[t];
  if (v == null) return "";
  if (t === "rollup") {
    const r = v as { type: string; array?: AnyProp[]; number?: number; date?: { start?: string }; string?: string };
    if (r.type === "array" && Array.isArray(r.array)) {
      return r.array.map((x) => plain(x)).filter(Boolean).join(", ");
    }
    if (typeof r.number === "number") return String(r.number);
    if (r.date?.start) return r.date.start;
    if (typeof r.string === "string") return r.string;
    return "";
  }
  if (Array.isArray(v)) {
    return v.map((x: { plain_text?: string; name?: string }) => x.plain_text ?? x.name ?? "").join("").trim();
  }
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const o = v as { name?: string; start?: string; number?: number };
    if (typeof o.name === "string") return o.name;
    if (typeof o.start === "string") return o.start;
    if (typeof o.number === "number") return String(o.number);
  }
  return "";
}

async function relationTitles(prop: AnyProp | undefined, cache: Map<string, string>): Promise<string> {
  if (!prop) return "";
  const rels = extractRelationIds(prop);
  if (rels.length === 0) return "";
  const out: string[] = [];
  for (const id of rels) out.push(cache.get(id) ?? "");
  return out.filter(Boolean).join(", ");
}

function extractRelationIds(prop: AnyProp | undefined): string[] {
  if (!prop) return [];
  const ids: string[] = [];
  if (prop.type === "relation" && Array.isArray((prop as unknown as { relation?: { id: string }[] }).relation)) {
    for (const r of (prop as unknown as { relation: { id: string }[] }).relation) ids.push(r.id);
  } else if (prop.type === "rollup") {
    const arr = (prop as unknown as { rollup?: { array?: AnyProp[] } }).rollup?.array ?? [];
    for (const it of arr) {
      if (it.type === "relation" && Array.isArray((it as unknown as { relation?: { id: string }[] }).relation)) {
        for (const r of (it as unknown as { relation: { id: string }[] }).relation) ids.push(r.id);
      }
    }
  }
  return ids;
}

async function prefetchRelationTitles(ids: Iterable<string>, cache: Map<string, string>, concurrency = 8) {
  const todo = Array.from(new Set([...ids])).filter((id) => !cache.has(id));
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      try {
        const page = (await notionFetch(`/pages/${id}`)) as { properties: Record<string, AnyProp> };
        const titleKey = Object.keys(page.properties).find((k) => page.properties[k].type === "title");
        cache.set(id, titleKey ? plain(page.properties[titleKey]) : "");
      } catch {
        cache.set(id, "");
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}

type TimetableStop = { stop: string; time: string };
type IconValue =
  | { kind: "emoji"; value: string }
  | { kind: "external"; url: string }
  | { kind: "file"; url: string };
type RoutePageMeta = { timetable: TimetableStop[]; icon: IconValue | null };

function richTextToString(rt: Array<{ plain_text?: string }> | undefined): string {
  if (!rt || !Array.isArray(rt)) return "";
  return rt.map((x) => x.plain_text ?? "").join("").trim();
}

type NotionIcon =
  | { type: "emoji"; emoji?: string }
  | { type: "external"; external?: { url?: string } }
  | { type: "file"; file?: { url?: string } }
  | null;

function iconToValue(icon: NotionIcon): IconValue | null {
  if (!icon) return null;
  if (icon.type === "emoji" && icon.emoji) return { kind: "emoji", value: icon.emoji };
  if (icon.type === "external" && icon.external?.url) return { kind: "external", url: icon.external.url };
  if (icon.type === "file" && icon.file?.url) return { kind: "file", url: icon.file.url };
  return null;
}

async function fetchRoutePageMeta(pageId: string): Promise<RoutePageMeta> {
  const [page, children] = await Promise.all([
    notionFetch(`/pages/${pageId}`) as Promise<{ icon: NotionIcon }>,
    notionFetch(`/blocks/${pageId}/children?page_size=100`) as Promise<{
      results: Array<{ id: string; type: string }>;
    }>,
  ]);
  const icon = iconToValue(page.icon ?? null);
  const table = children.results.find((b) => b.type === "table");
  if (!table) return { timetable: [], icon };
  const rows = (await notionFetch(`/blocks/${table.id}/children?page_size=100`)) as {
    results: Array<{ type: string; table_row?: { cells: Array<Array<{ plain_text?: string }>> } }>;
  };
  const out: TimetableStop[] = [];
  for (const r of rows.results) {
    if (r.type !== "table_row" || !r.table_row) continue;
    const cells = r.table_row.cells;
    if (cells.length < 2) continue;
    const stop = richTextToString(cells[0]);
    const timeRaw = richTextToString(cells[1]);
    const time = parseTime(timeRaw);
    if (!stop || !time) continue;
    out.push({ stop, time: time.slice(0, 5) });
  }
  return { timetable: out, icon };
}


async function prefetchRoutePageMeta(ids: Iterable<string>, cache: Map<string, RoutePageMeta>, concurrency = 6) {
  const todo = Array.from(new Set([...ids])).filter((id) => !cache.has(id));
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const id = todo[i++];
      try {
        cache.set(id, await fetchRoutePageMeta(id));
      } catch {
        cache.set(id, { timetable: [], icon: null });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}





function findProp(props: Record<string, AnyProp>, ...names: string[]): AnyProp | undefined {
  const keys = Object.keys(props);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().trim() === n.toLowerCase().trim());
    if (k) return props[k];
  }
  // fuzzy: any key that contains the name
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().includes(n.toLowerCase()));
    if (k) return props[k];
  }
  return undefined;
}

function parseTime(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[h:.](\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}:00`;
  const m2 = raw.match(/^(\d{1,2})$/);
  if (m2) return `${m2[1].padStart(2, "0")}:00:00`;
  // ISO datetime
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}:00`;
  }
  return null;
}

export const syncDutiesFromNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ databaseId: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { id: dbId } = await resolveDatabase(data.databaseId);

    // Wipe existing duties for this user before re-importing from (possibly different) source DB
    await supabase.from("duties").delete().eq("user_id", userId);

    type Page = { id: string; properties: Record<string, AnyProp> };
    const all: Page[] = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = (await notionFetch(`/databases/${dbId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as { results: Page[]; has_more: boolean; next_cursor: string | null };
      all.push(...res.results);
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);

    let upserted = 0;
    let skipped = 0;
    const relCache = new Map<string, string>();

    // Wipe existing departures for this user; we rebuild from Notion every sync.
    await supabase.from("departures").delete().eq("user_id", userId);

    // Pre-scan all pages to collect every relation id referenced, then resolve
    // them in parallel batches. Serial /pages/{id} fetches per page were
    // causing upstream timeouts on larger databases.
    const allRelIds = new Set<string>();
    for (const page of all) {
      const props = page.properties;
      const candidates: (AnyProp | undefined)[] = [
        findProp(props, "Driver", "Conducteur", "Chauffeur"),
        findProp(props, "Route 1", "Course 1", "Route", "Service", "Ligne"),
        findProp(props, "Vehicle", "Véhicule", "Immatriculation", "Plaque"),
      ];
      for (let n = 1; n <= 12; n++) {
        candidates.push(findProp(props, `Route ${n}`, `Course ${n}`, `Service ${n}`, `Ligne ${n}`));
        candidates.push(findProp(props, `Lieu ${n}`, `Location ${n}`, `Lieu${n}`));
      }
      for (const c of candidates) for (const id of extractRelationIds(c)) allRelIds.add(id);
    }
    await prefetchRelationTitles(allRelIds, relCache);

    const dutiesRows: Array<{
      user_id: string; notion_page_id: string; start_time: string;
      qub: string; driver: string; route: string; vehicle: string;
      weekdays: number[]; sort_order: number;
    }> = [];
    const departuresRows: Array<{
      user_id: string; notion_page_id: string; slot_index: number;
      start_time: string; route: string; qub: string; driver: string; vehicle: string; location: string; arrival_time: string | null; weekdays: number[];
      timetable: TimetableStop[] | null;
      route_icon: string | null;
      _routePageId?: string;
    }> = [];

    let idx = 0;
    for (const page of all) {
      const psRaw = plain(findProp(page.properties, "PS", "Prise de service", "Start"));
      const start = parseTime(psRaw);
      if (!start) { skipped++; continue; }
      const qub = plain(findProp(page.properties, "QUB", "Bus", "Vehicle ref"));
      const driverProp = findProp(page.properties, "Driver", "Conducteur", "Chauffeur");
      const driver = plain(driverProp) || (await relationTitles(driverProp, relCache));
      const routeProp = findProp(page.properties, "Route 1", "Course 1", "Route", "Service", "Ligne");
      const route = plain(routeProp) || (await relationTitles(routeProp, relCache));
      const vehicleProp = findProp(page.properties, "Vehicle", "Véhicule", "Immatriculation", "Plaque");
      const vehicle = plain(vehicleProp) || (await relationTitles(vehicleProp, relCache));
      const weekdays = start.startsWith("06:15") ? [1] : [1, 2, 3, 4, 5];

      dutiesRows.push({
        user_id: userId, notion_page_id: page.id, start_time: start,
        qub, driver, route, vehicle, weekdays, sort_order: idx++,
      });
      upserted++;

      for (let n = 1; n <= 12; n++) {
        const rProp = findProp(page.properties, `Route ${n}`, `Course ${n}`, `Service ${n}`, `Ligne ${n}`);
        const tProp = findProp(page.properties, `Time ${n}`, `Heure ${n}`, `Horaire ${n}`, `H${n}`);
        const lProp = findProp(page.properties, `Lieu ${n}`, `Location ${n}`, `Lieu${n}`);
        const aProp = findProp(page.properties, `Arrivée ${n}`, `Arrivee ${n}`, `Arrival ${n}`, `Arrivée${n}`, `Arrivee${n}`);
        if (!rProp && !tProp) continue;
        const tParsed = parseTime(plain(tProp));
        if (!tParsed) continue;
        const rText = (rProp ? plain(rProp) : "") || (rProp ? await relationTitles(rProp, relCache) : "");
        if (!rText) continue;
        const location = (lProp ? plain(lProp) : "") || (lProp ? await relationTitles(lProp, relCache) : "");
        const arrival_time = aProp ? parseTime(plain(aProp)) : null;
        const routeRelId = extractRelationIds(rProp)[0];
        departuresRows.push({
          user_id: userId, notion_page_id: page.id, slot_index: n,
          start_time: tParsed, route: rText, qub, driver, vehicle, location, arrival_time,
          weekdays: tParsed.startsWith("06:15") ? [1] : [1, 2, 3, 4, 5],
          timetable: null,
          route_icon: null,
          _routePageId: routeRelId,
        });
      }
    }

    // Fetch timetable + page icon for each linked Horaire QUB page in parallel.
    const metaCache = new Map<string, RoutePageMeta>();
    const metaIds = new Set<string>();
    for (const r of departuresRows) if (r._routePageId) metaIds.add(r._routePageId);
    await prefetchRoutePageMeta(metaIds, metaCache);

    // For Notion-hosted file icons, download once per route page and persist
    // to the private route-icons bucket. Store a stable proxy URL so the icon
    // does not break when Notion's signed S3 URL expires (~1h).
    const iconUrlByPage = new Map<string, string | null>();
    const fileIconEntries: Array<{ pageId: string; url: string }> = [];
    for (const [pageId, meta] of metaCache) {
      if (!meta.icon) { iconUrlByPage.set(pageId, null); continue; }
      if (meta.icon.kind === "emoji") iconUrlByPage.set(pageId, meta.icon.value);
      else if (meta.icon.kind === "external") iconUrlByPage.set(pageId, meta.icon.url);
      else fileIconEntries.push({ pageId, url: meta.icon.url });
    }
    if (fileIconEntries.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      let j = 0;
      async function uploadWorker() {
        while (j < fileIconEntries.length) {
          const { pageId, url } = fileIconEntries[j++];
          try {
            const resp = await fetch(url);
            if (!resp.ok) { iconUrlByPage.set(pageId, null); continue; }
            const ct = resp.headers.get("content-type") ?? "image/png";
            const extFromCt =
              ct.includes("png") ? "png" :
              ct.includes("jpeg") ? "jpg" :
              ct.includes("gif") ? "gif" :
              ct.includes("webp") ? "webp" :
              ct.includes("svg") ? "svg" : "png";
            const pathInUrl = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
            const extFromUrl = pathInUrl.split(".").pop()?.toLowerCase() ?? "";
            const ext = /^(png|jpg|jpeg|gif|webp|svg)$/.test(extFromUrl) ? (extFromUrl === "jpeg" ? "jpg" : extFromUrl) : extFromCt;
            const fileName = `${pageId.replace(/-/g, "")}.${ext}`;
            const bytes = new Uint8Array(await resp.arrayBuffer());
            const { error: upErr } = await supabaseAdmin.storage
              .from("route-icons")
              .upload(`${userId}/${fileName}`, bytes, { contentType: ct, upsert: true });
            if (upErr) { iconUrlByPage.set(pageId, null); continue; }
            iconUrlByPage.set(pageId, `/api/public/route-icon/${userId}/${fileName}`);
          } catch {
            iconUrlByPage.set(pageId, null);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, fileIconEntries.length) }, uploadWorker));
    }

    for (const r of departuresRows) {
      if (r._routePageId) {
        const m = metaCache.get(r._routePageId);
        r.timetable = m?.timetable ?? null;
        r.route_icon = iconUrlByPage.get(r._routePageId) ?? null;
      }
      delete r._routePageId;
    }


    // Bulk upsert duties in chunks
    for (let i = 0; i < dutiesRows.length; i += 500) {
      const chunk = dutiesRows.slice(i, i + 500);
      const { error } = await supabase
        .from("duties")
        .upsert(chunk, { onConflict: "user_id,notion_page_id" });
      if (error) throw new Error(error.message);
    }

    if (departuresRows.length > 0) {
      const { data: overrides } = await supabase
        .from("departure_overrides")
        .select("notion_page_id,slot_index,weekdays")
        .eq("user_id", userId);
      const ovMap = new Map<string, number[]>();
      for (const o of overrides ?? []) {
        ovMap.set(`${o.notion_page_id}:${o.slot_index}`, o.weekdays as number[]);
      }
      for (const r of departuresRows) {
        const ov = ovMap.get(`${r.notion_page_id}:${r.slot_index}`);
        if (ov) r.weekdays = ov;
      }
      for (let i = 0; i < departuresRows.length; i += 500) {
        const chunk = departuresRows.slice(i, i + 500).map(({ _routePageId, ...rest }) => rest);
        const { error: dErr } = await supabase.from("departures").insert(chunk);
        if (dErr) throw new Error(dErr.message);
      }
    }



    return { upserted, skipped, total: all.length, departures: departuresRows.length };
  });
