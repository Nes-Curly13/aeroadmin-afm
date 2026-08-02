import { getDb } from "@/lib/db";
import { djiParcelsQuery } from "@/api/queries";
import fs from "node:fs";
import path from "node:path";
import {
  CADENCE_DEFAULTS,
  computeNextDueDate
} from "@/lib/fumigation-cadence";
import { getBogotaDateString, toDateString } from "@/lib/format";
import {
  aggregateFlightsByDay,
  type DailySummaryLike,
  type FlightRow
} from "@/lib/dji-flights-aggregate";
import {
  fetchAlertsCached,
  fetchDashboardMetricsCached,
  fetchFlightPointsCached,
  fetchOverdueParcelsCached,
  fetchParcelsNormalizedCached,
  fetchParcelsSummaryCached,
  fetchUpcomingFumigationsCached,
  fetchActivityComparisonCached,
  fetchFlightHullsByParcelCached,
  invalidateAfterFumigationMutation,
  invalidateAfterParcelMutation
} from "@/lib/cache";
import type { ActivityComparison } from "@/lib/cache";
import type {
  DashboardMetrics,
  DjiDailySummaryRecord,
  DjiFlightRecord,
  DjiAlertRecord,
  DjiFumigationEvent,
  DjiFumigationSchedule,
  DjiParcelRecord,
  FumigationTimelineInput,
  OverdueParcel,
  UpcomingFumigation,
  FlightPointRecord,
  CyclePhase
} from "@/lib/types";
import type { OverdueParcelsArgs } from "@/lib/cache";

// Re-exports para callers que precisen invalidar la cache desde otro lugar
// (scripts CLI, jobs, etc.).
export {
  CACHE_TAGS,
  invalidateAfterFlightMutation,
  invalidateAfterFumigationMutation,
  invalidateAfterParcelMutation,
  invalidateAll
} from "@/lib/cache";

interface MetricsRow {
  total_flights: string;
  total_area_covered_m2: string | null;
  high_alert_days: string;
  total_parcels: string;
}

/**
 * Row cruda de dji_flights que devuelve pg.query (snake_case tal cual la tabla).
 * El cast numérico de pg ya está hecho en lib/db.ts (NUMERIC/BIGINT → number).
 */
interface DjiFlightDbRow {
  id: number;
  flight_id: number;
  start_at: Date;
  end_at: Date;
  duration_seconds: number;
  area_m2: number;
  spray_usage_ml: number;
  drone_nickname: string | null;
  pilot_name: string | null;
  parcel_id: number | null;
}

