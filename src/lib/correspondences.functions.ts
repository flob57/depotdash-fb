import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notionFetch } from "@/lib/notion-export.server";

type AnyProp = { type: string; [k: string]: unknown };

function plain(prop: AnyProp | undefined): string {
  if (!prop) return "";
  const t = prop.type;
  const v = (prop as Record<string, unknown>)[t];
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x: { plain_text?: string; name?: string }) => x.plain_text ?? x.name ?? "")
      .join("")
      .trim();
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

function extractId(raw: string): string {
  const source = raw.trim();
  let idSource = source;
  try {
    const url = new URL(source);
    idSource = url.pathname;
  } catch {
    /* plain id */
  }
  const cleaned = idSource.replace(/-/g, "");
  const matches = cleaned.match(/[0-9a-f]{32}/gi);
  if (!matches || matches.length === 0) {
    throw new Error("Could not find a Notion page ID in the value provided.");
  }
  return matches[matches.length - 1];
}

function findProp(props: Record<string, AnyProp>, ...names: string[]): AnyProp | undefined {
  const keys = Object.keys(props);
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().trim() === n.toLowerCase().trim());
    if (k) return props[k];
  }
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase().includes(n.toLowerCase()));
    if (k) return props[k];
  }
  return undefined;
}

export type CorrespondenceRow = {
  label: string;
  course: string;
  depart_time: string | null;
  depart_stop: string;
  arrival_time: string | null;
  arrival_stop: string;
};

export type Interchange = {
  database_id: string;
  name: string;
  rows: CorrespondenceRow[];
};

export const getCorrespondences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pageId: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data }): Promise<{ interchanges: Interchange[] }> => {
    const pageId = extractId(data.pageId);

    type Block = {
      id: string;
      type: string;
      child_database?: { title?: string };
    };
    const children = (await notionFetch(`/blocks/${pageId}/children?page_size=100`)) as {
      results: Block[];
    };
    const dbs = children.results.filter((b) => b.type === "child_database");

    // Resolve relation cache for "Horaire QUB" linked pages.
    const relCache = new Map<
      string,
      { title: string; depart_time: string | null; depart_stop: string; arrival_time: string | null; arrival_stop: string }
    >();

    type DbRow = { id: string; properties: Record<string, AnyProp> };
    const interchanges: Interchange[] = [];

    for (const db of dbs) {
      const queryRes = (await notionFetch(`/databases/${db.id}/query`, {
        method: "POST",
        body: JSON.stringify({ page_size: 100 }),
      })) as { results: DbRow[] };

      // Collect relation ids to resolve in parallel.
      const relIds = new Set<string>();
      for (const row of queryRes.results) {
        const rel = findProp(row.properties, "Horaire QUB", "Horaire", "QUB");
        if (rel?.type === "relation") {
          for (const r of (rel as unknown as { relation: { id: string }[] }).relation) {
            relIds.add(r.id);
          }
        }
      }
      await Promise.all(
        Array.from(relIds).map(async (id) => {
          if (relCache.has(id)) return;
          try {
            const page = (await notionFetch(`/pages/${id}`)) as {
              properties: Record<string, AnyProp>;
            };
            const titleKey = Object.keys(page.properties).find(
              (k) => page.properties[k].type === "title",
            );
            relCache.set(id, {
              title: titleKey ? plain(page.properties[titleKey]) : "",
              depart_time: plain(findProp(page.properties, "Horaire depart", "Horaire départ")) || null,
              depart_stop: plain(findProp(page.properties, "Arret depart", "Arrêt départ", "Arret départ")),
              arrival_time: plain(findProp(page.properties, "Horaire arrivee", "Horaire arrivée")) || null,
              arrival_stop: plain(findProp(page.properties, "Arret arrivee", "Arrêt arrivée", "Arret arrivée")),
            });
          } catch {
            relCache.set(id, { title: "", depart_time: null, depart_stop: "", arrival_time: null, arrival_stop: "" });
          }
        }),
      );

      const rows: CorrespondenceRow[] = [];
      for (const row of queryRes.results) {
        const titleKey = Object.keys(row.properties).find((k) => row.properties[k].type === "title");
        const label = titleKey ? plain(row.properties[titleKey]) : "";
        const rel = findProp(row.properties, "Horaire QUB", "Horaire", "QUB");
        const relIdList = rel?.type === "relation"
          ? (rel as unknown as { relation: { id: string }[] }).relation.map((r) => r.id)
          : [];
        if (relIdList.length === 0) {
          rows.push({ label, course: "", depart_time: null, depart_stop: "", arrival_time: null, arrival_stop: "" });
          continue;
        }
        for (const rid of relIdList) {
          const info = relCache.get(rid);
          rows.push({
            label,
            course: info?.title ?? "",
            depart_time: info?.depart_time ?? null,
            depart_stop: info?.depart_stop ?? "",
            arrival_time: info?.arrival_time ?? null,
            arrival_stop: info?.arrival_stop ?? "",
          });
        }
      }

      // Sort rows by depart_time then label
      rows.sort((a, b) => {
        const ta = a.depart_time ?? "";
        const tb = b.depart_time ?? "";
        if (ta && tb && ta !== tb) return ta.localeCompare(tb);
        return a.label.localeCompare(b.label);
      });

      interchanges.push({
        database_id: db.id,
        name: db.child_database?.title ?? "Sans nom",
        rows,
      });
    }

    interchanges.sort((a, b) => a.name.localeCompare(b.name));
    return { interchanges };
  });
