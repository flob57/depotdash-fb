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
  let rels: { id: string }[] = [];
  if (prop.type === "relation" && Array.isArray((prop as { relation?: { id: string }[] }).relation)) {
    rels = (prop as { relation: { id: string }[] }).relation;
  } else if (prop.type === "rollup") {
    const arr = (prop as { rollup?: { array?: AnyProp[] } }).rollup?.array ?? [];
    for (const it of arr) {
      if (it.type === "relation" && Array.isArray((it as { relation?: { id: string }[] }).relation)) {
        rels.push(...(it as { relation: { id: string }[] }).relation);
      }
    }
  }
  if (rels.length === 0) return "";
  const out: string[] = [];
  for (const r of rels) {
    if (cache.has(r.id)) { out.push(cache.get(r.id)!); continue; }
    try {
      const page = (await notionFetch(`/pages/${r.id}`)) as { properties: Record<string, AnyProp> };
      const titleKey = Object.keys(page.properties).find((k) => page.properties[k].type === "title");
      const title = titleKey ? plain(page.properties[titleKey]) : "";
      cache.set(r.id, title);
      out.push(title);
    } catch {
      out.push("");
    }
  }
  return out.filter(Boolean).join(", ");
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

    // save db id
    await supabase
      .from("user_notion_settings")
      .upsert({ user_id: userId, services_db_id: dbId }, { onConflict: "user_id" });

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
    let idx = 0;
    for (const page of all) {
      const psRaw = plain(findProp(page.properties, "PS", "Prise de service", "Start"));
      const start = parseTime(psRaw);
      if (!start) { skipped++; continue; }
      const qub = plain(findProp(page.properties, "QUB", "Bus", "Vehicle ref"));
      const driver = plain(findProp(page.properties, "Driver", "Conducteur", "Chauffeur"));
      const route = plain(findProp(page.properties, "Route 1", "Route", "Service", "Ligne"));
      const vehicle = plain(findProp(page.properties, "Vehicle", "Immatriculation", "Plaque"));
      const weekdays = start.startsWith("06:15") ? [1] : [1, 2, 3, 4, 5];

      const { error } = await supabase
        .from("duties")
        .upsert(
          {
            user_id: userId,
            notion_page_id: page.id,
            start_time: start,
            qub,
            driver,
            route,
            vehicle,
            weekdays,
            sort_order: idx++,
          },
          { onConflict: "user_id,notion_page_id" },
        );
      if (error) throw new Error(error.message);
      upserted++;
    }

    return { upserted, skipped, total: all.length };
  });