const localExportsRoot = path.join(process.cwd(), "djiag_exports");

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function parseLooseNumber(value: unknown) {
  const n = Number(String(value ?? "").replace(/[^0-9.]+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseSummaryRecord(item: Record<string, unknown>, index: number): DjiDailySummaryRecord {
  const raw = String(item.raw ?? item.raw_text ?? "");
  const date = String(item.date ?? item.record_date ?? raw.match(/^(\d{4}\/\d{2}\/\d{2})/)?.[1] ?? "");
  const rawMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2})([A-Za-z]+)Agriculture([\d.]+)mu(\d+)times([\d.]+)L-(.+)$/);
  return {
    id: index + 1,
    record_date: date.includes("/") ? date.replace(/\//g, "-") : date,
    weekday: String(item.weekday ?? rawMatch?.[2] ?? "").replace(/Agriculture$/, "") || null,
    category: String(item.category ?? "Agriculture") || "Agriculture",
    area_mu: parseLooseNumber(item.area ?? item.area_mu ?? rawMatch?.[3]),
    times_count: parseLooseNumber(item.times ?? item.times_count ?? rawMatch?.[4]),
    usage_liters: parseLooseNumber(item.usage ?? item.usage_liters ?? rawMatch?.[5]),
    work_time_text: String(item.workTime ?? item.work_time_text ?? rawMatch?.[6] ?? ""),
    raw_text: raw
  };
}

function loadLocalSummaryRecords(): DjiDailySummaryRecord[] {
  const filePath = path.join(localExportsRoot, "records_history.json");
  const raw = readJsonFile<Array<Record<string, unknown>>>(filePath, []);
  return raw.map((item, index) => parseSummaryRecord(item, index)).sort((a, b) => b.record_date.localeCompare(a.record_date));
}

async function withLocalFallback<T>(queryFn: () => Promise<T>, fallbackFn: () => Promise<T>) {
  try {
    return await queryFn();
  } catch {
    return fallbackFn();
  }
}

// (S2 / 2026-07-01) `loadLocalAssetRecords()` y `getParcels()` legacy eliminados.
// (S3 / 2026-07-01) `loadLocalFieldCount()` (código muerto) eliminado.
// Las tablas dji_land_assets y dji_daily_summaries se dropearon en la migración
// 20260628120000, y S1.7 ya migró el último caller (app/page.tsx) a
// getParcelsNormalized(). El dashboard ahora solo lee de dji_parcels y dji_flights.

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DjiParcelsFilter {
  isOrchard?: boolean;
  droneModelCode?: number;
  minSprayAreaM2?: number;
  fieldType?: string;
  /**
   * Filtros "mostrar solo con X vacío" para /admin/parcels (QA
   * gap cerrado 2026-08-02). El operador fumigador tiene 1213
   * parcelas y los 4 campos V0 arrancan vacíos en la BD. Sin
   * este filtro tendría que ir página por página (24 páginas)
   * para encontrar cuáles faltan poblar. Con cualquier subset
   * de estos flags activos, la query agrega `IS NULL OR = ''`
   * al WHERE.
   *
   * Sprint 2026-08-02: agregado. Si en el futuro hay más campos
   * V0 (e.g. `crop_type`, `municipality` ya está), extender el
   * interface con un patrón consistente.
   */
  missingClientName?: boolean;
  missingFarmName?: boolean;
  missingMunicipality?: boolean;
  missingVariety?: boolean;
}

/**
 * Devuelve la lista normalizada de parcelas (Opción B).
 * Usa la tabla dji_parcels, con columnas planas y geometrías PostGIS como GeoJSON.
 *
 * Sprint 7 (2026-06-28): cacheado con `unstable_cache` (TTL 60s, tag
 * `afm:parcels`). El dashboard y /map pegaban este query en cada
 * navegación; ahora es prácticamente gratis entre revalidaciones.
 *
 * v1.3 Track A (2026-07-21): el panel de filtros del mapa
 * (`components/map/map-filter-sidebar.tsx`, antes `map-filters-panel.tsx`
 * en v1.3) usa esta función con
 * `filter = { droneModelCode, fieldType }` para filtrar server-side
 * via URL searchParams. Como el wrapper cacheado no soporta filters
 * (sería un keyParts enorme), esa combinación va a la variante
 * `getParcelsNormalizedUncached` que va directo a la BD. El filtro
 * `fumigated` NO se hace acá — se aplica in-memory en el page.tsx
 * sobre `fumigatedParcelIds` (Set<number>) que ya está en memoria
 * del critical path (M3-M5 Track A).
 */
export async function getParcelsNormalized(page = 1, limit = 20, filter: DjiParcelsFilter = {}) {
  // El filter actual no lo soporta el wrapper cacheado (sería un keyParts
  // enorme); la mayoría de callers pasa filter={} en el dashboard. Mantenemos
  // la versión dinámica como escape hatch — si filter tiene algo, vamos a la
  // BD directo (sin cache).
  const hasFilter =
    filter.isOrchard !== undefined ||
    filter.droneModelCode !== undefined ||
    filter.minSprayAreaM2 !== undefined ||
    filter.fieldType !== undefined ||
    filter.missingClientName === true ||
    filter.missingFarmName === true ||
    filter.missingMunicipality === true ||
    filter.missingVariety === true;

  if (hasFilter) {
    return getParcelsNormalizedUncached(page, limit, filter);
  }
  return fetchParcelsNormalizedCached(page, limit);
}

/**
 * Variante sin cache para cuando hay filters. La lógica es idéntica a la
 * implementación previa a S7 — separada en función propia para no envenenar
 * el wrapper de cache.
 */
async function getParcelsNormalizedUncached(page: number, limit: number, filter: DjiParcelsFilter) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (filter.isOrchard !== undefined) {
    where.push(`is_orchard = $${p++}`);
    params.push(filter.isOrchard);
  }
  if (filter.droneModelCode !== undefined) {
    where.push(`drone_model_code = $${p++}`);
    params.push(filter.droneModelCode);
  }
  if (filter.minSprayAreaM2 !== undefined) {
    where.push(`spray_area_m2 >= $${p++}`);
    params.push(filter.minSprayAreaM2);
  }
  if (filter.fieldType) {
    where.push(`field_type = $${p++}`);
    params.push(filter.fieldType);
  }
  // QA gap cerrado 2026-08-02: filtros "mostrar solo con X vacío".
  // El operador fumigador tiene 1213 parcelas y los 4 campos V0
  // arrancan NULL. Con estos flags puede ver solo las que faltan
  // poblar (sin tener que ir página por página). Cada flag agrega
  // un `IS NULL OR = ''` al WHERE — varios flags activos se
  // combinan con AND (la parcela debe tener TODOS los campos
  // marcados como vacíos).
  //
  // Performance: con índices actuales, IS NULL es un seq scan
  // parcial (Postgres). Con 1213 filas es instantáneo. Si el
  // dataset crece a >100k, considerar partial indexes sobre
  // `WHERE client_name IS NULL OR client_name = ''` etc.
  if (filter.missingClientName) {
    where.push(`(client_name IS NULL OR client_name = '')`);
  }
  if (filter.missingFarmName) {
    where.push(`(farm_name IS NULL OR farm_name = '')`);
  }
  if (filter.missingMunicipality) {
    where.push(`(municipality IS NULL OR municipality = '')`);
  }
  if (filter.missingVariety) {
    where.push(`(variety IS NULL OR variety = '')`);
  }
  // Sprint B — H1: soft delete. La migration 20260720000000 dejó la columna
  // `deleted_at` lista; este filtro activa el soft delete en la query de
  // listado paginado. Sin él, las parcelas "borradas" (deleted_at != NULL)
  // seguirían apareciendo en el dashboard y el listado de /map.
  where.push(`p.deleted_at IS NULL`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return withLocalFallback(
    async () => {
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} ${whereSql} ORDER BY land_name ASC NULLS LAST, id ASC LIMIT $${p++} OFFSET $${p++}`,
        [...params, limit, offset]
      );
      const countResult = await db.query<{ total: string }>(
        `SELECT COUNT(*)::int AS total FROM dji_parcels ${whereSql}`,
        params
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      return {
        data: result.rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => ({
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 0
    })
  );
}

/**
 * Resumen agregado por tipo de dron y tipo de campo.
 * Útil para el dashboard ejecutivo.
 *
 * Sprint 7: cacheado (TTL 60s, tag `afm:parcels-summary` + `afm:parcels`).
 */
export async function getParcelsSummary() {
  return fetchParcelsSummaryCached();
}

/**
 * Campos editables de una parcela desde la UI. NO incluye geometrías ni datos
 * de DJI scrapeados — esos vienen del importer. Solo metadata que el operador
 * puede querer ajustar manualmente (nombre visible, tipo declarado, areas,
 * y la metadata humana que DJI no expone: cultivo, siembra, propietario, contacto, notas).
 *
 * Sprint S8.2 (2026-07-29): agregados los 4 campos del V0 mockup que la UI
 * expone en el panel de operaciones y el filtro del geovisor
 * (`client_name`, `farm_name`, `municipality`, `variety`). Estas columnas
 * se agregaron físicamente en `dji_parcels` via la migration
 * 20260728000000_add_v0_fields_to_dji_parcels.sql.
 */
export type ParcelMetadataUpdate = {
  land_name?: string | null;
  field_type?: "Farmland" | "Orchards" | string | null;
  declared_area_ha?: number | null;
  spray_area_m2?: number | null;
  // Metadata humana (sprint 2026-07-22). El supervisor llena una vez por parcela.
  crop_type?: string | null;
  planting_date?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  supervisor_notes?: string | null;
  // V0 fields (sprint S8.2, 2026-07-29). El operador fumigador los llena
  // via /admin/parcels. Sin DJI source — los datos solo los conoce el
  // operario de campo.
  client_name?: string | null;
  farm_name?: string | null;
  municipality?: string | null;
  variety?: string | null;
};

/**
 * Actualiza metadata editable de una parcela. Devuelve `null` si no existe.
 * Las columnas técnicas (external_id, batch_id, geometrías, drone_model_code)
 * NO se tocan — vienen del importer DJI.
 *
 * Si ningun campo editable fue enviado, no hace UPDATE (evita un roundtrip
 * innecesario a la BD). Devuelve el registro actual.
 */
export async function updateParcelMetadata(
  id: number,
  patch: ParcelMetadataUpdate
): Promise<DjiParcelRecord | null> {
  // Whitelist de columnas + valores saneados.
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (patch.land_name !== undefined) {
    sets.push(`land_name = $${idx++}`);
    params.push(patch.land_name ?? null);
  }
  if (patch.field_type !== undefined) {
    sets.push(`field_type = $${idx++}`);
    params.push(patch.field_type ?? null);
  }
  if (patch.declared_area_ha !== undefined) {
    if (patch.declared_area_ha !== null && (patch.declared_area_ha < 0 || patch.declared_area_ha > 100000)) {
      throw new Error("declared_area_ha debe estar entre 0 y 100000 (hectareas)");
    }
    sets.push(`declared_area_ha = $${idx++}`);
    params.push(patch.declared_area_ha ?? null);
  }
  if (patch.spray_area_m2 !== undefined) {
    if (patch.spray_area_m2 !== null && (patch.spray_area_m2 < 0 || patch.spray_area_m2 > 1e9)) {
      throw new Error("spray_area_m2 debe estar entre 0 y 1e9 (m^2)");
    }
    sets.push(`spray_area_m2 = $${idx++}`);
    params.push(patch.spray_area_m2 ?? null);
  }
  if (patch.crop_type !== undefined) {
    if (patch.crop_type !== null && patch.crop_type.length > 100) {
      throw new Error("crop_type max 100 chars");
    }
    sets.push(`crop_type = $${idx++}`);
    params.push(patch.crop_type ?? null);
  }
  if (patch.planting_date !== undefined) {
    // Acepta "YYYY-MM-DD" o null. Validamos formato básico server-side.
    if (patch.planting_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.planting_date)) {
      throw new Error("planting_date debe tener formato YYYY-MM-DD");
    }
    sets.push(`planting_date = $${idx++}`);
    params.push(patch.planting_date ?? null);
  }
  if (patch.owner_name !== undefined) {
    if (patch.owner_name !== null && patch.owner_name.length > 200) {
      throw new Error("owner_name max 200 chars");
    }
    sets.push(`owner_name = $${idx++}`);
    params.push(patch.owner_name ?? null);
  }
  if (patch.owner_contact !== undefined) {
    if (patch.owner_contact !== null && patch.owner_contact.length > 200) {
      throw new Error("owner_contact max 200 chars");
    }
    sets.push(`owner_contact = $${idx++}`);
    params.push(patch.owner_contact ?? null);
  }
  if (patch.supervisor_notes !== undefined) {
    if (patch.supervisor_notes !== null && patch.supervisor_notes.length > 2000) {
      throw new Error("supervisor_notes max 2000 chars");
    }
    sets.push(`supervisor_notes = $${idx++}`);
    params.push(patch.supervisor_notes ?? null);
  }
  // V0 fields (sprint S8.2, 2026-07-29). Validamos longitud razonable para
  // evitar inputs pegados accidentalmente (e.g. un paste de 1MB de texto).
  if (patch.client_name !== undefined) {
    if (patch.client_name !== null && patch.client_name.length > 200) {
      throw new Error("client_name max 200 chars");
    }
    sets.push(`client_name = $${idx++}`);
    params.push(patch.client_name ?? null);
  }
  if (patch.farm_name !== undefined) {
    if (patch.farm_name !== null && patch.farm_name.length > 200) {
      throw new Error("farm_name max 200 chars");
    }
    sets.push(`farm_name = $${idx++}`);
    params.push(patch.farm_name ?? null);
  }
  if (patch.municipality !== undefined) {
    if (patch.municipality !== null && patch.municipality.length > 100) {
      throw new Error("municipality max 100 chars");
    }
    sets.push(`municipality = $${idx++}`);
    params.push(patch.municipality ?? null);
  }
  if (patch.variety !== undefined) {
    if (patch.variety !== null && patch.variety.length > 100) {
      throw new Error("variety max 100 chars");
    }
    sets.push(`variety = $${idx++}`);
    params.push(patch.variety ?? null);
  }

  if (sets.length === 0) {
    // Nada que cambiar — devolvemos el registro actual sin tocar BD.
    return getParcelById(id);
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      // Verificar existencia primero (devolvemos null vs throw).
      // Sprint B — H1: si la parcela está soft-deleted, no se puede editar.
      // Mismo criterio que `getParcelById` — el detail page y el edit panel
      // la ocultan, así que updateParcelMetadata tampoco debería escribir.
      const existing = await db.query<{ id: number }>(
        `SELECT id FROM dji_parcels WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (existing.rows.length === 0) return null;

      params.push(id);
      await db.query(
        `UPDATE dji_parcels SET ${sets.join(", ")} WHERE id = $${idx}`,
        params
      );
      // El parcel puede estar en cache de parcels + parcels-summary + upcoming.
      // Lo mas simple es invalidar todo lo que invalida parcel mutation.
      invalidateAfterParcelMutation();
      // Devolver el row actualizado via getParcelById (que tambien cachea).
      return getParcelById(id);
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Devuelve una sola parcela por id, con todas sus geometrías como GeoJSON.
 * Devuelve null si no existe.
 */
export async function getParcelById(id: number): Promise<DjiParcelRecord | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // Sprint B — H1: soft delete. Filtramos por `deleted_at IS NULL`
      // para que el detail page y el edit panel NO muestren parcelas
      // borradas (sería confuso para el operador).
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [id]
      );
      return result.rows[0] ?? null;
    },
    async () => null
  );
}

