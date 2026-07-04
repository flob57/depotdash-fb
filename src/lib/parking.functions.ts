import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notionFetch, resolveDatabase } from "@/lib/notion-export.server";

// ---------- Types ----------

export type SpotStatut = "Libre" | "Occupé" | string;
export type SpotType = "standard" | "surcharge" | "VL" | "Mini" | string;

export type ParkingSpot = {
  id: string;
  name: string;
  depot: string;
  x: number | null;
  y: number | null;
  statut: SpotStatut;
  type: SpotType;
  vehicleId: string | null;
  vehicleName: string | null;
};

export type VehicleOption = { id: string; name: string };

// ---------- Helpers ----------

const UUID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function normalize(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

type NotionProp = {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  number?: number | null;
  select?: { name: string } | null;
  status?: { name: string } | null;
  formula?: { type: string; number?: number | null; string?: string | null } | null;
  relation?: Array<{ id: string }>;
};

type NotionPage = { id: string; properties: Record<string, NotionProp> };

type NotionDbProp = { type: string; relation?: { database_id?: string } };
type NotionDb = { properties: Record<string, NotionDbProp> };

function stripAccentsLower(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function findPropByCandidates(
  properties: Record<string, NotionDbProp>,
  candidates: string[],
  allowedTypes?: string[],
): string | null {
  const cands = candidates.map(stripAccentsLower);
  for (const [name, p] of Object.entries(properties)) {
    const n = stripAccentsLower(name);
    if (allowedTypes && !allowedTypes.includes(p.type)) continue;
    if (cands.some((c) => n === c || n.includes(c))) return name;
  }
  return null;
}

function readText(p: NotionProp | undefined): string {
  if (!p) return "";
  if (p.type === "title") return (p.title ?? []).map((t) => t.plain_text).join("").trim();
  if (p.type === "rich_text") return (p.rich_text ?? []).map((t) => t.plain_text).join("").trim();
  if (p.type === "select") return p.select?.name ?? "";
  if (p.type === "status") return p.status?.name ?? "";
  if (p.type === "formula" && p.formula) {
    return (p.formula.string ?? (p.formula.number != null ? String(p.formula.number) : "")) ?? "";
  }
  return "";
}

function readNumber(p: NotionProp | undefined): number | null {
  if (!p) return null;
  if (p.type === "number" && typeof p.number === "number") return p.number;
  if (p.type === "formula" && p.formula?.type === "number" && typeof p.formula.number === "number") {
    return p.formula.number;
  }
  if (p.type === "rich_text") {
    const t = (p.rich_text ?? []).map((r) => r.plain_text).join("").trim();
    const n = Number(t.replace(",", "."));
    return isNaN(n) ? null : n;
  }
  return null;
}

// ---------- Resolve schema ----------

type ParkingSchema = {
  dbId: string;
  nameProp: string; // title
  depotProp: string;
  xProp: string | null;
  yProp: string | null;
  statutProp: string | null;
  typeProp: string | null;
  vehicleProp: string | null;
  vehicleDbId: string | null;
};

async function loadSchema(userId: string, supabase: unknown): Promise<ParkingSchema> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("user_notion_settings")
    .select("parking_db_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.parking_db_id) throw new Error("Parking database not configured.");

  const { id: dbId, db } = (await resolveDatabase(data.parking_db_id)) as unknown as {
    id: string;
    db: NotionDb;
  };
  const props = db.properties;

  // Title (name)
  let nameProp = "";
  for (const [name, p] of Object.entries(props)) {
    if (p.type === "title") { nameProp = name; break; }
  }
  if (!nameProp) throw new Error("Stationnement DB is missing a title property.");

  const depotProp = findPropByCandidates(props, ["depot", "dépôt", "site", "location"]);
  const xProp = findPropByCandidates(props, ["x"], ["number", "formula"]);
  const yProp = findPropByCandidates(props, ["y"], ["number", "formula"]);
  const statutProp = findPropByCandidates(props, ["statut", "status", "state"]);
  const typeProp = findPropByCandidates(props, ["type", "categorie", "catégorie"]);
  const vehicleProp = findPropByCandidates(
    props,
    ["mon parc", "vehicle", "vehicule", "véhicule", "bus", "car"],
    ["relation", "rich_text", "title"],
  );

  if (!depotProp) throw new Error('Missing "Depot" property in Stationnement DB.');

  const vehicleDbId =
    vehicleProp && props[vehicleProp].type === "relation"
      ? props[vehicleProp].relation?.database_id ?? null
      : null;

  return {
    dbId, nameProp, depotProp,
    xProp, yProp, statutProp, typeProp, vehicleProp, vehicleDbId,
  };
}

// ---------- Server functions ----------

async function fetchVehicleName(vehicleId: string): Promise<string> {
  try {
    const page = (await notionFetch(`/pages/${vehicleId}`, { method: "GET" })) as NotionPage;
    const titleEntry = Object.values(page.properties).find((p) => p.type === "title");
    return (titleEntry?.title ?? []).map((t) => t.plain_text).join("").trim() || "—";
  } catch {
    return "—";
  }
}

export const getParkingSpots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const schema = await loadSchema(context.userId, context.supabase);

    const spots: ParkingSpot[] = [];
    const vehicleIds = new Set<string>();
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = (await notionFetch(`/databases/${schema.dbId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };

      for (const page of res.results) {
        const props = page.properties;
        const name = readText(props[schema.nameProp]);
        const depot = readText(props[schema.depotProp]);
        const x = schema.xProp ? readNumber(props[schema.xProp]) : null;
        const y = schema.yProp ? readNumber(props[schema.yProp]) : null;
        const statut = schema.statutProp ? readText(props[schema.statutProp]) : "";
        const type = schema.typeProp ? readText(props[schema.typeProp]) : "";
        let vehicleId: string | null = null;
        if (schema.vehicleProp) {
          const vp = props[schema.vehicleProp];
          if (vp?.type === "relation" && vp.relation && vp.relation.length > 0) {
            vehicleId = vp.relation[0].id;
            vehicleIds.add(vehicleId);
          }
        }
        spots.push({
          id: page.id, name, depot, x, y, statut, type,
          vehicleId, vehicleName: null,
        });
      }
      hasMore = res.has_more;
      cursor = res.next_cursor ?? undefined;
    }

    // Resolve vehicle names in parallel (small N, one Notion fetch per unique id).
    const nameMap = new Map<string, string>();
    await Promise.all(
      [...vehicleIds].map(async (id) => {
        nameMap.set(id, await fetchVehicleName(id));
      }),
    );
    for (const s of spots) {
      if (s.vehicleId) s.vehicleName = nameMap.get(s.vehicleId) ?? "—";
    }
    return { spots, hasVehicleRelation: !!schema.vehicleDbId };
  });

export const listParkingVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const schema = await loadSchema(context.userId, context.supabase);
    if (!schema.vehicleDbId) return { vehicles: [] as VehicleOption[] };
    const vehicles: VehicleOption[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = (await notionFetch(`/databases/${schema.vehicleDbId}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
      for (const page of res.results) {
        const titleEntry = Object.values(page.properties).find((p) => p.type === "title");
        const name = (titleEntry?.title ?? []).map((t) => t.plain_text).join("").trim();
        if (name) vehicles.push({ id: page.id, name });
      }
      hasMore = res.has_more;
      cursor = res.next_cursor ?? undefined;
    }
    vehicles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { vehicles };
  });

// ---------- Mutations (ownership-verified) ----------

async function assertSpotBelongsToUser(
  pageId: string,
  parkingDbId: string,
): Promise<void> {
  const meta = (await notionFetch(`/pages/${pageId}`, { method: "GET" })) as {
    id: string;
    parent?: { type: string; database_id?: string };
  };
  if (normalize(meta.id) !== normalize(pageId)) {
    throw new Error("Notion page not found.");
  }
  const parent = meta.parent?.database_id ? normalize(meta.parent.database_id) : "";
  if (meta.parent?.type !== "database_id" || parent !== normalize(parkingDbId)) {
    throw new Error("Forbidden: spot does not belong to your parking database.");
  }
}

const AssignSchema = z.object({
  pageId: z.string().min(1).max(200).refine((s) => UUID_RE.test(s)),
  vehicleId: z.string().min(1).max(200).refine((s) => UUID_RE.test(s)),
});

const FreeSchema = z.object({
  pageId: z.string().min(1).max(200).refine((s) => UUID_RE.test(s)),
});

export const assignVehicleToSpot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AssignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const schema = await loadSchema(context.userId, context.supabase);
    if (!schema.vehicleProp) throw new Error("No vehicle relation on Stationnement DB.");
    await assertSpotBelongsToUser(data.pageId, schema.dbId);

    // Also verify vehicle belongs to the configured vehicles DB, if any.
    if (schema.vehicleDbId) {
      const vmeta = (await notionFetch(`/pages/${data.vehicleId}`, { method: "GET" })) as {
        parent?: { type: string; database_id?: string };
      };
      if (
        vmeta.parent?.type !== "database_id" ||
        normalize(vmeta.parent.database_id ?? "") !== normalize(schema.vehicleDbId)
      ) {
        throw new Error("Forbidden: vehicle is not in your vehicles database.");
      }
    }

    await notionFetch(`/pages/${data.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          [schema.statutProp]: { status: { name: "Occupé" } },
          [schema.vehicleProp]: { relation: [{ id: data.vehicleId }] },
        },
      }),
    }).catch(async (e) => {
      // Fallback: some setups use "select" instead of "status".
      if (String(e).includes("status")) {
        await notionFetch(`/pages/${data.pageId}`, {
          method: "PATCH",
          body: JSON.stringify({
            properties: {
              [schema.statutProp]: { select: { name: "Occupé" } },
              [schema.vehicleProp!]: { relation: [{ id: data.vehicleId }] },
            },
          }),
        });
        return;
      }
      throw e;
    });
    return { success: true };
  });

export const freeSpot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FreeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const schema = await loadSchema(context.userId, context.supabase);
    await assertSpotBelongsToUser(data.pageId, schema.dbId);

    const properties: Record<string, unknown> = {};
    properties[schema.statutProp] = { status: { name: "Libre" } };
    if (schema.vehicleProp) properties[schema.vehicleProp] = { relation: [] };

    try {
      await notionFetch(`/pages/${data.pageId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
    } catch (e) {
      if (String(e).includes("status")) {
        properties[schema.statutProp] = { select: { name: "Libre" } };
        await notionFetch(`/pages/${data.pageId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });
      } else {
        throw e;
      }
    }
    return { success: true };
  });
