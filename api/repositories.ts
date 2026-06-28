import { getDb } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import {
  CADENCE_DEFAULTS,
  computeNextDueDate
} from "@/lib/fumigation-cadence";
import { toDateString } from "@/lib/format";
import {
  aggregateFlightsByDay,
  type DailySummaryLike,
  type FlightRow
} from "@/lib/dji-flights-aggregate";
import {
  fetchAlertsCached,
  fetchDashboardMetricsCached,
  fetchFlightPointsCached,
  fetchParcelsNormalizedCached,
  fetchParcelsSummaryCached,
  fetchUpcomingFumigationsCached,
  invalidateAfterFumigationMutation
} from "@/lib/cache";
import type {
  DashboardMetrics,
  DjiAssetRecord,
  DjiDailySummaryRecord,
  DjiFlightRecord,
  DjiAlertRecord,
  DjiFumigationEvent,
  DjiFumigationSchedule,
  DjiParcelRecord,
  UpcomingFumigation,
  FlightPointRecord
} from "@/lib/types";

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

function loadLocalAssetRecords(): DjiAssetRecord[] {
  const assetList = readJsonFile<Array<Record<string, unknown>>>(path.join(localExportsRoot, "land_file_urls.json"), []);
  return assetList.map((item, index) => ({
    id: index + 1,
    external_id: String(item.externalId ?? ""),
    land_name: String(item.landName ?? ""),
    asset_kind: String(item.kind ?? ""),
    source_url: String(item.url ?? ""),
    raw_json: null,
    geometry: null
  }));
}

function loadLocalFieldCount() {
  const fields = readJsonFile<Array<Record<string, unknown>>>(path.join(localExportsRoot, "mission_fields.json"), []);
  return fields.length;
}

async function withLocalFallback<T>(queryFn: () => Promise<T>, fallbackFn: () => Promise<T>) {
  try {
    return await queryFn();
  } catch {
    return fallbackFn();
  }
}

// (Sprint 2) `assetsQuery` y `summariesQuery` eliminadas. Las tablas
// dji_land_assets y dji_daily_summaries se dropearon en la migración
// 20260628120000. El dashboard ahora lee de dji_flights vía el agregador.

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================
// NUEVO — Opción B: 1 fila por parcela con columnas planas
// ============================================================

const djiParcelsQuery = `
  SELECT
    id,
    external_id,
    land_name,
    field_type,
    declared_area_ha,
    spray_area_m2,
    drone_model_code,
    drone_model_name,
    spray_width_m,
    work_speed_mps,
    optimal_heading_deg,
    radar_height_m,
    edge_offset_m,
    obstacle_offset_m,
    climb_height_m,
    no_spray_zone_m2,
    droplet_size,
    sweep_direction,
    is_orchard,
    uses_side_spray,
    CASE WHEN spray_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(spray_geom)::json END AS spray_geometry,
    CASE WHEN reference_point IS NULL THEN NULL ELSE ST_AsGeoJSON(reference_point)::json END AS reference_point,
    CASE WHEN waypoints IS NULL THEN NULL ELSE ST_AsGeoJSON(waypoints)::json END AS waypoints_geometry,
    waypoint_count,
    source_url_geometry,
    source_url_parameter,
    source_url_waypoint,
    fetched_at
  FROM dji_parcels
`;

export interface DjiParcelsFilter {
  isOrchard?: boolean;
  droneModelCode?: number;
  minSprayAreaM2?: number;
  fieldType?: string;
}

/**
 * Devuelve la lista normalizada de parcelas (Opción B).
 * Usa la tabla dji_parcels, con columnas planas y geometrías PostGIS como GeoJSON.
 *
 * Sprint 7 (2026-06-28): cacheado con `unstable_cache` (TTL 60s, tag
 * `afm:parcels`). El dashboard y /map pegaban este query en cada
 * navegación; ahora es prácticamente gratis entre revalidaciones.
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
    filter.fieldType !== undefined;

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
 * Devuelve una sola parcela por id, con todas sus geometrías como GeoJSON.
 * Devuelve null si no existe.
 */
export async function getParcelById(id: number): Promise<DjiParcelRecord | null> {
  const db = getDb();
  return withLocalFallback(
    async () => {
      const result = await db.query<DjiParcelRecord>(
        `${djiParcelsQuery} WHERE id = $1`,
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
    recorded_by,
    recorded_at,
    source
  FROM dji_fumigations
  WHERE parcel_id = $1
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
  recorded_by?: string | null;
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
               recorded_by, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual')
            RETURNING
              id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
              area_fumigated_m2, drone_code_used, duration_minutes, notes,
              recorded_by, recorded_at, source
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
            event.recorded_by ?? null
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
 * @deprecated Desde Sprint 2 del roadmap (2026-06-28) esta función lee de
 * `dji_parcels` y mapea al shape legacy `DjiAssetRecord` con `asset_kind='parcel'`.
 * Prefiere `getParcelsNormalized` para callers nuevos — devuelve columnas planas
 * y geometrías PostGIS como GeoJSON, sin el shape de 3-rows-per-field.
 *
 * La función se mantiene por compatibilidad con `/api/parcels` y callers que aún
 * esperan el shape `DjiAssetRecord`. Cuando todos los callers hayan migrado a
 * `getParcelsNormalized`, esta función se puede borrar.
 */
export async function getParcels(page = 1, limit = 20) {
  const db = getDb();
  const offset = (page - 1) * limit;
  return withLocalFallback(
    async () => {
      // Mapeamos dji_parcels (1 fila por campo) a DjiAssetRecord legacy.
      // Como el shape original tenía 3 filas por campo (geometry/parameter/waypoint),
      // emitimos 1 fila sintética por parcela con asset_kind='parcel'. Los callers
      // que filtraban por asset_kind específico deben migrar a getParcelsNormalized.
      const result = await db.query<{
        id: number;
        external_id: string;
        land_name: string | null;
        source_url: string | null;
        raw_json: unknown;
        geometry: GeoJSON.Geometry | null;
      }>(
        `
          SELECT
            id,
            external_id,
            land_name,
            source_url_geometry AS source_url,
            raw_geometry AS raw_json,
            CASE WHEN spray_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(spray_geom)::json END AS geometry
          FROM dji_parcels
          ORDER BY land_name ASC, id ASC
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );
      const countResult = await db.query<{ total: string }>("SELECT COUNT(*)::int AS total FROM dji_parcels");
      const total = Number(countResult.rows[0]?.total ?? 0);
      const data: DjiAssetRecord[] = result.rows.map((r) => ({
        id: r.id,
        external_id: r.external_id,
        land_name: r.land_name ?? "",
        asset_kind: "parcel",
        source_url: r.source_url ?? "",
        raw_json: r.raw_json,
        geometry: r.geometry
      }));
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    },
    async () => {
      const data = loadLocalAssetRecords();
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
 * Query a dji_flights sin agregación. Traemos todas las columnas que
 * necesita `aggregateFlightsByDay` + algunas extra (drone_nickname, parcel_id)
 * para futuras extensiones del dashboard.
 *
 * (Sprint 2 del roadmap) Antes leíamos dji_daily_summaries (rollup por día).
 * Ahora agregamos 7050 sorties individuales en JS — preserva el shape
 * DjiDailySummaryRecord sin cambiar la UI.
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