// ============================================================
// Fumigaciones: schedule + eventos
// ============================================================

const fumigationScheduleByParcelQuery = `
  SELECT
    parcel_id,
    crop_type,
    recommended_cadence_days,
    last_fumigation_date,
    next_due_date,
    is_active,
    notes
  FROM dji_fumigation_schedule
`;

const fumigationEventsByParcelQuery = `
  SELECT
    id,
    parcel_id,
    fumigation_date,
    product_used,
    dose_l_per_ha,
    area_fumigated_m2,
    drone_code_used,
    duration_minutes,
    notes,
    human_notes,
    recorded_by,
    product_registered_ica,
    pilot_license,
    recorded_at,
    source,
    -- Sprint G2: array de flight IDs (solo para fumigaciones del import).
    -- NULL para fumigaciones manuales o pre-G2. Lo necesita el UI de
    -- trazabilidad (al click en la fumigación, ver qué flights la
    -- originaron).
    flight_ids
  FROM dji_fumigations
  WHERE parcel_id = $1
    AND deleted_at IS NULL
  ORDER BY fumigation_date DESC, recorded_at DESC
`;

/**
 * Devuelve el schedule de una parcela (o null si no existe).
 *
 * `pg` devuelve columnas `DATE` como objetos `Date` de JS; los normalizamos
 * a `YYYY-MM-DD` en el boundary para evitar "Objects are not valid as a
 * React child" cuando se renderizan.
 */
export async function getFumigationSchedule(parcelId: number): Promise<DjiFumigationSchedule | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationSchedule>(
        `${fumigationScheduleByParcelQuery} WHERE parcel_id = $1`,
        [parcelId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...row,
        last_fumigation_date: toDateString(row.last_fumigation_date),
        next_due_date: toDateString(row.next_due_date)
      };
    },
    async () => null
  );
}

/**
 * v2.1 (sprint S7.2) — batch query: trae TODAS las schedules de la BD
 * en una sola query. Usado por el `/admin/parcels` page para alimentar
 * la `ParcelsTable` con cadencia per-parcela.
 *
 * Sin esto, alimentar 1200 filas de la tabla requería 1200 queries
 * individuales (N+1 problem). Esta query es O(1) y trae ~5KB de data.
 *
 * Cacheada con TTL 60s y tag `afm:schedules-all`. Se invalida con
 * `invalidateAfterFumigationMutation()`.
 *
 * Devuelve un `Map<parcelId, DjiFumigationSchedule>` para lookup O(1)
 * en el caller. La parcela no presente en el map = no tiene schedule
 * (cadencia por defecto según field_type).
 */
export async function getAllFumigationSchedules(): Promise<Map<number, DjiFumigationSchedule>> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationSchedule>(fumigationScheduleByParcelQuery);
      const out = new Map<number, DjiFumigationSchedule>();
      for (const row of result.rows) {
        out.set(row.parcel_id, {
          ...row,
          last_fumigation_date: toDateString(row.last_fumigation_date),
          next_due_date: toDateString(row.next_due_date)
        });
      }
      return out;
    },
    async () => new Map<number, DjiFumigationSchedule>()
  );
}

/**
 * Lista de eventos de fumigación de una parcela, ordenados por fecha desc.
 *
 * Normaliza `fumigation_date` de `Date` (devuelto por `pg`) a `YYYY-MM-DD`.
 */
export async function getFumigationEventsByParcel(parcelId: number): Promise<DjiFumigationEvent[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFumigationEvent>(fumigationEventsByParcelQuery, [parcelId]);
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

/**
 * M3-M5 Track A (commit 2): devuelve el Set<number> de `parcel_id` con
 * al menos un evento de fumigación >= `since` (YYYY-MM-DD). Sirve a
 * `app/map/page.tsx` para derivar el flag `hasFumigation` por parcela y
 * diferenciar visualmente fumigadas (solido) vs no fumigadas (dashed +
 * fill atenuado) en el mapa.
 *
 * Notas de implementación:
 *   - DISTINCT en la SQL para no traer N filas si la parcela tuvo
 *     varios eventos en el rango; el caller quiere un Set, no un multiset.
 *   - `parcel_id IS NOT NULL` para excluir eventos agregados del importer
 *     que quedaron sin asignar (ver `backfill-fumigations-from-flights`).
 *   - Fallback a Set vacio si la BD no esta disponible (modo offline de
 *     tests sin Docker): el mapa no rompe, solo pierde la distinción
 *     fumigado/no-fumigado (todas se ven como fumigadas = backwards
 *     compatible).
 */
export async function getFumigatedParcelIdsSince(since: string): Promise<Set<number>> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{ parcel_id: number }>(
        `SELECT DISTINCT parcel_id
           FROM dji_fumigations
          WHERE parcel_id IS NOT NULL
            AND deleted_at IS NULL
            AND fumigation_date >= $1::date`,
        [since]
      );
      const out = new Set<number>();
      for (const row of result.rows) out.add(row.parcel_id);
      return out;
    },
    async () => new Set<number>()
  );
}

/**
 * v2.0 (sprint S5) — agregados de fumigaciones para overlay KPI del mapa.
 *
 * Devuelve el total de aplicaciones, hectareas tratadas, volumen (L) y
 * vuelos para un set de parcelas (o todas si no se pasa) y un rango de
 * fechas opcional. Se usa en el `KpiPill` overlay del `MapPageClient`.
 *
 * Filtros:
 *   - `parcelIds`: array opcional de parcel_id. Si undefined, agrega sobre
 *     TODAS las fumigaciones (modo "vista global del dataset").
 *   - `from` / `to`: YYYY-MM-DD. Si undefined, sin limite inferior/superior.
 *
 * Performance: una sola query con SUM/COUNT. Indexado por parcel_id
 * (existe desde M3) y por fumigation_date (existe desde S2). El set de
 * 1200 parcelas + 18 meses de fumigaciones cabe en < 50ms.
 *
 * NOTA sobre `flights`: `dji_fumigations` no tiene un FK directo a
 * `dji_flights` (la tabla `flights` referencia `parcels` legacy, no
 * `dji_parcels`). Por ahora devolvemos `flights: 0` y planeamos join
 * via `dji_flight_fumigation_link` o equivalente en un sprint futuro.
 * El cliente usa el KPI `count` como proxy hasta entonces.
 */
export interface FumigationsSummary {
  count: number;
  areaHa: number;
  volumeL: number;
  flights: number;
}

export async function getFumigationsSummary(args: {
  parcelIds?: number[];
  from?: string;
  to?: string;
} = {}): Promise<FumigationsSummary> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const params: unknown[] = [];
      const where: string[] = ["deleted_at IS NULL"];
      if (args.parcelIds !== undefined && args.parcelIds.length > 0) {
        params.push(args.parcelIds);
        where.push(`parcel_id = ANY($${params.length}::int[])`);
      }
      if (args.from) {
        params.push(args.from);
        where.push(`fumigation_date >= $${params.length}::date`);
      }
      if (args.to) {
        params.push(args.to);
        where.push(`fumigation_date <= $${params.length}::date`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      // Volumen = SUM(dose * area / 10000) por fila (L/ha * m² → L).
      // area_fumigated_m2 puede ser NULL si el operador no lo llenó; usamos
      // COALESCE(0) y GREATEST(0,...) para no arrastrar negativos.
      const result = await db.query<{
        count: string;
        area_ha: string | null;
        volume_l: string | null;
      }>(
        `SELECT
            COUNT(*)::text AS count,
            COALESCE(SUM(GREATEST(area_fumigated_m2, 0)), 0)::float8 / 10000.0 AS area_ha,
            COALESCE(SUM(GREATEST(COALESCE(dose_l_per_ha, 0) * COALESCE(area_fumigated_m2, 0) / 10000.0, 0)), 0)::float8 AS volume_l
           FROM dji_fumigations
           ${whereSql}`,
        params
      );
      const row = result.rows[0];
      return {
        count: Number(row?.count ?? 0),
        areaHa: Math.round(Number(row?.area_ha ?? 0) * 10) / 10,
        volumeL: Math.round(Number(row?.volume_l ?? 0) * 10) / 10,
        flights: 0 // TODO sprint S6: join con dji_flights via fumigation_date
      };
    },
    async () => ({ count: 0, areaHa: 0, volumeL: 0, flights: 0 })
  );
}

