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
  fetchOverdueParcelsCached,
  fetchParcelsNormalizedCached,
  fetchParcelsSummaryCached,
  fetchUpcomingFumigationsCached,
  invalidateAfterFumigationMutation,
  invalidateAfterParcelMutation
} from "@/lib/cache";
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
  FlightPointRecord
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
    fetched_at,
    -- Metadata editable por el supervisor (migration 20260722000000).
    -- DJI no expone estos datos — los llena el operador manualmente.
    crop_type,
    planting_date,
    owner_name,
    owner_contact,
    supervisor_notes
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
 * Campos editables de una parcela desde la UI. NO incluye geometrías ni datos
 * de DJI scrapeados — esos vienen del importer. Solo metadata que el operador
 * puede querer ajustar manualmente (nombre visible, tipo declarado, areas,
 * y la metadata humana que DJI no expone: cultivo, siembra, propietario, contacto, notas).
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

  if (sets.length === 0) {
    // Nada que cambiar — devolvemos el registro actual sin tocar BD.
    return getParcelById(id);
  }

  const db = getDb();
  return withLocalFallback(
    async () => {
      // Verificar existencia primero (devolvemos null vs throw).
      const existing = await db.query<{ id: number }>(`SELECT id FROM dji_parcels WHERE id = $1`, [id]);
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
    human_notes,
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
               human_notes, recorded_by, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
            RETURNING
              id, parcel_id, fumigation_date, product_used, dose_l_per_ha,
              area_fumigated_m2, drone_code_used, duration_minutes, notes,
              human_notes, recorded_by, recorded_at, source
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
