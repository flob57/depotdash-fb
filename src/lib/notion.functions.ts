import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/notion/v1";

type NotionProp = { id: string; name: string; type: string };

async function notionFetch(path: string, init: RequestInit = {}) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!NOTION_API_KEY) throw new Error("Notion is not connected");

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": NOTION_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Notion API error [${res.status}]: ${(data as { message?: string }).message ?? JSON.stringify(data)}`,
    );
  }
  return data;
}

const InputSchema = z.object({
  databaseId: z.string().min(1).max(100),
  period: z.enum(["day", "week", "month", "year"]),
});

function rangeFor(period: "day" | "week" | "month" | "year") {
  const now = new Date();
  const from = new Date(now);
  if (period === "day") from.setHours(0, 0, 0, 0);
  else if (period === "week") {
    const day = (from.getDay() + 6) % 7; // Monday=0
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to: now };
}

export const exportSessionsToNotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = rangeFor(data.period);

    // Accept full Notion URL or raw ID; extract the trailing 32-char hex.
    const cleaned = data.databaseId.replace(/-/g, "");
    const matches = cleaned.match(/[0-9a-f]{32}/gi);
    if (!matches || matches.length === 0) {
      throw new Error("Could not find a Notion database ID in the value provided.");
    }
    const databaseId = matches[matches.length - 1];

    const { data: sessions, error } = await supabase
      .from("driving_sessions")
      .select("id, start_at, end_at, km_start, km_end, bus_reference")
      .eq("user_id", userId)
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString())
      .order("start_at", { ascending: true });

    if (error) throw new Error(error.message);
    if (!sessions || sessions.length === 0) {
      return { exported: 0, skipped: 0, total: 0 };
    }

    // Inspect the target database to discover available properties.
    // If the ID actually refers to a page, look for a child database inside it.
    let resolvedDbId = databaseId;
    let db: { properties: Record<string, NotionProp> };
    try {
      db = await notionFetch(`/databases/${resolvedDbId}`) as typeof db;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/is a page/i.test(msg)) throw e;
      // It's a page — find the first child database block.
      const children = await notionFetch(`/blocks/${databaseId}/children?page_size=100`) as {
        results: Array<{ id: string; type: string }>;
      };
      const childDb = children.results.find((b) => b.type === "child_database");
      if (!childDb) {
        throw new Error(
          "That Notion link points to a page with no database inside. Create a database on that page (or share an existing database with the integration) and paste its link.",
        );
      }
      resolvedDbId = childDb.id;
      db = await notionFetch(`/databases/${resolvedDbId}`) as typeof db;
    }
    const propsMap = (db as { properties: Record<string, NotionProp> }).properties;
    const propsByName = Object.entries(propsMap).reduce<Record<string, NotionProp>>(
      (acc, [name, p]) => {
        acc[name.toLowerCase()] = { ...p, name };
        return acc;
      },
      {},
    );
    const titleProp = Object.values(propsMap).find((p) => p.type === "title");
    if (!titleProp) throw new Error("Target Notion database has no title property.");

    const findProp = (name: string, type: string) => {
      const p = propsByName[name.toLowerCase()];
      return p && p.type === type ? p.name : null;
    };

    const busProp = findProp("Bus", "rich_text") ?? findProp("Bus reference", "rich_text");
    const startProp = findProp("Start", "date") ?? findProp("Start at", "date");
    const stopProp = findProp("Stop", "date") ?? findProp("End", "date") ?? findProp("End at", "date");
    const durationProp = findProp("Duration (min)", "number") ?? findProp("Duration", "number");
    const distanceProp = findProp("Distance (km)", "number") ?? findProp("Distance", "number");
    const kmStartProp = findProp("km start", "number") ?? findProp("KM start", "number");
    const kmEndProp = findProp("km end", "number") ?? findProp("KM end", "number");

    let exported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const s of sessions) {
      if (!s.end_at) { skipped++; continue; } // skip live/unfinished sessions
      const start = new Date(s.start_at);
      const end = new Date(s.end_at);
      const durMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const distance = s.km_start != null && s.km_end != null
        ? Math.max(0, s.km_end - s.km_start) : null;
      const title = `${start.toISOString().slice(0, 10)} · ${s.bus_reference ?? "bus"}`;

      const properties: Record<string, unknown> = {
        [titleProp.name]: { title: [{ text: { content: title } }] },
      };
      if (busProp) properties[busProp] = {
        rich_text: [{ text: { content: s.bus_reference ?? "" } }],
      };
      if (startProp) properties[startProp] = { date: { start: start.toISOString() } };
      if (stopProp) properties[stopProp] = { date: { start: end.toISOString() } };
      if (durationProp) properties[durationProp] = { number: durMin };
      if (distanceProp && distance != null) properties[distanceProp] = { number: distance };
      if (kmStartProp && s.km_start != null) properties[kmStartProp] = { number: s.km_start };
      if (kmEndProp && s.km_end != null) properties[kmEndProp] = { number: s.km_end };

      try {
        await notionFetch(`/pages`, {
          method: "POST",
          body: JSON.stringify({
            parent: { database_id: resolvedDbId },
            properties,
          }),
        });
        exported++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }

    return {
      exported,
      skipped,
      total: sessions.length,
      errors: errors.slice(0, 3),
    };
  });