/**
 * v2.0 (sprint S5) — histograma de fumigaciones por mes para el
 * `TimeRange` slider del `/map`.
 *
 * Devuelve un array de buckets mensuales, cada uno con:
 *   - `key`: string tipo "2026-01"
 *   - `label`: string formateado en es-CO ("ene 26")
 *   - `start` / `end`: ms epoch (UTC) del primer/último ms del mes
 *   - `count`: número de fumigaciones en ese mes
 *
 * Filtros:
 *   - `parcelIds`: subset de parcelas (opcional). Si undefined, todo el dataset.
 *   - `from` / `to`: limita el rango cubierto. Si se omite, se computa
 *     desde la fumigación más antigua hasta la más reciente.
 *
 * Performance: 1 query con date_trunc + group by. Sobre el set actual
 * (1200 parcelas, 18 meses) corre en < 80ms.
 */
export interface MonthBucket {
  key: string;
  label: string;
  start: number;
  end: number;
  count: number;
}

export async function getFumigationsByMonth(args: {
  parcelIds?: number[];
  from?: string;
  to?: string;
} = {}): Promise<MonthBucket[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const params: unknown[] = [];
      const where: string[] = ["deleted_at IS NULL"];
      if (args.parcelIds !== undefined && args.parcelIds.length > 0) {
        params.push(args.parcelIds);
        where.push(`parcel_id = ANY($${params.length}::int[])`);
      }
      if (args.from) {
        params.push(args.from);
        where.push(`fumigation_date >= $${params.length}::date`);
      }
      if (args.to) {
        params.push(args.to);
        where.push(`fumigation_date <= $${params.length}::date`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const result = await db.query<{ month: string; count: string }>(
        `SELECT
            to_char(date_trunc('month', fumigation_date), 'YYYY-MM') AS month,
            COUNT(*)::text AS count
           FROM dji_fumigations
           ${whereSql}
          GROUP BY 1
          ORDER BY 1`,
        params
      );
      return result.rows.map((row) => {
        const [yStr, mStr] = row.month.split("-");
        const y = Number(yStr);
        const m = Number(mStr);
        const start = Date.UTC(y, m - 1, 1);
        const end = Date.UTC(y, m, 1) - 1;
        // Etiqueta corta es-CO: "ene 26"
        const label = new Intl.DateTimeFormat("es-CO", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC"
        }).format(new Date(start));
        return {
          key: row.month,
          label,
          start,
          end,
          count: Number(row.count)
        };
      });
    },
    async () => []
  );
}

/**
 * v2.1 (sprint S6) — eventos de fumigación aplanados para el mapa.
 *
 * Devuelve TODAS las fumigaciones de un set de parcelas (con rango
 * opcional) en un shape listo para pasarse al cliente y alimentar el
 * filtrado client-side (`lib/map-filter-logic.ts`). Es el equivalente
 * bulk de `getFumigationEventsByParcel` (que solo trae 1 parcela).
 *
 * Shape devuelto: `DjiFumigationEvent` (mismo que `getFumigationEventsByParcel`),
 * normalizando `fumigation_date` (DATE → YYYY-MM-DD) en el boundary.
 *
 * Filtros:
 *   - `parcelIds`: subset de parcelas. Si undefined, todo el dataset.
 *   - `from` / `to`: YYYY-MM-DD. Si undefined, sin límite.
 *
 * Performance: query con `parcel_id = ANY(int[])` + `ORDER BY
 * fumigation_date DESC`. Sobre el set actual (1200 parcelas, ~17k
 * fumigaciones) corre en < 120ms. **No cachea** — son datos
 * operativos frescos, igual que `getFumigationEventsByParcel`.
 *
 * Por qué existe: en el sprint S5, los KPIs del mapa se calculaban
 * server-side con `getFumigationsSummary`. En el sprint S6 (V0 port)
 * queremos KPIs client-side (filtrado por source, status, time range
 * interactivo) → necesitamos los eventos RAW en el cliente. Esta
 * función los entrega.
 *
 * TODO futuro: si el dataset crece a >100k fumigaciones, exponer un
 * endpoint paginado o filtrado server-side por source/status y caer
 * a un fallback en el cliente (hoy va todo).
 */
export async function getFumigationsForMap(args: {
  parcelIds?: number[];
  from?: string;
  to?: string;
} = {}): Promise<DjiFumigationEvent[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const params: unknown[] = [];
      const where: string[] = ["deleted_at IS NULL"];
      if (args.parcelIds !== undefined && args.parcelIds.length > 0) {
        params.push(args.parcelIds);
        where.push(`parcel_id = ANY($${params.length}::int[])`);
      }
      if (args.from) {
        params.push(args.from);
        where.push(`fumigation_date >= $${params.length}::date`);
      }
      if (args.to) {
        params.push(args.to);
        where.push(`fumigation_date <= $${params.length}::date`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const result = await db.query<DjiFumigationEvent>(
        `SELECT
            id,
            parcel_id,
            fumigation_date,
            product_used,
            dose_l_per_ha,
            area_fumigated_m2,
            drone_code_used,
            duration_minutes,
            notes,
            human_notes,
            recorded_by,
            product_registered_ica,
            pilot_license,
            recorded_at,
            source,
            flight_ids
           FROM dji_fumigations
           ${whereSql}
          ORDER BY fumigation_date DESC, recorded_at DESC`,
        params
      );
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

/**
 * M7 — Inputs del timeline de fumigaciones de una parcela, listos para
 * pasarse a `buildFumigationTimeline()` (lib/fumigation-timeline.ts).
 *
 * Hace un JOIN con `dji_flights` para resolver el `drone_nickname` y
 * `pilot_name` DOMINANTE del día — no de cada sortie individual. Misma
 * estrategia que ya usa `lib/djiag-spatial-aggregator.ts` para el mapa
 * de Task History: el join es por `(parcel_id, fecha Bogota-local)`.
 *
 * Devuelve `[]` si no hay eventos en el rango. NO cachea (M7: datos
 * operativos frescos, como Task History).
 */
interface FumigationTimelineDbRow {
  id: number;
  fumigation_date: Date | string;
  product_used: string | null;
  dose_l_per_ha: number | string | null;
  area_fumigated_m2: number | string | null;
  duration_minutes: number | null;
  drone_code_used: number | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  recorded_by: string | null;
  notes: string | null;
  source: "manual" | "djiscraper" | "import";
}

export async function getFumigationTimelineForParcel(
  parcelId: number,
  from: string,
  to: string
): Promise<FumigationTimelineInput[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<FumigationTimelineDbRow>(
        `
          SELECT
            f.id,
            f.fumigation_date,
            f.product_used,
            f.dose_l_per_ha,
            f.area_fumigated_m2,
            f.duration_minutes,
            f.drone_code_used,
            f.recorded_by,
            f.notes,
            f.source,
            (
              SELECT fl.drone_nickname
                FROM dji_flights fl
               WHERE fl.parcel_id = f.parcel_id
                 AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
                 AND fl.drone_nickname IS NOT NULL
               GROUP BY fl.drone_nickname
               ORDER BY COUNT(*) DESC
               LIMIT 1
            ) AS drone_nickname,
            (
              SELECT fl.pilot_name
                FROM dji_flights fl
               WHERE fl.parcel_id = f.parcel_id
                 AND (fl.start_at AT TIME ZONE 'America/Bogota')::date = f.fumigation_date
                 AND fl.pilot_name IS NOT NULL
               GROUP BY fl.pilot_name
               ORDER BY COUNT(*) DESC
               LIMIT 1
            ) AS pilot_name
          FROM dji_fumigations f
          WHERE f.parcel_id = $1
            AND f.deleted_at IS NULL
            AND f.fumigation_date >= $2::date
            AND f.fumigation_date <= $3::date
          ORDER BY f.fumigation_date ASC
        `,
        [parcelId, from, to]
      );
      return result.rows.map((row): FumigationTimelineInput => {
        const dateStr = toDateString(row.fumigation_date) ?? "";
        const minutes = row.duration_minutes;
        return {
          id: row.id,
          fumigation_date: dateStr,
          product_used: row.product_used,
          dose_l_per_ha: row.dose_l_per_ha === null ? null : Number(row.dose_l_per_ha),
          area_fumigated_m2: row.area_fumigated_m2 === null ? null : Number(row.area_fumigated_m2),
          duration_seconds: minutes === null ? null : minutes * 60,
          drone_code_used: row.drone_code_used,
          drone_nickname: row.drone_nickname,
          pilot_name: row.pilot_name,
          recorded_by: row.recorded_by,
          notes: row.notes,
          source: row.source
        };
      });
    },
    async () => []
  );
}

/**
 * Inserta un nuevo evento de fumigación. Recalcula `next_due_date`
 * en el schedule correspondiente.
 */
export async function createFumigationEvent(event: {
  parcel_id: number;
  fumigation_date: string;
  product_used?: string | null;
  dose_l_per_ha?: number | null;
  area_fumigated_m2?: number | null;
  drone_code_used?: number | null;
  duration_minutes?: number | null;
  notes?: string | null;
  human_notes?: string | null;
  recorded_by?: string | null;
  /**
   * Compliance metadata (Sprint C — H2, 2026-07-23):
   *   - product_registered_ica: ej "ICA-1234-PN" (CHECK length 3-50)
   *   - pilot_license:            ej "PCA-12345"  (CHECK regex `^[A-Z0-9-]{4,20}$`)
   *
   * La BD valida el formato final con CHECK constraints. El server
   * pre-valida longitud para no tirar el handler con inputs gigantes.
   * Si el valor no pasa el CHECK de la BD, el INSERT falla con un
   * error de constraint que el route handler mapea a 400.
   */
  product_registered_ica?: string | null;
  pilot_license?: string | null;
}): Promise<DjiFumigationEvent> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const ins = await client.query<DjiFumigationEvent>(
          `
            INSERT INTO dji_fumigations
              (parcel_id, fumigation_date, product_used, dose_l_per_ha,
               area_fumigated_m2, drone_code_used, duration_minutes, notes,
               human_notes, recorded_by, product_registered_ica, pilot_license,
               source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual')
            RETURNING
              id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
              area_fumigated_m2, drone_code_used, duration_minutes, notes,
              human_notes, recorded_by, product_registered_ica, pilot_license,
              recorded_at, source
          `,
          [
            event.parcel_id,
            event.fumigation_date,
            event.product_used ?? null,
            event.dose_l_per_ha ?? null,
            event.area_fumigated_m2 ?? null,
            event.drone_code_used ?? null,
            event.duration_minutes ?? null,
            event.notes ?? null,
            event.human_notes ?? null,
            event.recorded_by ?? null,
            event.product_registered_ica ?? null,
            event.pilot_license ?? null
          ]
        );
        const created = ins.rows[0];

        // Recalcular last_fumigation_date y next_due_date en el schedule
        const sched = await getFumigationSchedule(event.parcel_id);
        const cadence = sched?.recommended_cadence_days ?? 14;
        const next = computeNextDueDate(event.fumigation_date, cadence);
        await client.query(
          `
            UPDATE dji_fumigation_schedule
            SET last_fumigation_date = $2,
                next_due_date = $3,
                updated_at = NOW()
            WHERE parcel_id = $1
          `,
          [event.parcel_id, event.fumigation_date, next]
        );
        await client.query("COMMIT");
        // Invalidar cache (dashboard + upcoming + alertas) tras COMMIT exitoso.
        // Si falló el COMMIT ya hicimos ROLLBACK; invalidar afuera del try
        // mantiene el invariante "datos en BD == cache".
        invalidateAfterFumigationMutation();
        return created;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Actualiza la cadencia esperada de una parcela. Si la parcela no tiene
 * schedule, lo crea con los defaults.
 */
export async function setFumigationCadence(parcelId: number, cadenceDays: number): Promise<void> {
  if (!Number.isFinite(cadenceDays) || cadenceDays < 1 || cadenceDays > 365) {
    throw new Error("cadence_days debe estar entre 1 y 365");
  }
  const db = getDb();
  await withLocalFallback(
    async () => {
      const parcel = await getParcelById(parcelId);
      if (!parcel) throw new Error("Parcela no encontrada");
      const def = parcel.is_orchard
        ? CADENCE_DEFAULTS.Orchards
        : CADENCE_DEFAULTS.Farmland;
      const current = await getFumigationSchedule(parcelId);
      const cropType = current?.crop_type ?? def.crop_type;
      const lastDate = current?.last_fumigation_date ?? null;
      const next = computeNextDueDate(lastDate, cadenceDays);
      await db.query(
        `
          INSERT INTO dji_fumigation_schedule
            (parcel_id, crop_type, recommended_cadence_days, last_fumigation_date, next_due_date, is_active)
          VALUES ($1, $2, $3, $4, $5, true)
          ON CONFLICT (parcel_id) DO UPDATE
          SET recommended_cadence_days = EXCLUDED.recommended_cadence_days,
              crop_type = EXCLUDED.crop_type,
              next_due_date = EXCLUDED.next_due_date,
              updated_at = NOW()
        `,
        [parcelId, cropType, cadenceDays, lastDate, next]
      );
      // Invalidar upcoming — el `next_due_date` cambió y `recommended_cadence_days`
      // también afecta el cálculo de "overdue/due_soon".
      invalidateAfterFumigationMutation();
    },
    async () => {
      throw new Error("DB no disponible");
    }
  );
}

/**
 * Devuelve las próximas fumigaciones (overdue + due_soon) ordenadas por
 * urgencia. Calcula el estado en aplicación, no en la BD, para que siempre
 * esté fresco al consultar.
 *
 * Sprint 7: cacheado (TTL 1min, tag `afm:upcoming`).
 * El cálculo de `now` está dentro de la función cacheada, así que el "overdue"
 * depende del momento en que se cacheó. Por eso el TTL es agresivo (60s).
 */
export async function getUpcomingFumigations(limit = 10): Promise<UpcomingFumigation[]> {
  return fetchUpcomingFumigationsCached(limit);
}

/**
 * M3-M5 Q2 — Lista de parcelas "Faltan por fumigar", ordenadas por
 * prioridad (overdue > due_soon > ok > no_history; dentro de cada
 * severity, días más negativos primero).
 *
 * Args:
 *   - `maxDaysAhead` (default 14): incluye parcelas cuya cadencia
 *     vence en los próximos N días. 0 = solo las ya vencidas.
 *   - `limit` (default 200): cap defensivo.
 *   - `cropType`: filtra por tipo de cultivo.
 *   - `isOrchard`: filtra por tipo de parcela.
 *
 * Sprint Q2: cacheado (TTL 1min, tags `afm:overdue` + `afm:parcels`).
 * Se invalida en `invalidateAfterFumigationMutation()` porque al
 * registrar una fumigación, la cadencia de la parcela afectada se
 * recalcula.
 */
export async function getOverdueParcels(args: OverdueParcelsArgs = {}): Promise<OverdueParcel[]> {
  return fetchOverdueParcelsCached(args);
}

/**
 * Query a dji_flights sin agregación. Traemos todas las columnas que
 * necesita `aggregateFlightsByDay` + algunas extra (drone_nickname, parcel_id)
 * para futuras extensiones del dashboard.
 *
 * (S2 / 2026-07-01) `getParcels()` legacy eliminada — usaba el shape
 * DjiAssetRecord (3-rows-per-field) que tampoco existe. Para listar parcelas
 * con shape normalizado usá `getParcelsNormalized()`.
 */
const flightsRawQuery = `
  SELECT
    id,
    flight_id,
    start_at,
    end_at,
    duration_seconds,
    area_m2,
    spray_usage_ml,
    drone_nickname,
    pilot_name,
    parcel_id
  FROM dji_flights
  ORDER BY start_at DESC
`;

export async function getFlights(page = 1, limit = 20) {
  const db = getDb();
  const offset = (page - 1) * limit;
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiFlightDbRow>(flightsRawQuery);
      const aggregated = aggregateFlightsByDay(
        result.rows.map((r): FlightRow => ({
          id: r.id,
          flight_id: r.flight_id,
          start_at: r.start_at,
          duration_seconds: r.duration_seconds,
          area_m2: r.area_m2,
          spray_usage_ml: r.spray_usage_ml
        }))
      );
      const total = aggregated.length;
      return {
        data: aggregated.slice(offset, offset + limit) as DjiDailySummaryRecord[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => {
      const data = loadLocalSummaryRecords();
      const total = data.length;
      return {
        data: data.slice(offset, offset + limit),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    }
  );
}

/**
 * Sprint 7: ahora cacheado (TTL 5min, tag `afm:alerts`).
 */
export async function getAlerts(): Promise<DjiAlertRecord[]> {
  return fetchAlertsCached();
}

/**
 * Sprint 7: ahora cacheado (TTL 5min, tag `afm:metrics`).
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  return fetchDashboardMetricsCached();
}

/**
 * Devuelve los N vuelos mas recientes con su centroide (lng, lat) para
 * plot en /map. M6 (2026-06-28) — footprint minimo hasta que se pueda
 * decodear el protobuf detallado de DJI.
 *
 * El cache es por `limit` — dos requests con limit=300 y limit=500 caen
 * en keys distintas. Si el caller quiere siempre el "ultimo vuelo" sin
 * importar el limit, una paginacion client-side tiene mas sentido.
 */
export async function getFlightPoints(limit = 300): Promise<FlightPointRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  return fetchFlightPointsCached(safeLimit);
}

/**
 * v2.1 (sprint S7.2) — batch query: trae TODOS los flight points del
 * dataset en una sola query. Usado por el `<ParcelMap>` del detalle
 * de parcela para mostrar los flights como markers en el mapa.
 *
 * El caller (page server) filtra por `parcelId` con `Array.from` —
 * eficiente cuando el dataset es chico-mediano (10-200 flights por
 * parcela). Para datasets grandes (>1k flights por parcela) conviene
 * agregar `WHERE parcel_id = ANY($1)` cuando se consuma desde un
 * detail (TODO S7.3).
 *
 * Cacheada con TTL 60s y tag `afm:flights-all`. Se invalida con
 * `invalidateAfterFumigationMutation()`.
 */
export async function getFlightPointsForMap(): Promise<FlightPointRecord[]> {
  const safeLimit = 2000;
  return fetchFlightPointsCached(safeLimit);
}

/**
 * v2.5.5 (sprint S8.7+): polígonos derivados de flights fumigados
 * reales. Computa el `ST_ConvexHull` de los flight points por parcel.
 *
 * Cobertura actual (medido 2026-07-30 con `scripts/diagnose-parcel-geometry.js`):
 *   - 1213 parcels totales
 *   - 451 parcels (37.2%) tienen al menos 1 flight
 *   - 419 parcels (34.5%) tienen >= 3 flights → devuelven hull real
 *   - 32 parcels (2.6%) tienen 1-2 flights → hull null (caller hace buffer)
 *   - 762 parcels (62.8%) sin flights → no aparecen acá (caller hace synthetic)
 *
 * Cacheado 10min (TTL `flightHulls`). Se invalida junto con `flights`
 * cuando se re-importan. La query es cara (PostGIS sobre 8k flights)
 * pero estable entre re-scrapes.
 *
 * Retorna:
 *   - `hullGeometry`: GeoJSON Polygon cuando flightCount >= 3, sino null
 *   - `centroid`: {lng, lat} promedio de los flights — siempre presente
 *     cuando hay al menos 1 flight. El caller lo usa para buffer cuando
 *     el hull no es viable.
 *
 * Ver `lib/data.ts:adaptParcel` para el cascade: hull → buffer → synthetic.
 */
export async function getFlightHullsByParcel(): Promise<
  Array<{
    parcelId: number;
    flightCount: number;
    centroid: { lng: number; lat: number };
    hullGeometry: GeoJSON.Polygon | null;
  }>
> {
  return fetchFlightHullsByParcelCached();
}

/**
 * Sprint A — F4.0: comparativa de actividad "ayer vs hoy" en Bogota
 * local. Lo que consume `<TodayYesterdayCard>` en el dashboard.
 *
 * Las fechas se calculan acá (en Bogota local, via `getBogotaDateString`)
 * y se pasan al wrapper cacheado como parte del cache key. Eso significa
 * que el cache hit es estable dentro del mismo día (los args no cambian
 * entre renders) y se renueva al cruzar el midnight Bogota.
 *
 * Fallback: si la BD no responde, devuelve ceros para ambos días. El
 * card renderiza empty state ("Sin actividad ayer / hoy") que es el
 * comportamiento esperado en una BD vacía recién sembrada.
 */
export async function getActivityComparison(): Promise<ActivityComparison> {
  const today = getBogotaDateString(0);
  const yesterday = getBogotaDateString(-1);
  return withLocalFallback(
    async () => fetchActivityComparisonCached(today, yesterday),
    async () => ({
      today: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
      yesterday: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
      dates: { today, yesterday }
    })
  );
}

// ============================================================
// Sprint G1 — Hoja de vida: huérfanas, link manual, stats globales
// ============================================================

/**
 * Stats globales del módulo de fumigaciones.
 *
 * Usado por:
 *   - El empty state inteligente de `ParcelFumigations` (cuando la
 *     parcela no tiene fumigaciones propias, el contexto "X huérfanas
 *     en el sistema" le da sentido al admin).
 *   - La página `/admin/orphan-fumigations` (header con KPIs).
 *
 * Decisión: una sola query agregada en vez de 6 queries separadas.
 * El `withLocalFallback` envuelve para no tumbar la UI si la BD está
 * caída — devuelve ceros (el empty state sigue funcionando).
 *
 * Cobertura: porcentaje redondeado a 1 decimal. No se calcula 0% si
 * no hay parcelas — en ese caso la cobertura es 0 (no NaN).
 */
export interface FumigationDbStats {
  total: number;
  orphan: number;
  manual: number;
  import: number;
  djiscraper: number;
  parcelasConFumigacion: number;
  totalParcelas: number;
  coberturaPct: number;
}

export async function getFumigationDbStats(): Promise<FumigationDbStats> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const r = await db.query<{
        total: string;
        orphan: string;
        manual: string;
        import_n: string;
        djiscraper: string;
        parcelas_con_fum: string;
        total_parcelas: string;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM dji_fumigations WHERE deleted_at IS NULL) AS total,
          (SELECT COUNT(*) FROM dji_fumigations WHERE parcel_id IS NULL AND deleted_at IS NULL) AS orphan,
          (SELECT COUNT(*) FROM dji_fumigations WHERE source = 'manual' AND deleted_at IS NULL) AS manual,
          (SELECT COUNT(*) FROM dji_fumigations WHERE source = 'import' AND deleted_at IS NULL) AS import_n,
          (SELECT COUNT(*) FROM dji_fumigations WHERE source = 'djiscraper' AND deleted_at IS NULL) AS djiscraper,
          (SELECT COUNT(DISTINCT parcel_id) FROM dji_fumigations WHERE parcel_id IS NOT NULL AND deleted_at IS NULL) AS parcelas_con_fum,
          (SELECT COUNT(*) FROM dji_parcels) AS total_parcelas
      `);
      const row = r.rows[0];
      const total = Number(row.total);
      const orphan = Number(row.orphan);
      const parcelasConFumigacion = Number(row.parcelas_con_fum);
      const totalParcelas = Number(row.total_parcelas);
      return {
        total,
        orphan,
        manual: Number(row.manual),
        import: Number(row.import_n),
        djiscraper: Number(row.djiscraper),
        parcelasConFumigacion,
        totalParcelas,
        coberturaPct:
          totalParcelas > 0
            ? Math.round((parcelasConFumigacion / totalParcelas) * 1000) / 10
            : 0
      };
    },
    async () => ({
      total: 0,
      orphan: 0,
      manual: 0,
      import: 0,
      djiscraper: 0,
      parcelasConFumigacion: 0,
      totalParcelas: 0,
      coberturaPct: 0
    })
  );
}

/**
 * Lista paginada de fumigaciones huérfanas (parcel_id IS NULL).
 *
 * Las huérfanas vienen del backfill de flights (source='import') cuando
 * el spatial join no encontró una parcela para el flight. NO tienen
 * geometría (no hay flight_id persistido en dji_fumigations), así que
 * no podemos matchearlas automáticamente — el admin las revisa y las
 * vincula manualmente via `linkFumigationToParcel`.
 *
 * Sprint G1: usadas por `/admin/orphan-fumigations`.
 */
export async function getOrphanFumigations(
  limit: number,
  offset: number
): Promise<{ rows: DjiFumigationEvent[]; total: number }> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const totalResult = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM dji_fumigations WHERE parcel_id IS NULL AND deleted_at IS NULL`
      );
      const total = Number(totalResult.rows[0].n);
      const result = await db.query<DjiFumigationEvent>(
        `
          SELECT
            id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
            area_fumigated_m2, drone_code_used, duration_minutes,
            notes, human_notes, recorded_by,
            product_registered_ica, pilot_license,
            recorded_at, source
          FROM dji_fumigations
          WHERE parcel_id IS NULL AND deleted_at IS NULL
          ORDER BY fumigation_date DESC, recorded_at DESC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      return {
        total,
        rows: result.rows.map((row) => ({
          ...row,
          fumigation_date: toDateString(row.fumigation_date) ?? ""
        }))
      };
    },
    async () => ({ total: 0, rows: [] })
  );
}

/**
 * Vincula una fumigación huérfana a una parcela. El admin decide
 * manualmente a qué parcela va (no hay spatial join posible — las
 * huérfanas no tienen geometría).
 *
 * Devuelve `null` si:
 *   - La fumigación no existe o está soft-deleted
 *   - La fumigación ya estaba asignada a otra parcela (idempotente: no
 *     hace nada, no tira error; el caller puede mostrar "ya estaba
 *     asignada")
 *   - La parcela destino no existe
 *
 * Si la vinculación es exitosa, también recalcula `last_fumigation_date`
 * y `next_due_date` del schedule de la parcela destino (mismo patrón
 * que `createFumigationEvent`). Invalida el cache via
 * `invalidateAfterFumigationMutation` (la fumigación ya entra en el
 * cálculo de cadencia, last_*, etc. del dashboard).
 */
export async function linkFumigationToParcel(
  fumigationId: number,
  parcelId: number
): Promise<{ status: "linked" | "already_assigned" | "not_found"; event?: DjiFumigationEvent }> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // 1) Fumigación existe y está huérfana
      const before = await db.query<{ parcel_id: number | null; fumigation_date: Date }>(
        `SELECT parcel_id, fumigation_date FROM dji_fumigations WHERE id = $1 AND deleted_at IS NULL`,
        [fumigationId]
      );
      if (before.rows.length === 0) {
        return { status: "not_found" };
      }
      if (before.rows[0].parcel_id !== null) {
        return { status: "already_assigned" };
      }

      // 2) Parcela destino existe
      const parcel = await db.query<{ id: number }>(
        `SELECT id FROM dji_parcels WHERE id = $1`,
        [parcelId]
      );
      if (parcel.rows.length === 0) {
        return { status: "not_found" };
      }

      // 3) UPDATE. La condición `parcel_id IS NULL` en el WHERE evita
      // race conditions si dos admins vinculan a la vez (el segundo
      // se queda con 0 rows y devolvemos "already_assigned").
      const updated = await db.query<DjiFumigationEvent>(
        `
          UPDATE dji_fumigations
          SET parcel_id = $2
          WHERE id = $1 AND parcel_id IS NULL AND deleted_at IS NULL
          RETURNING
            id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
            area_fumigated_m2, drone_code_used, duration_minutes,
            notes, human_notes, recorded_by,
            product_registered_ica, pilot_license,
            recorded_at, source
        `,
        [fumigationId, parcelId]
      );
      if (updated.rows.length === 0) {
        return { status: "already_assigned" };
      }
      const linked = updated.rows[0];

      // 4) Recalcular schedule de la parcela destino
      const sched = await getFumigationSchedule(parcelId);
      const cadence = sched?.recommended_cadence_days ?? 14;
      const next = computeNextDueDate(linked.fumigation_date, cadence);
      await db.query(
        `
          UPDATE dji_fumigation_schedule
          SET last_fumigation_date = $2,
              next_due_date = $3,
              updated_at = NOW()
          WHERE parcel_id = $1
        `,
        [parcelId, linked.fumigation_date, next]
      );

      // 5) Invalidar cache
      invalidateAfterFumigationMutation();

      return {
        status: "linked",
        event: {
          ...linked,
          fumigation_date: toDateString(linked.fumigation_date) ?? ""
        }
      };
    },
    async () => ({ status: "not_found" })
  );
}

// ============================================================
// Sprint G2 — Hoja de vida completa: resumen, trazabilidad, history
// ============================================================

/**
 * Resumen anual de fumigaciones de una parcela: 12 rows (1 por mes)
 * con count + area_total_m2 + litros_total (calculado a partir de
 * dose_l_per_ha × area_fumigated_m2 / 10000).
 *
 * Usado por `components/parcels/parcel-fumigation-history.tsx` para
 * el grid mensual "esta parcela tuvo X fumigaciones en enero, Y en
 * febrero, ...". Selector de año en la UI permite cambiar entre
 * 2024, 2025, 2026.
 *
 * Decisión: en vez de N queries (1 por mes), 1 sola query con
 * `generate_series` para garantizar 12 rows aunque un mes no tenga
 * fumigaciones. El UI ya espera 12 cards.
 */
export interface MonthlyFumigationSummary {
  month: number; // 1-12
  count: number;
  area_total_m2: number;
  litros_total: number;
}

export async function getFumigationYearlySummary(
  parcelId: number,
  year: number
): Promise<MonthlyFumigationSummary[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{
        month: number;
        count: string;
        area_total_m2: string;
        litros_total: string;
      }>(
        `
          WITH months AS (
            SELECT generate_series(1, 12) AS month
          ),
          agg AS (
            SELECT
              EXTRACT(MONTH FROM f.fumigation_date)::int AS month,
              COUNT(*)::int AS count,
              COALESCE(SUM(f.area_fumigated_m2), 0)::numeric AS area_total_m2,
              COALESCE(
                SUM(
                  CASE
                    WHEN f.dose_l_per_ha IS NOT NULL AND f.area_fumigated_m2 IS NOT NULL
                    THEN f.dose_l_per_ha * f.area_fumigated_m2 / 10000.0
                    ELSE 0
                  END
                ),
                0
              )::numeric AS litros_total
            FROM dji_fumigations f
            WHERE f.parcel_id = $1
              AND EXTRACT(YEAR FROM f.fumigation_date) = $2
              AND f.deleted_at IS NULL
            GROUP BY EXTRACT(MONTH FROM f.fumigation_date)
          )
          SELECT
            m.month,
            COALESCE(a.count, 0) AS count,
            COALESCE(a.area_total_m2, 0) AS area_total_m2,
            COALESCE(a.litros_total, 0) AS litros_total
          FROM months m
          LEFT JOIN agg a ON a.month = m.month
          ORDER BY m.month
        `,
        [parcelId, year]
      );
      return result.rows.map((row) => ({
        month: Number(row.month),
        count: Number(row.count),
        area_total_m2: Number(row.area_total_m2),
        litros_total: Number(row.litros_total)
      }));
    },
    async () =>
      Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        count: 0,
        area_total_m2: 0,
        litros_total: 0
      }))
  );
}

/**
 * Trazabilidad flight → fumigación: devuelve los dji_flights que
 * originaron una fumigación del import (los IDs están en
 * dji_fumigations.flight_ids, persistidos por el backfill Sprint G2).
 *
 * Devuelve un array vacío si:
 *   - La fumigación no existe
 *   - La fumigación es manual (source='manual') o huérfana pre-G2
 *     (flight_ids=NULL)
 *
 * Orden: por start_at asc (los flights del día en orden temporal).
 */
export interface FlightTraceRow {
  id: number;
  start_at: string | null;
  end_at: string | null;
  drone_nickname: string | null;
  pilot_name: string | null;
  area_m2: number | null;
  duration_seconds: number | null;
}

export async function getFumigationFlightTrace(
  fumigationId: number
): Promise<FlightTraceRow[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{
        id: number;
        start_at: Date | null;
        end_at: Date | null;
        drone_nickname: string | null;
        pilot_name: string | null;
        area_m2: string | number | null;
        duration_seconds: number | null;
      }>(
        `
          SELECT
            f.id, f.start_at, f.end_at,
            f.drone_nickname, f.pilot_name,
            f.area_m2, f.duration_seconds
          FROM dji_fumigations fum
          JOIN dji_flights f ON f.id = ANY(fum.flight_ids)
          WHERE fum.id = $1
            AND fum.deleted_at IS NULL
          ORDER BY f.start_at ASC NULLS LAST
        `,
        [fumigationId]
      );
      return result.rows.map((row) => ({
        id: Number(row.id),
        start_at: row.start_at ? row.start_at.toISOString() : null,
        end_at: row.end_at ? row.end_at.toISOString() : null,
        drone_nickname: row.drone_nickname,
        pilot_name: row.pilot_name,
        area_m2: row.area_m2 !== null ? Number(row.area_m2) : null,
        duration_seconds: row.duration_seconds !== null ? Number(row.duration_seconds) : null
      }));
    },
    async () => []
  );
}

/**
 * Historial de cambios de cadencia/cultivo de una parcela. Ordenado
 * por changed_at DESC (más reciente primero).
 *
 * Usado por `components/parcels/parcel-fumigation-history.tsx` para
 * mostrar la sección "Cambios de cadencia" con diffs antes/después.
 *
 * Decisión: limit configurable (default 10). El UI no pagina — son
 * cambios raros, los últimos 10 alcanzan.
 */
export interface ScheduleHistoryEntry {
  id: number;
  parcel_id: number;
  old_cadence_days: number | null;
  new_cadence_days: number | null;
  old_crop_type: string | null;
  new_crop_type: string | null;
  changed_by: string | null;
  reason: string | null;
  commit_sha: string | null;
  changed_at: string;
}

export async function getScheduleHistory(
  parcelId: number,
  limit: number = 10
): Promise<ScheduleHistoryEntry[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<{
        id: string;
        parcel_id: number;
        old_cadence_days: number | null;
        new_cadence_days: number | null;
        old_crop_type: string | null;
        new_crop_type: string | null;
        changed_by: string | null;
        reason: string | null;
        commit_sha: string | null;
        changed_at: Date;
      }>(
        `
          SELECT id, parcel_id,
                 old_cadence_days, new_cadence_days,
                 old_crop_type, new_crop_type,
                 changed_by, reason, commit_sha, changed_at
            FROM dji_fumigation_schedule_history
           WHERE parcel_id = $1
           ORDER BY changed_at DESC
           LIMIT $2
        `,
        [parcelId, limit]
      );
      return result.rows.map((row) => ({
        id: Number(row.id),
        parcel_id: row.parcel_id,
        old_cadence_days: row.old_cadence_days,
        new_cadence_days: row.new_cadence_days,
        old_crop_type: row.old_crop_type,
        new_crop_type: row.new_crop_type,
        changed_by: row.changed_by,
        reason: row.reason,
        commit_sha: row.commit_sha,
        changed_at: row.changed_at.toISOString()
      }));
    },
    async () => []
  );
}

/**
 * Totales anuales de una parcela: cantidad de fumigaciones, área
 * total fumigada, litros totales, productos únicos usados.
 *
 * Diferencia con `getFumigationYearlySummary`: este es UN solo row con
 * los totales agregados de los 12 meses, para mostrar en el header
 * del UI ("este año: 14 fumigaciones, 87.500 m², 145 L, 4 productos
 * distintos").
 */
export interface YearTotals {
  year: number;
  count: number;
  area_total_m2: number;
  litros_total: number;
  productos_unicos: number;
}

export async function getFumigationYearTotals(
  parcelId: number,
  year: number
): Promise<YearTotals> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const r = await db.query<{
        count: string;
        area_total_m2: string;
        litros_total: string;
        productos_unicos: string;
      }>(
        `
          SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(area_fumigated_m2), 0)::numeric AS area_total_m2,
            COALESCE(
              SUM(
                CASE
                  WHEN dose_l_per_ha IS NOT NULL AND area_fumigated_m2 IS NOT NULL
                  THEN dose_l_per_ha * area_fumigated_m2 / 10000.0
                  ELSE 0
                END
              ),
              0
            )::numeric AS litros_total,
            COUNT(DISTINCT NULLIF(product_used, ''))::int AS productos_unicos
          FROM dji_fumigations
          WHERE parcel_id = $1
            AND EXTRACT(YEAR FROM fumigation_date) = $2
            AND deleted_at IS NULL
        `,
        [parcelId, year]
      );
      const row = r.rows[0];
      return {
        year,
        count: Number(row.count),
        area_total_m2: Number(row.area_total_m2),
        litros_total: Number(row.litros_total),
        productos_unicos: Number(row.productos_unicos)
      };
    },
    async () => ({ year, count: 0, area_total_m2: 0, litros_total: 0, productos_unicos: 0 })
  );
}

/**
 * v2.1 (sprint S7) — fumigaciones más recientes para alimentar el
 * `RecentActivity` del dashboard.
 *
 * Trae los últimos N eventos (default 12) con `parcel_id` válido
 * y `deleted_at IS NULL`. Cacheada con TTL 60s y tag
 * `afm:recent-fumigations` (mismo patrón que el resto del dashboard).
 */
export async function getRecentFumigations(
  limit: number = 12
): Promise<DjiFumigationEvent[]> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      // s8.8 (2026-07-31): LEFT JOIN con dji_flights para calcular el
      // centroide de los flights asociados a la fumigacion (vía
      // flight_ids = bigint[]). Eso da lng/lat REAL para que el
      // geovisor pueda renderizar el punto en el lugar correcto
      // (antes se renderizaba en lng=0/lat=0 porque DjiFumigationV0
      // no tenia lng/lat).
      //
      // El `n_matched_flights` es util para debugging y para el popup
      // ("5 de 7 flights asociados"). Si es 0, el centroide es NULL
      // y el evento NO deberia renderizarse en el mapa.
      const result = await db.query<DjiFumigationEvent>(
        `SELECT
            f.id,
            f.parcel_id,
            f.fumigation_date,
            f.product_used,
            f.dose_l_per_ha,
            f.area_fumigated_m2,
            f.drone_code_used,
            f.duration_minutes,
            f.notes,
            f.human_notes,
            f.recorded_by,
            f.product_registered_ica,
            f.pilot_license,
            f.recorded_at,
            f.source,
            f.flight_ids,
            count(fl.id)::int AS n_matched_flights,
            CASE
              WHEN count(fl.id) = 0 THEN NULL
              ELSE ST_Y(ST_Centroid(ST_Collect(fl.point)))::numeric
            END AS lat,
            CASE
              WHEN count(fl.id) = 0 THEN NULL
              ELSE ST_X(ST_Centroid(ST_Collect(fl.point)))::numeric
            END AS lng
           FROM dji_fumigations f
           LEFT JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
          WHERE f.deleted_at IS NULL
            AND f.parcel_id IS NOT NULL
          GROUP BY f.id
          ORDER BY f.fumigation_date DESC, f.recorded_at DESC
          LIMIT $1`,
        [limit]
      );
      return result.rows.map((row) => ({
        ...row,
        fumigation_date: toDateString(row.fumigation_date) ?? ""
      }));
    },
    async () => []
  );
}

// ---------------------------------------------------------------------------
// Crop cycle data (sprint 2026-08-01 — "Fase de cultivo y cadencia efectiva").
//
// Devuelve un Map parcel_id → { planting_date, cycle_phase } para todas las
// parcelas no soft-deleted. Se usa desde `getParcelsWithCycle()` en
// `lib/data.ts` para extender el shape V0 (`DjiParcel`) con la fase del
// cultivo sin tocar la query cacheada del dataset.
//
// Decisiones de diseño:
//   - Query dedicado (NO extiende `djiParcelsQuery`). Razón: si la
//     migration 20260801000000_add_planting_date_and_season.sql no se
//     aplicó todavía, este query explota con "column cycle_phase does
//     not exist". El caller (`getParcelsWithCycle`) lo envuelve en
//     try/catch y degrada a null. Si hubiéramos metido `cycle_phase`
//     en `djiParcelsQuery`, el cache de 60s del dataset entero se
//     rompería hasta que se aplique la migration — peor blast radius.
//   - Filtra `deleted_at IS NULL` igual que `djiParcelsQuery`.
//   - Solo trae 3 columnas (id, planting_date, cycle_phase) — chico,
//     no necesita ser cacheado. Si en el futuro se vuelve hot, agregar
//     wrapper con `unstable_cache`.
//   - `cycle_phase` viene como string de Postgres. El driver lo devuelve
//     como string (no enum). Validamos el shape acá para no propagar
//     strings arbitrarios a la UI.
// ---------------------------------------------------------------------------

export interface ParcelCycleRow {
  id: number;
  planting_date: string | null;
  cycle_phase: CyclePhase | null;
}

const VALID_PHASES: ReadonlySet<string> = new Set([
  "establecimiento",
  "vegetativa",
  "madurante",
  "cosecha"
]);

function normalizePhase(value: unknown): CyclePhase | null {
  if (typeof value !== "string") return null;
  return VALID_PHASES.has(value) ? (value as CyclePhase) : null;
}

export async function getParcelsCycleData(): Promise<Map<number, ParcelCycleRow>> {
  const db = getDb();
  const result = await db.query<{
    id: number;
    planting_date: string | Date | null;
    cycle_phase: string | null;
  }>(
    `SELECT id, planting_date, cycle_phase
       FROM dji_parcels
      WHERE deleted_at IS NULL`
  );
  const map = new Map<number, ParcelCycleRow>();
  for (const row of result.rows) {
    map.set(Number(row.id), {
      id: Number(row.id),
      // pg devuelve DATE como string 'YYYY-MM-DD' o Date según el driver.
      // Normalizamos a string si es Date. Si la columna no existe, el
      // query entero falla (capturado en el caller).
      planting_date:
        row.planting_date == null
          ? null
          : row.planting_date instanceof Date
            ? row.planting_date.toISOString().slice(0, 10)
            : String(row.planting_date),
      cycle_phase: normalizePhase(row.cycle_phase)
    });
  }
  return map;
}
